import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileStateStore } from "../src/core/state-store.js";
import { FlowSourceService } from "../src/service/flow-source-service.js";
import { RunService } from "../src/service/run-service.js";

const workspace = "/work/execution-profiles";
const at = "2026-11-05T17:00:00Z";
const flow = { id: "profile-flow", nodes: [
  { id: "preflight", agent: "explorer", model: "anthropic/claude-sonnet", variant: "low" },
  { id: "build", after: ["preflight"], agent: "builder", model: "anthropic/claude-sonnet", variant: "medium" },
  { id: "verify", after: ["build"], agent: "test-auditor", model: "anthropic/claude-sonnet", variant: "medium" }
] };
const profiles = [
  { id: "claude", name: "Claude", runtime: "claude" },
  { id: "codex", name: "Codex", runtime: "codex", models: { "anthropic/claude-sonnet": "openai/gpt-6.1-terra" } }
];

async function fixture({ defaultProfileId = "claude" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "flow-execution-profiles-"));
  const sourcePath = join(directory, "flows");
  await mkdir(sourcePath);
  await writeFile(join(sourcePath, "profile-flow.json"), JSON.stringify({ schemaVersion: "v1", ...flow }));
  const sourceConfig = join(directory, "sources.json");
  await writeFile(sourceConfig, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "work", mode: "local", path: sourcePath,
    sync: { pull: "confirm", push: "manual" }, execution: { ...(defaultProfileId ? { defaultProfileId } : {}), profiles } }] }));
  const sourceService = new FlowSourceService({ configPath: sourceConfig });
  await sourceService.initialize();
  const stateStore = new FileStateStore(join(directory, "state"));
  let runNumber = 0;
  const runService = new RunService({ stateStore, flowResolver: (selection) => sourceService.resolve(selection),
    createId: () => `run_p${++runNumber}`, now: () => at });
  return { directory, sourceService, stateStore, runService };
}

function receipt(runId, nodeId, runtime, model, attempt = 1) {
  return { schemaVersion: "v1", runId, nodeId, status: "completed", recordedAt: at, runtime, model,
    effort: nodeId === "preflight" ? "low" : "medium", attempt };
}

test("same source supports concurrent runs with independent execution profiles", async () => {
  const { directory, sourceService, runService } = await fixture();
  try {
    const selection = await sourceService.selectFlow({ flowId: flow.id, profileId: "work", workspace });
    assert.deepEqual(selection.executionProfiles, [{ id: "claude", name: "Claude", runtime: "claude" }, { id: "codex", name: "Codex", runtime: "codex" }]);
    const [claudeRun, codexRun] = await Promise.all([
      runService.create({ flowId: flow.id, profileId: "work", workspace, executionProfileId: "claude", executionMode: "guided" }),
      runService.create({ flowId: flow.id, profileId: "work", workspace, executionProfileId: "codex", executionMode: "guided" })
    ]);
    assert.equal(claudeRun.runtime, "claude");
    assert.equal(codexRun.runtime, "codex");
    assert.equal(claudeRun.executionProfileId, "claude");
    assert.equal(codexRun.executionProfileId, "codex");
    const [claudeNext, codexNext] = await Promise.all([runService.next(claudeRun.id), runService.next(codexRun.id)]);
    assert.deepEqual([claudeNext.nodes[0].runtime, claudeNext.nodes[0].model], ["claude", "anthropic/claude-sonnet"]);
    assert.deepEqual([codexNext.nodes[0].runtime, codexNext.nodes[0].model], ["codex", "openai/gpt-6.1-terra"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rate-limit profile switch updates the blocked and all remaining nodes", async () => {
  const { directory, stateStore, runService } = await fixture();
  try {
    const run = await runService.create({ flowId: flow.id, profileId: "work", workspace, executionProfileId: "claude", executionMode: "guided" });
    await runService.next(run.id);
    await runService.checkpoint(run.id, receipt(run.id, "preflight", "claude", "anthropic/claude-sonnet"));
    await runService.next(run.id);
    await runService.block(run.id, { nodeId: "build", reasonCode: "RATE_LIMIT", reason: "Claude rate limit reached." });

    const context = await runService.retryContext(run.id, "build");
    assert.deepEqual(context.availableExecutionProfiles.map(({ id }) => id), ["claude", "codex"]);
    const switched = await runService.switchNode(run.id, { nodeId: "build", executionProfileId: "codex", reason: "Continue with Codex.",
      workspace, worktreeReview: "Reviewed the pinned worktree and build predecessor receipt.", reviewedPredecessors: true });
    assert.equal(switched.id, run.id);
    assert.equal(switched.runtime, "codex");
    assert.equal(switched.executionProfileId, "codex");
    assert.deepEqual([switched.next[0].runtime, switched.next[0].model, switched.next[0].attempt], ["codex", "openai/gpt-6.1-terra", 2]);
    const prior = (await stateStore.listReceipts(run.id)).find((item) => item.nodeId === "preflight");
    assert.equal(prior.runtime, "claude");

    await runService.checkpoint(run.id, receipt(run.id, "build", "codex", "openai/gpt-6.1-terra", 2));
    const next = await runService.next(run.id);
    assert.deepEqual([next.nodes[0].runtime, next.nodes[0].model, next.nodes[0].attempt], ["codex", "openai/gpt-6.1-terra", 1]);
    const audit = await runService.audit(run.id);
    assert.equal(audit.executionHistory[0].from.profileId, "claude");
    assert.equal(audit.executionHistory[0].to.profileId, "codex");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("multiple profiles require an explicit selection when no default exists", async () => {
  const { directory, sourceService } = await fixture({ defaultProfileId: null });
  try {
    await assert.rejects(sourceService.resolve({ flowId: flow.id, profileId: "work" }), { code: "EXECUTION_PROFILE_REQUIRED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
