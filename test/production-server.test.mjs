import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { assertHealthyMcp, mcpRequest, rpc, startProductionServer, token } from "./production-server-helpers.mjs";

test("production MCP serves health, initialize, and bounded catalog tools", async (t) => {
  const service = await startProductionServer();
  t.after(() => service.stop());
  await assertHealthyMcp(service.endpoint);

  const listed = await mcpRequest(service.endpoint, rpc("tools/list", {}));
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), ["flow_recommend", "flow_get_definition", "flow_record_run_evidence", "flow_list_runs", "flow_get_run_evidence", "flow_analyze_flow", "flow_record_improvement_proposal"]);

  const recommended = await mcpRequest(service.endpoint, rpc("tools/call", { name: "flow_recommend", arguments: { taskSummary: "validate an SDD", tags: ["sdd"] } }));
  assert.equal(recommended.body.result.structuredContent.items[0].flowId, "sdd");
  const definition = await mcpRequest(service.endpoint, rpc("tools/call", { name: "flow_get_definition", arguments: { flowId: "sdd", version: "2.0.0" } }));
  assert.equal(definition.body.result.structuredContent.definition.nodes[0].id, "review");

  await new Promise((resolve) => setTimeout(resolve, 20));
  const log = service.output.join("");
  assert.match(log, /"action":"flow_recommend"/);
  assert.doesNotMatch(log, new RegExp(token));
  assert.doesNotMatch(log, /validate an SDD/);
});

test("production MCP rejects unauthenticated, invalid, and unsafe requests without catalog data", async (t) => {
  const service = await startProductionServer();
  t.after(() => service.stop());
  const missing = await mcpRequest(service.endpoint, rpc("tools/call", { name: "flow_recommend", arguments: { taskSummary: "sdd" } }), { bearer: null });
  assert.equal(missing.response.status, 401);
  assert.equal(missing.response.headers.get("www-authenticate"), "Bearer");
  assert.deepEqual(missing.body, { error: "Authentication is required." });

  const invalid = await mcpRequest(service.endpoint, rpc("tools/call", { name: "flow_recommend", arguments: { taskSummary: "sdd" } }), { bearer: "wrong-token" });
  assert.equal(invalid.response.status, 401);
  assert.equal(invalid.response.headers.get("www-authenticate"), "Bearer");

  const unsafe = await mcpRequest(service.endpoint, rpc("tools/call", { name: "flow_record_run_evidence", arguments: { flowId: "sdd", version: "2.0.0", eventId: "event-1", runId: "run-1", nodeId: "review", status: "completed", durationMs: 1, prompt: "must-not-be-accepted" } }));
  assert.equal(unsafe.body.result.isError, true);
  assert.doesNotMatch(JSON.stringify(unsafe.body), /must-not-be-accepted/);
  const runs = await mcpRequest(service.endpoint, rpc("tools/call", { name: "flow_list_runs", arguments: { flowId: "sdd", version: "2.0.0" } }));
  assert.deepEqual(runs.body.result.structuredContent.items, []);
});

test("production MCP exposes OAuth protected-resource metadata and its challenge without a tenant", async (t) => {
  const service = await startProductionServer({ OAUTH_ISSUER: "https://auth.example.test", OAUTH_RESOURCE: "https://mcp.example.test/mcp", OAUTH_ALLOWED_SUBJECTS: "test-user", MCP_ALLOWED_HOST: "mcp.example.test" });
  t.after(() => service.stop());
  const metadata = await fetch(`${service.endpoint}/.well-known/oauth-protected-resource/mcp`);
  assert.deepEqual(await metadata.json(), { resource: "https://mcp.example.test/mcp", authorization_servers: ["https://auth.example.test"], bearer_methods_supported: ["header"] });
  const denied = await mcpRequest(service.endpoint, rpc("tools/list", {}), { bearer: null });
  assert.equal(denied.response.headers.get("www-authenticate"), 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"');
});

test("production MCP enforces allowed hosts and the per-actor request limit", async (t) => {
  const service = await startProductionServer();
  t.after(() => service.stop());
  const endpoint = new URL(service.endpoint);
  const deniedHost = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: endpoint.hostname, port: endpoint.port, path: "/healthz", headers: { host: "untrusted.example.test" } }, (response) => resolve(response));
    request.once("error", reject);
    request.end();
  });
  assert.equal(deniedHost.statusCode, 403);

  const request = rpc("tools/list", {});
  for (let index = 0; index < 60; index += 1) {
    const result = await mcpRequest(service.endpoint, request, { headers: { host: "127.0.0.1" } });
    assert.equal(result.response.status, 200);
  }
  const limited = await mcpRequest(service.endpoint, request);
  assert.equal(limited.response.status, 401);
  assert.equal(limited.response.headers.get("www-authenticate"), "Bearer");
});
