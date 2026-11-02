import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileStateStore } from "../src/core/state-store.js";
import { LocalToken } from "../src/core/local-token.js";
import { LocalFlowClient } from "../src/mcp/local-client.js";
import { createHttpServer } from "../src/service/http-server.js";
import { RunService } from "../src/service/run-service.js";
import { RunReviewService } from "../src/service/run-review-service.js";

const now = "2026-11-02T15:00:00Z";
const workspace = "/work/feature";
const flow = { id: "retry-flow", nodes: [
  { id: "prepare" },
  { id: "build", after: ["prepare"], model: "provider/model", effort: "medium" },
  { id: "verify", after: ["build"] }
] };
const receipt = (nodeId, status, attempt = 1) => ({ schemaVersion: "v1", runId: "run_retry", nodeId, status, recordedAt: now,
  attempt, ...(nodeId === "build" && status === "completed" ? { model: "provider/model", effort: "medium" } : {}) });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flow-retry-test-"));
  const store = new FileStateStore(directory);
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: flow }), createId: () => "run_retry", now: () => now });
  await service.create({ flowId: flow.id, flowContentHash: "a".repeat(64), workspace, runtime: "codex", executionMode: "guided" });
  await service.next("run_retry");
  await service.checkpoint("run_retry", receipt("prepare", "completed"));
  await service.checkpoint("run_retry", receipt("build", "failed"));
  return { directory, store, service };
}

const review = { nodeId: "build", failedRecordedAt: now, workspace, reviewedNodeIds: ["prepare"],
  worktreeReview: "Checked branch and changed files in the pinned worktree.", reason: "The backend step was only partly implemented." };

test("explicit retry preserves failure and prior node, then unlocks dependent validation", async () => {
  const { directory, store, service } = await fixture();
  try {
    const context = await service.retryContext("run_retry", "build");
    assert.equal(context.failedReceipt.status, "failed");
    assert.deepEqual(context.predecessors.map(({ nodeId, receipt }) => [nodeId, receipt.status]), [["prepare", "completed"]]);
    assert.equal((await service.next("run_retry")).reason, "NODE_FAILED");
    assert.deepEqual(await service.retryNode("run_retry", review), { runId: "run_retry", nodeId: "build", attempt: 2, status: "ready_for_retry" });
    assert.equal((await service.next("run_retry")).nodes[0].id, "build");
    await assert.rejects(service.checkpoint("run_retry", receipt("build", "completed")), { code: "RETRY_ATTEMPT_REQUIRED" });
    await service.checkpoint("run_retry", receipt("build", "completed", 2));
    assert.equal((await service.next("run_retry")).nodes[0].id, "verify");
    assert.equal((await store.listReceipts("run_retry")).find((item) => item.nodeId === "prepare").status, "completed");
    assert.equal((await store.listArchivedReceipts("run_retry"))[0].status, "failed");
    assert.equal((await service.audit("run_retry")).retryHistory[0].attempt, 1);
    assert.equal((await service.audit("run_retry")).retryHistory[0].reason, review.reason);
    await service.checkpoint("run_retry", receipt("verify", "completed"));
    assert.equal((await service.next("run_retry")).status, "done");
    assert.equal((await service.audit("run_retry")).result, "passed");
    const report = await new RunReviewService({ stateStore: store }).review({ flowId: flow.id });
    const build = report.versions[0].nodeMetrics.find((item) => item.nodeId === "build");
    assert.deepEqual({ receipts: build.receipts, failed: build.failed, completed: build.completed, retries: build.retries },
      { receipts: 2, failed: 1, completed: 1, retries: 1 });
    assert.equal((await readFile(join(directory, "runs", "run_retry", "attempts", "receipt-build-1.json"), "utf8")).includes('"status": "failed"'), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("retry rejects stale evidence, incomplete review, wrong workspace, and a second pending request", async () => {
  const { directory, service } = await fixture();
  try {
    await assert.rejects(service.retryNode("run_retry", { ...review, failedRecordedAt: "2026-11-02T16:00:00Z" }), { code: "RETRY_RECEIPT_CHANGED" });
    await assert.rejects(service.retryNode("run_retry", { ...review, reviewedNodeIds: [] }), { code: "RETRY_REVIEW_INCOMPLETE" });
    await assert.rejects(service.retryNode("run_retry", { ...review, workspace: "/work/other" }), { code: "RETRY_WORKSPACE_MISMATCH" });
    await service.retryNode("run_retry", review);
    await assert.rejects(service.retryNode("run_retry", review), { code: "RETRY_ALREADY_PENDING" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("two concurrent retry requests cannot create two pending attempts", async () => {
  const { directory, store, service } = await fixture();
  try {
    const results = await Promise.allSettled([service.retryNode("run_retry", review), service.retryNode("run_retry", review)]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.find((item) => item.status === "rejected").reason.code, "RETRY_ALREADY_PENDING");
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("retry refuses paused and terminal runs without changing receipts", async () => {
  const { directory, store, service } = await fixture();
  try {
    const run = await store.readRun("run_retry");
    run.status = "running";
    delete run.block;
    await store.writeRun(run);
    await service.transition("run_retry", "pause");
    await assert.rejects(service.retryNode("run_retry", review), { code: "RETRY_RUN_NOT_RUNNING" });
    await service.transition("run_retry", "stop");
    await assert.rejects(service.retryNode("run_retry", review), { code: "RETRY_RUN_NOT_RUNNING" });
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("retry respects an explicit zero retry limit", async () => {
  const { directory, store } = await fixture();
  const limited = new RunService({ stateStore: store });
  try {
    const run = await store.readRun("run_retry");
    run.flowDefinition.nodes.find((item) => item.id === "build").retry = 0;
    await store.writeRun(run);
    await assert.rejects(limited.retryNode("run_retry", review), { code: "RETRY_LIMIT_REACHED" });
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed receipt remains intact when saving the retry marker fails", async () => {
  const { directory, store } = await fixture();
  try {
    const failing = new RunService({ stateStore: { ...store,
      readRun: (...args) => store.readRun(...args), listReceipts: (...args) => store.listReceipts(...args),
      archiveFailedReceipt: (...args) => store.archiveFailedReceipt(...args),
      writeRun: async () => { throw new Error("disk failure"); }
    }, now: () => now });
    await assert.rejects(failing.retryNode("run_retry", review), /disk failure/);
    assert.equal((await store.listReceipts("run_retry")).find((item) => item.nodeId === "build").status, "failed");
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 1);
    await assert.rejects(new RunService({ stateStore: store }).retryNode("run_retry", { ...review, reason: "Different reason" }), /Archived attempt differs/);
    await new RunService({ stateStore: store, now: () => "2026-11-02T16:00:00Z" }).retryNode("run_retry", review);
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("next recovers a completed retry after a failure to clear its marker", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.retryNode("run_retry", review);
    const flaky = new RunService({ stateStore: {
      readRun: (...args) => store.readRun(...args), listReceipts: (...args) => store.listReceipts(...args),
      writeReceipt: (...args) => store.writeReceipt(...args),
      writeRun: async () => { throw new Error("disk failure after checkpoint"); }
    } });
    await assert.rejects(flaky.checkpoint("run_retry", receipt("build", "completed", 2)), /disk failure/);
    assert.equal((await store.listReceipts("run_retry")).find((item) => item.nodeId === "build").status, "completed");
    assert.equal((await service.next("run_retry")).nodes[0].id, "verify");
    assert.equal((await store.readRun("run_retry")).retry, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local MCP retry routes require the token and return the pinned context", async () => {
  const { directory, store, service } = await fixture();
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ runService: service, token, serviceInfo: () => ({ status: "ready" }) });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    await store.writeJson(join(directory, "service.json"), { endpoint });
    const client = new LocalFlowClient({ stateDir: directory });
    const unauthorizedRead = await fetch(`${endpoint}/v1/runs/run_retry/retry?nodeId=build`);
    assert.equal(unauthorizedRead.status, 401);
    const context = await client.retryInspect("run_retry", "build");
    assert.equal(context.workspace, workspace);
    assert.equal(context.failedReceipt.status, "failed");
    const unauthorized = await fetch(`${endpoint}/v1/runs/run_retry/retry`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "unauthorized-retry-001" }, body: JSON.stringify(review) });
    assert.equal(unauthorized.status, 401);
    assert.equal((await client.retryNode("run_retry", review)).attempt, 2);
    assert.equal((await client.next("run_retry")).nodes[0].id, "build");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a blocked pending node continues in the same run and keeps prior receipts", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.retryNode("run_retry", review);
    await service.checkpoint("run_retry", receipt("build", "completed", 2));
    assert.equal((await service.next("run_retry")).nodes[0].id, "verify");
    await service.block("run_retry", { nodeId: "verify", reason: "Waiting for the developer to fix the test environment." });
    assert.equal((await service.next("run_retry")).runStatus, "blocked");
    await assert.rejects(service.transition("run_retry", "continue"), { code: "INVALID_LIFECYCLE_TRANSITION" });
    await assert.rejects(service.checkpoint("run_retry", receipt("verify", "completed")), { code: "RUN_BLOCKED" });
    await assert.rejects(service.continueRun("run_retry", { reason: "" }), { code: "INVALID_RESOLUTION" });
    const continued = await service.continueRun("run_retry", { reason: "The developer repaired the test environment." });
    assert.equal(continued.status, "running");
    assert.equal(continued.next[0].id, "verify");
    assert.equal((await store.listReceipts("run_retry")).find((item) => item.nodeId === "prepare").status, "completed");
    assert.equal((await service.audit("run_retry")).blockHistory.at(-1).nodeId, "verify");
    await service.checkpoint("run_retry", receipt("verify", "completed"));
    assert.equal((await service.next("run_retry")).status, "done");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a failed receipt needs review and a stopped run cannot continue", async () => {
  const { directory, service } = await fixture();
  try {
    assert.equal((await service.next("run_retry")).reason, "NODE_FAILED");
    assert.equal((await service.get("run_retry")).status, "blocked");
    await assert.rejects(service.continueRun("run_retry", { reason: "Fixed." }), { code: "CONTINUE_REVIEW_REQUIRED" });
    await assert.rejects(service.block("run_retry", { nodeId: "verify", reason: "Waiting." }), { code: "RUN_NOT_RUNNING" });
    await service.transition("run_retry", "stop");
    await assert.rejects(service.continueRun("run_retry", { reason: "Fixed." }), { code: "RUN_NOT_BLOCKED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a failed last node blocks the run and can continue without replaying earlier nodes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-last-node-test-"));
  const store = new FileStateStore(directory);
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: { id: "last-node", nodes: [{ id: "prepare" }, { id: "finish", after: ["prepare"] }] } }), createId: () => "run_last", now: () => now });
  try {
    await service.create({ flowId: "last-node", workspace, runtime: "codex", executionMode: "guided" });
    await service.next("run_last");
    await service.checkpoint("run_last", { ...receipt("prepare", "completed"), runId: "run_last" });
    await service.checkpoint("run_last", { ...receipt("finish", "failed"), runId: "run_last" });
    assert.equal((await service.next("run_last")).status, "blocked");
    assert.equal((await service.get("run_last")).status, "blocked");
    const continued = await service.continueRun("run_last", { reason: "Fixed the final step.", workspace, worktreeReview: "Checked the pinned worktree and prepare receipt.", reviewedPredecessors: true });
    assert.equal(continued.next[0].id, "finish");
    assert.equal(continued.next[0].attempt, 2);
    assert.equal((await store.listReceipts("run_last")).find((item) => item.nodeId === "prepare").status, "completed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("HTTP block and continue require the local token and keep the same run", async () => {
  const { directory, store, service } = await fixture();
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ runService: service, token, serviceInfo: () => ({ status: "ready" }) });
  try {
    await service.retryNode("run_retry", review);
    await service.checkpoint("run_retry", receipt("build", "completed", 2));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    await store.writeJson(join(directory, "service.json"), { endpoint });
    const unauthorized = await fetch(`${endpoint}/v1/runs/run_retry/block`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "unauthorized-block-001" }, body: JSON.stringify({ nodeId: "verify", reason: "Waiting for access" }) });
    assert.equal(unauthorized.status, 401);
    const client = new LocalFlowClient({ stateDir: directory });
    assert.equal((await client.block("run_retry", { nodeId: "verify", reason: "Waiting for access" })).status, "blocked");
    assert.equal((await client.next("run_retry")).nodeId, "verify");
    assert.equal((await client.continueRun("run_retry", { reason: "Access is available" })).next[0].id, "verify");
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP flow_continue retries a failed receipt with only the agent review", async () => {
  const { directory, store, service } = await fixture();
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ runService: service, token, serviceInfo: () => ({ status: "ready" }) });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    await store.writeJson(join(directory, "service.json"), { endpoint });
    const client = new LocalFlowClient({ stateDir: directory });
    const result = await client.continueRun("run_retry", { reason: "Developer fixed the node.", workspace, worktreeReview: "Checked pinned worktree and completed prepare receipt.", reviewedPredecessors: true });
    assert.equal(result.next[0].id, "build");
    assert.equal(result.next[0].attempt, 2);
    assert.equal((await client.next("run_retry")).nodes[0].attempt, 2);
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 1);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("simple continue retries a failed node in the same run without retry metadata from the caller", async () => {
  const { directory, store, service } = await fixture();
  try {
    assert.equal((await service.next("run_retry")).status, "blocked");
    const result = await service.continueRun("run_retry", {
      reason: "The developer fixed the implementation.", workspace,
      worktreeReview: "Checked the pinned worktree and the completed prepare step.", reviewedPredecessors: true
    });
    assert.equal(result.status, "running");
    assert.equal(result.next[0].id, "build");
    assert.equal(result.next[0].attempt, 2);
    assert.equal((await store.listReceipts("run_retry")).find((item) => item.nodeId === "prepare").status, "completed");
    assert.equal((await store.listArchivedReceipts("run_retry"))[0].status, "failed");
    assert.equal((await service.audit("run_retry")).blockHistory[0].resolution, "The developer fixed the implementation.");
    await service.checkpoint("run_retry", receipt("build", "completed", 2));
    assert.equal((await service.next("run_retry")).nodes[0].id, "verify");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a failed checkpoint blocks immediately, so continue needs no extra next call", async () => {
  const { directory, store, service } = await fixture();
  try {
    assert.equal((await service.get("run_retry")).status, "blocked");
    assert.equal((await service.next("run_retry")).nodeId, "build");
    const continued = await service.continueRun("run_retry", { reason: "Fixed the failed step.", workspace, worktreeReview: "Checked the pinned worktree and prepare receipt.", reviewedPredecessors: true });
    assert.equal(continued.next[0].id, "build");
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed checkpoint shows its reason to the developer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-failure-reason-test-"));
  const store = new FileStateStore(directory);
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: { id: "single", nodes: [{ id: "check" }] } }), createId: () => "run_reason", now: () => now });
  try {
    await service.create({ flowId: "single", workspace, runtime: "codex", executionMode: "guided" });
    await service.next("run_reason");
    await service.checkpoint("run_reason", { ...receipt("check", "failed"), runId: "run_reason", summary: "The API contract is missing." });
    assert.equal((await service.get("run_reason")).block.details, "The API contract is missing.");
    assert.equal((await service.next("run_reason")).details, "The API contract is missing.");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("simple continue keeps a failed run blocked for unsafe or missing review", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.next("run_retry");
    await assert.rejects(service.continueRun("run_retry", { reason: "Fixed." }), { code: "CONTINUE_REVIEW_REQUIRED" });
    await assert.rejects(service.continueRun("run_retry", { reason: "Fixed.", workspace, worktreeReview: "Checked worktree." }), { code: "CONTINUE_REVIEW_REQUIRED" });
    await assert.rejects(service.continueRun("run_retry", { reason: "Fixed.", workspace: "/work/other", worktreeReview: "Checked.", reviewedPredecessors: true }), { code: "RETRY_WORKSPACE_MISMATCH" });
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 0);
    assert.equal((await service.get("run_retry")).status, "blocked");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("simple continue refuses missing predecessor evidence and the retry limit", async () => {
  const first = await fixture();
  try {
    await rm(join(first.directory, "runs", "run_retry", "receipt-prepare.json"));
    await assert.rejects(first.service.continueRun("run_retry", { reason: "Fixed.", workspace, worktreeReview: "Checked worktree.", reviewedPredecessors: true }), { code: "RETRY_PREDECESSOR_UNSAFE" });
    assert.equal((await first.store.listArchivedReceipts("run_retry")).length, 0);
    assert.equal((await first.service.get("run_retry")).status, "blocked");
  } finally { await rm(first.directory, { recursive: true, force: true }); }

  const second = await fixture();
  try {
    const run = await second.store.readRun("run_retry");
    run.flowDefinition.nodes.find((node) => node.id === "build").retry = 0;
    await second.store.writeRun(run);
    await assert.rejects(second.service.continueRun("run_retry", { reason: "Fixed.", workspace, worktreeReview: "Checked worktree.", reviewedPredecessors: true }), { code: "RETRY_LIMIT_REACHED" });
    assert.equal((await second.store.listArchivedReceipts("run_retry")).length, 0);
  } finally { await rm(second.directory, { recursive: true, force: true }); }
});

test("two concurrent continue calls create only one retry attempt", async () => {
  const { directory, store, service } = await fixture();
  try {
    const resolution = { reason: "Fixed the node.", workspace, worktreeReview: "Checked the pinned worktree and prepare receipt.", reviewedPredecessors: true };
    const results = await Promise.allSettled([service.continueRun("run_retry", resolution), service.continueRun("run_retry", resolution)]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.find((item) => item.status === "rejected").reason.code, "RUN_NOT_BLOCKED");
    assert.equal((await store.listArchivedReceipts("run_retry")).length, 1);
    assert.equal((await service.next("run_retry")).nodes[0].attempt, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
