import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseFlowDocument } from "../src/core/flow-document.js";
import { FileStateStore } from "../src/core/state-store.js";
import { LocalToken } from "../src/core/local-token.js";
import { LocalFlowClient } from "../src/mcp/local-client.js";
import { callTool, tools } from "../src/mcp/server.js";
import { planFlowNext } from "../src/service/flow-scheduler.js";
import { FlowSourceService } from "../src/service/flow-source-service.js";
import { createHttpServer } from "../src/service/http-server.js";
import { RunService } from "../src/service/run-service.js";

const now = "2026-11-20T12:00:00Z";
const ws = "/work/x";
const runId = "run_appr";
const rec = (nodeId, status, attempt = 1, model) => ({ schemaVersion: "v1", runId, nodeId, status, recordedAt: now, attempt, ...(model ? { model } : {}) });
const review = { nodeId: "build", failedRecordedAt: now, workspace: ws, reviewedNodeIds: ["prepare"], worktreeReview: "Checked the pinned worktree.", reason: "Fix the build." };
const cont = { reason: "Fixed.", workspace: ws, worktreeReview: "Checked worktree.", reviewedPredecessors: true };

async function fixture({ retry = 1 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "verify-appr-"));
  const store = new FileStateStore(directory);
  const flow = { id: "appr-flow", nodes: [
    { id: "prepare" },
    { id: "build", after: ["prepare"], model: "provider/opus", retryModel: "provider/sonnet", retry },
    { id: "verify", after: ["build"] }
  ] };
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: flow }), createId: () => runId, now: () => now });
  await service.create({ flowId: flow.id, workspace: ws, runtime: "codex", executionMode: "guided" });
  await service.next(runId);
  await service.checkpoint(runId, rec("prepare", "completed"));
  await service.checkpoint(runId, rec("build", "failed", 1, "provider/opus"));
  return { directory, store, service };
}

test("approval inside the retry limit is ignored and never recorded", async () => {
  const { directory, store, service } = await fixture({ retry: 1 });
  try {
    assert.equal((await service.retryNode(runId, { ...review, userApproval: "" })).attempt, 2);
    const archived = await store.listArchivedReceipts(runId);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].retryDecision.userApproval, undefined);
    assert.equal(archived[0].retryDecision.approvedAt, undefined);
    assert.equal((await service.audit(runId)).retryHistory[0].userApproval, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("beyond the limit, missing or invalid approval is refused without archiving", async () => {
  const { directory, store, service } = await fixture({ retry: 1 });
  try {
    await service.retryNode(runId, review);
    await service.next(runId);
    await service.checkpoint(runId, rec("build", "failed", 2, "provider/sonnet"));
    await assert.rejects(service.retryNode(runId, review), { code: "RETRY_LIMIT_REACHED" });
    for (const bad of ["", "   ", "x".repeat(2001), 5, true]) {
      await assert.rejects(service.retryNode(runId, { ...review, userApproval: bad }), { code: "INVALID_RETRY_APPROVAL" });
    }
    assert.equal((await store.listArchivedReceipts(runId)).length, 1);
    assert.equal((await service.get(runId)).status, "blocked");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a valid approval unlocks exactly one attempt and is recorded in every history", async () => {
  const { directory, store, service } = await fixture({ retry: 1 });
  try {
    await service.retryNode(runId, review);
    await service.next(runId);
    await service.checkpoint(runId, rec("build", "failed", 2, "provider/sonnet"));
    const granted = await service.retryNode(runId, { ...review, userApproval: "  sim, mais uma  " });
    assert.equal(granted.attempt, 3);
    const archived = await store.listArchivedReceipts(runId);
    assert.equal(archived[1].retryDecision.userApproval, "sim, mais uma");
    assert.equal(archived[1].retryDecision.approvedAt, now);
    const entry = (await service.audit(runId)).retryHistory.find((item) => item.attempt === 2);
    assert.deepEqual([entry.userApproval, entry.approvedAt], ["sim, mais uma", now]);
    await service.next(runId);
    await service.checkpoint(runId, rec("build", "failed", 3, "provider/sonnet"));
    await assert.rejects(service.retryNode(runId, review), { code: "RETRY_LIMIT_REACHED" });
    assert.equal((await store.listArchivedReceipts(runId)).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("retry attempt runs retryModel and a completed receipt must record it", async () => {
  const { directory, service } = await fixture({ retry: 1 });
  try {
    await service.retryNode(runId, review);
    assert.equal((await service.next(runId)).nodes[0].model, "provider/sonnet");
    await assert.rejects(service.checkpoint(runId, rec("build", "completed", 2, "provider/opus")), { code: "NODE_MODEL_MISMATCH" });
    await service.checkpoint(runId, rec("build", "completed", 2, "provider/sonnet"));
    assert.equal((await service.next(runId)).nodes[0].id, "verify");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed-node continue refuses the limit without approval and records approval on the retry", async () => {
  const { directory, store, service } = await fixture({ retry: 0 });
  try {
    await assert.rejects(service.continueRun(runId, cont), { code: "RETRY_LIMIT_REACHED" });
    assert.equal((await store.listArchivedReceipts(runId)).length, 0);
    const result = await service.continueRun(runId, { ...cont, userApproval: "Yes, retry once." });
    assert.deepEqual(result.next.map((node) => [node.id, node.attempt, node.model]), [["build", 2, "provider/sonnet"]]);
    assert.equal((await store.listArchivedReceipts(runId))[0].retryDecision.userApproval, "Yes, retry once.");
    const run = await store.readRun(runId);
    assert.deepEqual([run.blockHistory.at(-1).userApproval, run.blockHistory.at(-1).approvedAt], ["Yes, retry once.", now]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("stop-rule continue accepts approval only beyond the retry limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verify-appr-sr-"));
  const store = new FileStateStore(directory);
  const flow = { id: "sr-flow", stopWhen: [{ step: "verify", jsonPath: "status", notEquals: "pass", status: "needs_fix", next: "fix", mode: "block" }], nodes: [
    { id: "prepare" }, { id: "verify", after: ["prepare"], retry: 0 }
  ] };
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: flow }), createId: () => runId, now: () => now });
  try {
    await service.create({ flowId: flow.id, workspace: ws, runtime: "codex", executionMode: "guided" });
    await service.next(runId);
    await service.checkpoint(runId, rec("prepare", "completed"));
    await service.checkpoint(runId, { ...rec("verify", "completed"), output: { status: "FAIL" } });
    assert.equal((await service.next(runId)).reason, "STOP_RULE");
    await assert.rejects(service.continueRun(runId, cont), { code: "RETRY_LIMIT_REACHED" });
    const result = await service.continueRun(runId, { ...cont, userApproval: "Approved by user." });
    assert.deepEqual(result.next.map((node) => [node.id, node.attempt]), [["verify", 2]]);
    assert.equal((await service.audit(runId)).retryHistory[0].userApproval, "Approved by user.");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local HTTP and MCP flow_continue forward userApproval through the real client", async () => {
  const { directory, store, service } = await fixture({ retry: 0 });
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ runService: service, token, serviceInfo: () => ({ status: "ready" }) });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await store.writeJson(join(directory, "service.json"), { endpoint: `http://127.0.0.1:${server.address().port}` });
    const client = new LocalFlowClient({ stateDir: directory });
    const refused = await callTool(client, "flow_continue", { runId, ...cont });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /^RETRY_LIMIT_REACHED/);
    const value = await callTool(client, "flow_continue", { runId, ...cont, userApproval: "Yes, retry once." });
    assert.equal(value.structuredContent.next[0].attempt, 2);
    assert.equal((await store.listArchivedReceipts(runId))[0].retryDecision.userApproval, "Yes, retry once.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP schema exposes userApproval only on flow_continue", () => {
  const schema = tools.find((tool) => tool.name === "flow_continue").inputSchema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.userApproval.type, "string");
  const switched = tools.find((tool) => tool.name === "flow_switch_runtime").inputSchema;
  assert.equal(switched.properties.userApproval, undefined);
  assert.equal(switched.additionalProperties, false);
});

test("state archive replay ignores approvedAt but rejects a different approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verify-archive-"));
  const store = new FileStateStore(directory);
  try {
    const failed = { ...rec("build", "failed", 1), runId };
    const decision = (approvedAt, userApproval = "Yes.") => ({ reason: "Fix.", worktreeReview: "Checked.", reviewedNodeIds: ["prepare"], requestedAt: now, userApproval, approvedAt });
    await store.archiveFailedReceipt(failed, decision("2026-11-20T12:00:00Z"));
    await store.archiveFailedReceipt(failed, decision("2026-11-20T12:05:00Z"));
    await assert.rejects(store.archiveFailedReceipt(failed, decision("2026-11-20T12:05:00Z", "No.")), TypeError);
    assert.equal((await store.listArchivedReceipts(runId)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("validator requires a model for retryModel and the schema declares it", async () => {
  const withoutModel = "schemaVersion: v2\nid: sample\nname: sample\nnodes:\n  - id: build\n    retryModel: provider/model\n";
  assert.throws(() => parseFlowDocument(withoutModel, { format: "yaml" }), { code: "INVALID_FLOW_DOCUMENT" });
  const withModel = "schemaVersion: v2\nid: sample\nname: sample\nnodes:\n  - id: build\n    model: provider/opus\n    retryModel: provider/sonnet\n";
  assert.equal(parseFlowDocument(withModel, { format: "yaml" }).nodes[0].retryModel, "provider/sonnet");
  const schema = JSON.parse(await readFile(join(process.cwd(), "contracts", "v2", "flow-document.schema.json"), "utf8"));
  assert.equal(JSON.stringify(schema).includes('"retryModel"'), true);
});

test("planner propagates retryModel to the ready node", () => {
  const plan = planFlowNext({ id: "p", nodes: [{ id: "build", model: "provider/opus", retryModel: "provider/sonnet" }] }, { task: "t" }, []);
  assert.equal(plan.nodes[0].retryModel, "provider/sonnet");
  assert.equal(plan.nodes[0].model, "provider/opus");
});

test("source mapping maps retryModel through models and fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verify-map-"));
  try {
    const flows = join(directory, "flows");
    await mkdir(flows);
    const flow = { id: "sample", nodes: [{ id: "build", model: "sonnet", retryModel: "opus" }] };
    await writeFile(join(flows, "sample.json"), JSON.stringify({ schemaVersion: "v1", ...flow }));
    const models = { sonnet: "anthropic/claude-sonnet-5-5", opus: "anthropic/claude-opus-5-5" };
    const fallback = { runtime: "codex", models: { "anthropic/claude-sonnet-5-5": "openai/gpt-6.1-terra", "anthropic/claude-opus-5-5": "openai/gpt-6.1-sol" } };
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "work", mode: "local", path: flows,
      sync: { pull: "confirm", push: "manual" }, execution: { runtime: "claude", models, fallback } }] }));
    const source = new FlowSourceService({ configPath });
    await source.initialize();
    const resolved = await source.resolve({ flowId: "sample", profileId: "work" });
    assert.equal(resolved.flowDefinition.nodes[0].model, "anthropic/claude-sonnet-5-5");
    assert.equal(resolved.flowDefinition.nodes[0].retryModel, "anthropic/claude-opus-5-5");
    assert.equal(resolved.fallbackExecutions.build.retryModel, "openai/gpt-6.1-sol");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fallback-runtime retry uses the fallback retryModel, not the primary one", async () => {
  const { directory, store, service } = await fixture({ retry: 1 });
  try {
    const run = await store.readRun(runId);
    run.nodeExecutions = { build: { runtime: "claude", model: "fb/model-a", retryModel: "fb/model-b", effort: "medium", attempt: 1 } };
    await store.writeRun(run);
    await service.retryNode(runId, review);
    assert.equal((await service.next(runId)).nodes[0].model, "fb/model-b");
    await service.checkpoint(runId, { ...rec("build", "completed", 2, "fb/model-b"), runtime: "claude", effort: "medium" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
