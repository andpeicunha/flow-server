import assert from "node:assert/strict";
import test from "node:test";
import { RemoteFlowCatalog, contentHash } from "../src/remote/catalog.js";
import { loadRemoteReleases } from "../src/remote/release-file.js";
import { callRemoteTool, handleRemoteRequest, remoteTools } from "../src/mcp/remote-server.js";
import { createRemoteMcpHttpServer } from "../src/mcp/remote-http-server.js";

function fixture() {
  let next = 0;
  return new RemoteFlowCatalog({
    createId: () => `id${++next}`,
    now: () => "2026-10-15T12:00:00.000Z",
    releases: [{
      flowId: "sdd",
      version: "2.0.0",
      title: "SDD",
      summary: "Validate a software design document.",
      tags: ["sdd", "validate"],
      definition: { schemaVersion: "v1", nodes: [{ id: "review" }] }
    }]
  });
}

const context = { bearerToken: "a".repeat(32), authorization: `Bearer ${"a".repeat(32)}` };

test("remote catalog returns versioned definitions with deterministic hashes", () => {
  const catalog = fixture();
  const recommendation = catalog.recommend({ taskSummary: "validate SDD", tags: ["sdd"] })[0];
  assert.equal(recommendation.flowId, "sdd");
  assert.deepEqual(Object.keys(recommendation).sort(), ["flowId", "reason", "summary", "title", "version"]);
  const definition = catalog.getDefinition("sdd", "2.0.0");
  assert.equal(definition.contentHash, contentHash(definition.definition));
  assert.throws(() => catalog.getDefinition("sdd", "2.0.1"), (error) => error.code === "REMOTE_RELEASE_NOT_FOUND");
});

test("remote catalog rejects unsafe evidence and stores safe evidence only", () => {
  const catalog = fixture();
  assert.throws(() => catalog.recordEvidence({ flowId: "sdd", version: "2.0.0", eventId: "event-1", runId: "run-1", nodeId: "review", status: "failed", durationMs: 12, prompt: "secret prompt" }), (error) => error.code === "REMOTE_EVIDENCE_INVALID");
  const evidence = catalog.recordEvidence({ flowId: "sdd", version: "2.0.0", eventId: "event-1", runId: "run-1", nodeId: "review", status: "failed", durationMs: 12, errorCode: "TEST_FAILED", counters: { tests: 1 } });
  assert.deepEqual(evidence, { id: "evidence_id1", recordedAt: "2026-10-15T12:00:00.000Z" });
  assert.throws(() => catalog.recordEvidence({ flowId: "sdd", version: "2.0.0", eventId: "event-1", runId: "run-2", nodeId: "review", status: "completed", durationMs: 1 }), (error) => error.code === "REMOTE_EVIDENCE_DUPLICATE");
  assert.throws(() => catalog.recordEvidence({ flowId: "sdd", version: "2.0.0", eventId: "event-2", runId: "run-1", nodeId: "review", status: "completed", durationMs: 1 }), (error) => error.code === "REMOTE_EVIDENCE_INVALID");
});

test("analysis requires sufficient evidence and proposals remain pending review", () => {
  const catalog = fixture();
  catalog.recordEvidence({ flowId: "sdd", version: "2.0.0", eventId: "event-1", runId: "run-1", nodeId: "review", status: "failed", durationMs: 12, errorCode: "TEST_FAILED" });
  assert.deepEqual(catalog.analyze("sdd", "2.0.0"), { findings: [], evidenceIds: [] });
  catalog.recordEvidence({ flowId: "sdd", version: "2.0.0", eventId: "event-2", runId: "run-2", nodeId: "review", status: "blocked", durationMs: 20, errorCode: "MISSING_INPUT" });
  const analysis = catalog.analyze("sdd", "2.0.0");
  assert.equal(analysis.findings[0].kind, "node-reliability");
  const proposal = catalog.recordProposal({ analysisId: analysis.id, kind: "node-reliability" });
  assert.equal(proposal.status, "pending_review");
  assert.equal(proposal.flowId, "sdd");
});

test("remote MCP requires bearer authentication and exposes only bounded tools", async () => {
  const catalog = fixture();
  assert.deepEqual(remoteTools.map((tool) => tool.name), ["flow_recommend", "flow_get_definition", "flow_record_run_evidence", "flow_list_runs", "flow_get_run_evidence", "flow_analyze_flow", "flow_record_improvement_proposal"]);
  const denied = await callRemoteTool(catalog, "flow_recommend", { taskSummary: "sdd" }, { bearerToken: context.bearerToken });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /REMOTE_MCP_UNAUTHORIZED/);
  const allowed = await callRemoteTool(catalog, "flow_recommend", { taskSummary: "validate SDD" }, context);
  assert.equal(allowed.structuredContent[0].flowId, "sdd");
  const initialized = await handleRemoteRequest(catalog, { method: "initialize" }, context);
  assert.equal(initialized.serverInfo.name, "flow-remote-mcp");
});

test("remote catalog loads releases only from an explicit JSON catalog file", async () => {
  const releases = await loadRemoteReleases("/catalog.json", { fs: { readFile: async () => JSON.stringify({ releases: [{ flowId: "sdd" }] }) } });
  assert.deepEqual(releases, [{ flowId: "sdd" }]);
  await assert.rejects(loadRemoteReleases("catalog.yaml"), (error) => error.code === "REMOTE_CATALOG_FILE_INVALID");
});

test("remote HTTP transport accepts only authenticated non-browser MCP requests", async () => {
  const server = createRemoteMcpHttpServer({ catalog: fixture(), bearerToken: context.bearerToken });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
    const denied = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "flow_recommend", arguments: { taskSummary: "sdd" } } }) });
    assert.equal((await denied.json()).result.isError, true);
    const allowed = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: context.authorization }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "flow_recommend", arguments: { taskSummary: "validate sdd" } } }) });
    assert.equal((await allowed.json()).result.structuredContent[0].flowId, "sdd");
    const browser = await fetch(endpoint, { method: "POST", headers: { origin: "https://example.test" }, body: "{}" });
    assert.equal(browser.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
