import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalToken } from "../src/core/local-token.js";
import { FileStateStore } from "../src/core/state-store.js";
import { LocalFlowClient } from "../src/mcp/local-client.js";
import { callTool, handleRequest, tools } from "../src/mcp/server.js";
import { createHttpServer } from "../src/service/http-server.js";
import { RunService } from "../src/service/run-service.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flow-mcp-test-"));
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ token, runService: new RunService({ stateStore: new FileStateStore(directory), createId: () => "run_mcp", now: () => "2026-01-01T00:00:00.000Z" }), serviceInfo: () => ({ status: "ready" }) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new FileStateStore(directory).writeJson(join(directory, "service.json"), { endpoint: `http://127.0.0.1:${port}` });
  return { directory, server, client: new LocalFlowClient({ stateDir: directory, idempotencyKey: () => "mcp-idempotency-key-001" }) };
}

test("flow-mcp uses only the local service for guided runs and audits", async () => {
  const context = await fixture();
  try {
    assert.deepEqual(await context.client.list(), { items: [], nextCursor: null });
    const started = await context.client.startGuided({ flowId: "hello-flow", workspace: "/workspace", runtime: "codex" });
    assert.equal(started.id, "run_mcp");
    assert.equal((await context.client.inspect("run_mcp")).executionMode, "guided");
    assert.equal((await context.client.audit("run_mcp")).result, "passed");
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("flow-mcp advertises a bounded tool set and fails unavailable actions closed", async () => {
  assert.deepEqual(tools.map((tool) => tool.name), ["flow_list", "flow_inspect", "flow_start_guided", "flow_next", "flow_checkpoint", "flow_audit", "flow_open"]);
  const initialized = await handleRequest({}, { method: "initialize" });
  assert.equal(initialized.serverInfo.name, "flow-mcp");
  const unavailable = await callTool({}, "flow_next", { runId: "run_test" });
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /MCP_OPERATION_UNAVAILABLE/);
});
