import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateFlowSourceConfig } from "../src/core/flow-source-config.js";
import { FileStateStore } from "../src/core/state-store.js";
import { LocalToken } from "../src/core/local-token.js";
import { LocalFlowClient } from "../src/mcp/local-client.js";
import { FlowSourceService } from "../src/service/flow-source-service.js";
import { createHttpServer } from "../src/service/http-server.js";
import { RunService } from "../src/service/run-service.js";

const now = "2026-11-03T18:00:00Z";
const workspace = "/work/feature";
const fallback = { runtime: "codex", models: {
  "anthropic/claude-sonnet-5-5": "openai/gpt-6.1-terra",
  "anthropic/claude-opus-5-5": "openai/gpt-6.1-sol"
}, agents: { explorer: { model: "openai/gpt-6-luna", effort: "low" } } };
const flow = { id: "sample", nodes: [
  { id: "preflight", agent: "explorer", model: "anthropic/claude-sonnet-5-5", variant: "low" },
  { id: "build", after: ["preflight"], agent: "builder", model: "anthropic/claude-sonnet-5-5", variant: "medium" },
  { id: "verify", after: ["build"], agent: "test-auditor", model: "anthropic/claude-opus-5-5", variant: "medium" }
] };
const receipt = (nodeId, model, runtime, attempt = 1) => ({ schemaVersion: "v1", runId: "run_fallback", nodeId,
  status: "completed", recordedAt: now, model, runtime, effort: nodeId === "preflight" ? "low" : "medium", attempt });

test("fallback config is scoped to one source and rejects unsafe mappings", () => {
  const source = { id: "work", mode: "local", path: "/flows/work", sync: { pull: "confirm", push: "manual" },
    execution: { runtime: "claude", fallback } };
  const config = validateFlowSourceConfig({ schemaVersion: "v1", sources: [source,
    { id: "personal", mode: "local", path: "/flows/personal", sync: { pull: "confirm", push: "manual" }, execution: { runtime: "codex" } }] });
  assert.equal(config.sources[0].execution.fallback.agents.explorer.model, "openai/gpt-6-luna");
  assert.equal(config.sources[1].execution.fallback, undefined);
  for (const bad of [
    { ...fallback, runtime: "claude" },
    { ...fallback, models: { "anthropic/claude-sonnet-5-5": "anthropic/claude-opus-5-5" } },
    { ...fallback, agents: { explorer: { model: "openai/gpt-6-luna", effort: "invalid" } } }
  ]) assert.throws(() => validateFlowSourceConfig({ schemaVersion: "v1", sources: [{ ...source, execution: { runtime: "claude", fallback: bad } }] }), { code: "INVALID_FLOW_SOURCE_CONFIG" });
});

test("a source pins mapped fallback models per node without changing the YAML", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-fallback-source-"));
  try {
    const flows = join(directory, "flows");
    await mkdir(flows);
    await writeFile(join(flows, "sample.json"), JSON.stringify({ schemaVersion: "v1", ...flow }));
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "work", mode: "local", path: flows,
      sync: { pull: "confirm", push: "manual" }, execution: { runtime: "claude", fallback } }] }));
    const source = new FlowSourceService({ configPath });
    await source.initialize();
    const resolved = await source.resolve({ flowId: "sample", profileId: "work" });
    assert.equal(resolved.flowDefinition.nodes[0].model, "anthropic/claude-sonnet-5-5");
    assert.equal(resolved.fallbackExecutions.preflight.model, "openai/gpt-6-luna");
    assert.equal(resolved.fallbackExecutions.build.model, "openai/gpt-6.1-terra");
    assert.equal(resolved.fallbackExecutions.verify.model, "openai/gpt-6.1-sol");
    assert.equal((await source.catalog.listEntries())[0].flow.nodes[0].model, "anthropic/claude-sonnet-5-5");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function fixture(withFallback = true) {
  const directory = await mkdtemp(join(tmpdir(), "flow-model-fallback-"));
  const store = new FileStateStore(directory);
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: flow,
    ...(withFallback ? { fallbackExecutions: {
      preflight: { runtime: "codex", model: "openai/gpt-6-luna", effort: "low" },
      build: { runtime: "codex", model: "openai/gpt-6.1-terra", effort: "medium" },
      verify: { runtime: "codex", model: "openai/gpt-6.1-sol", effort: "medium" }
    } } : {}) }), createId: () => "run_fallback", now: () => now });
  await service.create({ flowId: flow.id, workspace, runtime: "claude", executionMode: "guided" });
  return { directory, store, service };
}

test("a rate limit switches only the pending node and pins its new model", async () => {
  const { directory, store, service } = await fixture();
  try {
    assert.equal((await service.next("run_fallback")).nodes[0].runtime, "claude");
    await service.checkpoint("run_fallback", receipt("preflight", "anthropic/claude-sonnet-5-5", "claude"));
    assert.equal((await service.next("run_fallback")).nodes[0].model, "anthropic/claude-sonnet-5-5");
    await service.block("run_fallback", { nodeId: "build", reasonCode: "RATE_LIMIT", reason: "Claude usage limit reached." });
    await assert.rejects(service.continueRun("run_fallback", { reason: "Try again." }), { code: "FALLBACK_SELECTION_REQUIRED" });
    await assert.rejects(service.switchNode("run_fallback", { nodeId: "build", reason: "Use Codex.", workspace: "/work/other", worktreeReview: "Checked changed files.", reviewedPredecessors: true }), { code: "RETRY_WORKSPACE_MISMATCH" });
    const switched = await service.switchNode("run_fallback", { nodeId: "build", reason: "Claude is rate limited.", workspace, worktreeReview: "Checked changed files and the preflight receipt.", reviewedPredecessors: true });
    assert.equal(switched.next[0].model, "openai/gpt-6.1-terra");
    assert.equal(switched.next[0].runtime, "codex");
    assert.equal(switched.next[0].attempt, 2);
    assert.equal((await service.next("run_fallback")).nodes[0].model, "openai/gpt-6.1-terra");
    await assert.rejects(service.checkpoint("run_fallback", receipt("build", "anthropic/claude-sonnet-5-5", "claude", 2)), { code: "NODE_RUNTIME_MISMATCH" });
    await assert.rejects(service.checkpoint("run_fallback", receipt("build", "openai/gpt-6.1-terra", "codex")), { code: "RETRY_ATTEMPT_REQUIRED" });
    await service.checkpoint("run_fallback", receipt("build", "openai/gpt-6.1-terra", "codex", 2));
    assert.equal((await service.next("run_fallback")).nodes[0].model, "anthropic/claude-opus-5-5");
    const run = await store.readRun("run_fallback");
    assert.equal(run.executionHistory[0].from.runtime, "claude");
    assert.equal(run.executionHistory[0].to.runtime, "codex");
    assert.equal((await service.audit("run_fallback")).executionHistory.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a run without configured fallback cannot switch providers", async () => {
  const { directory, service } = await fixture(false);
  try {
    await service.next("run_fallback");
    await service.block("run_fallback", { nodeId: "preflight", reasonCode: "RATE_LIMIT", reason: "Provider limit reached." });
    await assert.rejects(service.switchNode("run_fallback", { nodeId: "preflight", reason: "Try another provider.", workspace, worktreeReview: "Checked worktree.", reviewedPredecessors: true }), { code: "FALLBACK_NOT_CONFIGURED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("HTTP and MCP allow only the authenticated, reviewed fallback switch", async () => {
  const { directory, store, service } = await fixture();
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  await token.loadOrCreate();
  const server = createHttpServer({ runService: service, token, serviceInfo: () => ({ status: "ready" }) });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    await store.writeJson(join(directory, "service.json"), { endpoint });
    const client = new LocalFlowClient({ stateDir: directory });
    await client.next("run_fallback");
    await client.block("run_fallback", { nodeId: "preflight", reasonCode: "RATE_LIMIT", reason: "Claude limit reached." });
    const review = { nodeId: "preflight", reason: "Switch after limit.", workspace, worktreeReview: "Checked the unchanged worktree.", reviewedPredecessors: true };
    const denied = await fetch(`${endpoint}/v1/runs/run_fallback/switch-runtime`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "unauthorized-fallback-001" }, body: JSON.stringify(review) });
    assert.equal(denied.status, 401);
    assert.equal((await client.retryInspect("run_fallback", "preflight")).fallbackExecution.model, "openai/gpt-6-luna");
    const switched = await client.switchRuntime("run_fallback", review);
    assert.deepEqual([switched.next[0].runtime, switched.next[0].model, switched.next[0].attempt], ["codex", "openai/gpt-6-luna", 2]);
    await assert.rejects(client.switchRuntime("run_fallback", review), { code: "FALLBACK_NOT_BLOCKED" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
