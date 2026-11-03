import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileStateStore } from "../src/core/state-store.js";
import { RunService } from "../src/service/run-service.js";
import { RunReviewService } from "../src/service/run-review-service.js";

const now = "2026-11-03T16:00:00Z";
const workspace = "/work/review";
const baseRule = { step: "independent_verify", jsonPath: "status", notEquals: "pass", status: "needs_validation_resolution", next: "resolve findings before closeout" };
const receipt = (nodeId, output, attempt = 1) => ({ schemaVersion: "v1", runId: "run_stop-rule", nodeId, status: "completed", recordedAt: now, attempt, output });
const resolution = { reason: "Added the missing regression test.", workspace, worktreeReview: "Checked the pinned worktree and preflight receipt.", reviewedPredecessors: true };

async function fixture(mode = "block") {
  const directory = await mkdtemp(join(tmpdir(), "flow-stop-rule-test-"));
  const store = new FileStateStore(directory);
  const flow = { id: "stop-rule-flow", stopWhen: [{ ...baseRule, ...(mode ? { mode } : {}) }], nodes: [
    { id: "preflight" }, { id: "independent_verify", after: ["preflight"] }, { id: "closeout", after: ["independent_verify"] }
  ] };
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: flow }), createId: () => "run_stop-rule", now: () => now });
  await service.create({ flowId: flow.id, workspace, runtime: "codex", executionMode: "guided" });
  await service.next("run_stop-rule");
  await service.checkpoint("run_stop-rule", receipt("preflight", { status: "pass" }));
  await service.checkpoint("run_stop-rule", receipt("independent_verify", { status: "FAIL", finding: "The query mutation survived." }));
  return { directory, store, service };
}

test("resolvable stop rule keeps the run blocked and the FAIL receipt visible", async () => {
  const { directory, store, service } = await fixture();
  try {
    const result = await service.next("run_stop-rule");
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "STOP_RULE");
    assert.equal(result.block.next, "resolve findings before closeout");
    assert.equal((await service.get("run_stop-rule")).status, "blocked");
    assert.equal((await service.get("run_stop-rule")).block.status, "needs_validation_resolution");
    assert.equal((await store.listReceipts("run_stop-rule")).find((item) => item.nodeId === "independent_verify").output.status, "FAIL");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("continue archives completed FAIL, retries only verification, and preserves prior checkpoints", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.next("run_stop-rule");
    const continued = await service.continueRun("run_stop-rule", resolution);
    assert.equal(continued.status, "running");
    assert.deepEqual(continued.next.map((node) => [node.id, node.attempt]), [["independent_verify", 2]]);
    assert.equal((await service.next("run_stop-rule")).nodes[0].attempt, 2);
    const history = await store.listArchivedReceipts("run_stop-rule");
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "completed");
    assert.equal(history[0].output.status, "FAIL");
    assert.equal((await store.listReceipts("run_stop-rule")).find((item) => item.nodeId === "preflight").status, "completed");
    await assert.rejects(service.checkpoint("run_stop-rule", receipt("independent_verify", { status: "pass" })), { code: "RETRY_ATTEMPT_REQUIRED" });
    await service.checkpoint("run_stop-rule", receipt("independent_verify", { status: "pass" }, 2));
    assert.deepEqual((await service.next("run_stop-rule")).nodes.map((node) => node.id), ["closeout"]);
    await service.checkpoint("run_stop-rule", receipt("closeout", { status: "pass" }));
    assert.equal((await service.next("run_stop-rule")).status, "done");
    assert.equal((await service.audit("run_stop-rule")).retryHistory[0].status, "completed");
    assert.equal((await service.audit("run_stop-rule")).retryHistory[0].stopRuleBlocked, true);
    const report = await new RunReviewService({ stateStore: store }).review({ flowId: "stop-rule-flow" });
    const verify = report.versions[0].nodeMetrics.find((item) => item.nodeId === "independent_verify");
    assert.deepEqual({ completed: verify.completed, failed: verify.failed, retries: verify.retries }, { completed: 1, failed: 1, retries: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a resolvable rule requires a real review and respects the pinned workspace and retry limit", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.next("run_stop-rule");
    await assert.rejects(service.continueRun("run_stop-rule", { reason: "Fixed." }), { code: "CONTINUE_REVIEW_REQUIRED" });
    await assert.rejects(service.continueRun("run_stop-rule", { ...resolution, workspace: "/work/other" }), { code: "RETRY_WORKSPACE_MISMATCH" });
    const run = await store.readRun("run_stop-rule");
    run.flowDefinition.nodes.find((node) => node.id === "independent_verify").retry = 0;
    await store.writeRun(run);
    await assert.rejects(service.continueRun("run_stop-rule", resolution), { code: "RETRY_LIMIT_REACHED" });
    assert.equal((await store.listArchivedReceipts("run_stop-rule")).length, 0);
    assert.equal((await service.get("run_stop-rule")).status, "blocked");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a second FAIL blocks again and keeps both attempts before closeout", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.next("run_stop-rule");
    await service.continueRun("run_stop-rule", resolution);
    await service.checkpoint("run_stop-rule", receipt("independent_verify", { status: "FAIL", finding: "The retry still failed." }, 2));
    assert.equal((await service.next("run_stop-rule")).reason, "STOP_RULE");
    assert.equal((await service.get("run_stop-rule")).status, "blocked");
    assert.equal((await store.listArchivedReceipts("run_stop-rule")).length, 1);
    const again = await service.continueRun("run_stop-rule", { ...resolution, reason: "Fixed the second finding." });
    assert.deepEqual(again.next.map((node) => [node.id, node.attempt]), [["independent_verify", 3]]);
    assert.deepEqual((await store.listArchivedReceipts("run_stop-rule")).map((item) => item.attempt), [1, 2]);
    assert.equal((await service.next("run_stop-rule")).nodes[0].id, "independent_verify");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a write failure after archiving keeps one old receipt and allows the same review to retry", async () => {
  const { directory, store, service } = await fixture();
  try {
    await service.next("run_stop-rule");
    const failing = new RunService({ stateStore: {
      readRun: (...args) => store.readRun(...args), listReceipts: (...args) => store.listReceipts(...args),
      archiveFailedReceipt: (...args) => store.archiveFailedReceipt(...args),
      writeRun: async () => { throw new Error("disk failure"); }
    }, now: () => now });
    await assert.rejects(failing.continueRun("run_stop-rule", resolution), /disk failure/);
    assert.equal((await service.get("run_stop-rule")).status, "blocked");
    assert.equal((await store.listReceipts("run_stop-rule")).find((item) => item.nodeId === "independent_verify").output.status, "FAIL");
    await assert.rejects(service.continueRun("run_stop-rule", { ...resolution, reason: "Different claim." }), /Archived attempt differs/);
    const resumed = await service.continueRun("run_stop-rule", resolution);
    assert.equal(resumed.next[0].attempt, 2);
    assert.equal((await store.listArchivedReceipts("run_stop-rule")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a terminal stop rule still ends the run and cannot continue", async () => {
  const { directory, store, service } = await fixture(null);
  try {
    assert.equal((await service.next("run_stop-rule")).status, "stopped");
    assert.equal((await service.get("run_stop-rule")).status, "stopped");
    await assert.rejects(service.continueRun("run_stop-rule", resolution), { code: "RUN_NOT_BLOCKED" });
    assert.equal((await store.listArchivedReceipts("run_stop-rule")).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
