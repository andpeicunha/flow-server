import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LocalToken } from "../src/core/local-token.js";
import { FileStateStore } from "../src/core/state-store.js";
import { LocalFlowClient } from "../src/mcp/local-client.js";
import { callTool, handleRequest, startStdioServer, tools } from "../src/mcp/server.js";
import { createHttpServer } from "../src/service/http-server.js";
import { RunService } from "../src/service/run-service.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flow-mcp-test-"));
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ token, runService: new RunService({ stateStore: new FileStateStore(directory), createId: () => "run_mcp", now: () => "2026-01-01T00:00:00.000Z" }), runReviewService: { review: async (input) => ({ advisoryOnly: true, ...input }) }, serviceInfo: () => ({ status: "ready" }) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new FileStateStore(directory).writeJson(join(directory, "service.json"), { endpoint: `http://127.0.0.1:${port}` });
  let requestNumber = 0;
  return { directory, server, client: new LocalFlowClient({ stateDir: directory, idempotencyKey: () => `mcp-idempotency-key-${++requestNumber}` }) };
}

test("flow-mcp uses only the local service for guided runs and audits", async () => {
  const context = await fixture();
  try {
    assert.deepEqual(await context.client.list(), { items: [], nextCursor: null });
    const started = await context.client.startGuided({ flowId: "hello-flow", workspace: "/workspace", runtime: "codex", task: "Keep the original task" });
    assert.equal(started.id, "run_mcp");
    assert.equal((await context.client.inspect("run_mcp")).task, "Keep the original task");
    assert.equal((await context.client.inspect("run_mcp")).executionMode, "guided");
    assert.equal((await context.client.audit("run_mcp")).result, "incomplete");
    const review = await callTool(context.client, "flow_review", { flowId: "sdd-ahkta", profileId: "ahkta", last: 5 });
    assert.deepEqual(review.structuredContent, { advisoryOnly: true, flowId: "sdd-ahkta", profileId: "ahkta", last: 5, compareVersions: false });
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("flow-mcp advertises a bounded tool set and fails unavailable actions closed", async () => {
  assert.deepEqual(tools.map((tool) => tool.name), ["flow_list", "flow_select", "flow_inspect", "flow_retry_inspect", "flow_retry_node", "flow_block", "flow_switch_runtime", "flow_continue", "flow_start_guided", "flow_next", "flow_lifecycle", "flow_checkpoint", "flow_audit", "flow_review", "flow_open"]);
  const initialized = await handleRequest({}, { method: "initialize" });
  assert.equal(initialized.serverInfo.name, "flow-mcp");
  const next = await callTool({ next: async () => ({ status: "ready", nodes: [] }) }, "flow_next", { runId: "run_test" });
  assert.equal(next.structuredContent.status, "ready");
  const lifecycle = await callTool({ lifecycle: async (runId, action) => ({ runId, action }) }, "flow_lifecycle", { runId: "run_test", action: "pause" });
  assert.deepEqual(lifecycle.structuredContent, { runId: "run_test", action: "pause" });
  const review = await callTool({ review: async (input) => ({ advisoryOnly: true, ...input }) }, "flow_review", { flowId: "sdd-ahkta", profileId: "ahkta" });
  assert.deepEqual(review.structuredContent, { advisoryOnly: true, flowId: "sdd-ahkta", profileId: "ahkta" });
  const retryInspect = await callTool({ retryInspect: async (runId, nodeId) => ({ runId, nodeId }) }, "flow_retry_inspect", { runId: "run_test", nodeId: "build" });
  assert.deepEqual(retryInspect.structuredContent, { runId: "run_test", nodeId: "build" });
  const retry = await callTool({ retryNode: async (runId, input) => ({ runId, ...input }) }, "flow_retry_node", {
    runId: "run_test", nodeId: "build", failedRecordedAt: "2026-11-02T15:00:00Z", workspace: "/work", reviewedNodeIds: ["prepare"], worktreeReview: "Checked", reason: "Fix"
  });
  assert.equal(retry.structuredContent.nodeId, "build");
  const block = await callTool({ block: async (runId, input) => ({ runId, ...input }) }, "flow_block", { runId: "run_test", nodeId: "build", reason: "Needs developer input" });
  assert.equal(block.structuredContent.nodeId, "build");
  const continued = await callTool({ continueRun: async (runId, input) => ({ runId, ...input }) }, "flow_continue", { runId: "run_test", reason: "Developer fixed it", workspace: "/work/feature", worktreeReview: "Checked previous receipts and the pinned worktree.", reviewedPredecessors: true });
  assert.equal(continued.structuredContent.reason, "Developer fixed it");
  assert.equal(continued.structuredContent.workspace, "/work/feature");
  assert.equal(continued.structuredContent.reviewedPredecessors, true);
  const switched = await callTool({ switchRuntime: async (runId, input) => ({ runId, ...input }) }, "flow_switch_runtime", { runId: "run_test", nodeId: "build", reason: "Claude limit reached", workspace: "/work/feature", worktreeReview: "Checked the worktree.", reviewedPredecessors: true });
  assert.equal(switched.structuredContent.nodeId, "build");
  const unavailable = await callTool({}, "flow_open", { runId: "run_test" });
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /MCP_OPERATION_UNAVAILABLE/);
});

test("flow_checkpoint advertises the receipt contract and rejects flattened node output", () => {
  const schema = tools.find((tool) => tool.name === "flow_checkpoint").inputSchema;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const receipt = {
    schemaVersion: "v1", runId: "run_example", nodeId: "gate0_check", status: "completed",
    recordedAt: "2026-11-02T14:00:00Z", model: "provider/model", effort: "low",
    output: { decision: "continue", reason: "Reviewed the actual evidence." }
  };
  assert.equal(validate({ runId: "run_example", receipt }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ runId: "run_example", receipt: { ...receipt, status: "complete" } }), false);
  assert.equal(validate({ runId: "run_example", receipt: { ...receipt, decision: "continue" } }), false);
  assert.equal(validate({ runId: "run_example", receipt: { ...receipt, recordedAt: undefined } }), false);
  assert.equal(validate({ runId: "run_example", receipt: { ...receipt, schemaVersion: undefined } }), false);
});

test("flow-mcp answers JSON-RPC request id zero", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const reader = startStdioServer({}, { input, output });
  try {
    const response = once(output, "data");
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" })}\n`);
    const [chunk] = await response;
    assert.equal(JSON.parse(chunk.toString()).id, 0);
    assert.equal(JSON.parse(chunk.toString()).result.serverInfo.name, "flow-mcp");
  } finally {
    reader.close();
    input.destroy();
    output.destroy();
  }
});
