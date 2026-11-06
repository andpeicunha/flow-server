import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileStateStore } from "../src/core/state-store.js";
import { validateFlowDocument } from "../src/core/flow-document.js";
import { RunService } from "../src/service/run-service.js";

const timestamp = "2026-11-06T12:00:00.000Z";
const fingerprint = { canonicalWorkspace: "/work/project", head: "a".repeat(40), worktreeHash: "b".repeat(64), openSpecHash: "c".repeat(64), contextHash: "d".repeat(64) };

async function fixture(flow) {
  const directory = await mkdtemp(join(tmpdir(), "flow-token-efficiency-"));
  const stateStore = new FileStateStore(join(directory, "state"));
  let nextId = 0;
  const runService = new RunService({
    stateStore,
    now: () => timestamp,
    createId: () => `run_efficiency${++nextId}`,
    getWorkspaceFingerprint: async () => fingerprint,
    flowResolver: async () => ({ runtime: "codex", profileId: "personal", flowDefinition: flow,
      flowContentHash: "e".repeat(64), flowGitCommit: "f".repeat(40) })
  });
  return { directory, stateStore, runService };
}

function receipt(runId, nodeId, output) {
  return { schemaVersion: "v1", runId, nodeId, status: "completed", recordedAt: timestamp, output };
}

test("report references keep full content out of later prompts and audit detects tampering", async () => {
  const flow = { schemaVersion: "v1", id: "reports", nodes: [
    { id: "research", reusable: true, prompt: "Research {{task}}" },
    { id: "summary", after: ["research"], prompt: "Summarize {{step.research}}" }
  ] };
  const context = await fixture(flow);
  try {
    const run = await context.runService.create({ flowId: flow.id, workspace: "/work/project", executionMode: "guided", task: "Inspect the feature" });
    assert.equal((await context.runService.next(run.id)).nodes[0].id, "research");
    await assert.rejects(context.runService.writeReport(run.id, "summary", { premature: true }), (error) => error.code === "NODE_NOT_READY");
    const report = { finding: "private full detail", data: "complete evidence" };
    const reference = await context.runService.writeReport(run.id, "research", report);
    await assert.rejects(context.runService.readReport(run.id, "research"), (error) => error.code === "REPORT_NOT_FOUND");
    await assert.rejects(context.runService.checkpoint(run.id, receipt(run.id, "research", { summary: "One finding.", reportPath: reference.reportPath, reportSha256: "0".repeat(64) })),
      (error) => error.code === "REPORT_HASH_MISMATCH");
    await context.runService.checkpoint(run.id, receipt(run.id, "research", { summary: "One finding.", ...reference }));
    const next = await context.runService.next(run.id);
    assert.equal(next.nodes[0].id, "summary");
    assert.match(next.nodes[0].prompt, /One finding/);
    assert.match(next.nodes[0].prompt, /reportAvailableOnRequest/);
    assert.doesNotMatch(next.nodes[0].prompt, /private full detail/);
    await context.runService.checkpoint(run.id, receipt(run.id, "summary", { done: true }));
    await context.runService.next(run.id);

    const reportPath = join(context.directory, "state", "runs", run.id, "reports", "research.json");
    await writeFile(reportPath, JSON.stringify({ finding: "tampered" }));
    const audit = await context.runService.audit(run.id);
    assert.equal(audit.findings.some((finding) => finding.code === "REPORT_HASH_MISMATCH"), true);
  } finally { await rm(context.directory, { recursive: true, force: true }); }
});

test("reuse copies explicitly reusable receipts and reports only for matching context", async () => {
  const flow = { schemaVersion: "v1", id: "reuse", nodes: [{ id: "analysis", reusable: true }] };
  const context = await fixture(flow);
  try {
    const source = await context.runService.create({ flowId: flow.id, workspace: "/work/project", executionMode: "guided", task: "Same task" });
    await context.runService.next(source.id);
    const reference = await context.runService.writeReport(source.id, "analysis", { evidence: ["complete"] });
    await context.runService.checkpoint(source.id, receipt(source.id, "analysis", { summary: "Reviewed.", ...reference }));
    await context.runService.next(source.id);

    const target = await context.runService.create({ flowId: flow.id, workspace: "/work/project", executionMode: "guided", task: "Same task",
      reuseFromRunId: source.id, reuseNodeIds: ["analysis"] });
    const [copied] = await context.stateStore.listReceipts(target.id);
    assert.equal(copied.reusedFrom.runId, source.id);
    assert.equal(copied.output.reportSha256, reference.reportSha256);
    assert.deepEqual((await context.stateStore.readReport(target.id, copied.output.reportPath)).report, { evidence: ["complete"] });

    await assert.rejects(context.runService.create({ flowId: flow.id, workspace: "/work/project", executionMode: "guided", task: "Changed task",
      reuseFromRunId: source.id, reuseNodeIds: ["analysis"] }), (error) => error.code === "REUSE_CONTEXT_MISMATCH");
  } finally { await rm(context.directory, { recursive: true, force: true }); }
});

test("optional output schema rejects invalid checkpoint output and skill support is reported", async () => {
  const flow = { schemaVersion: "v1", id: "schema", nodes: [{ id: "work", skills: ["review"], outputSchema: {
    type: "object", required: ["ok"], properties: { ok: { type: "boolean" } }, additionalProperties: false
  } }] };
  assert.equal(validateFlowDocument(flow).nodes[0].outputSchema.type, "object");
  assert.throws(() => validateFlowDocument({ ...flow, nodes: [{ ...flow.nodes[0], outputSchema: { type: "nonsense" } }] }));
  const context = await fixture(flow);
  try {
    const run = await context.runService.create({ flowId: flow.id, workspace: "/work/project", executionMode: "guided" });
    const ready = await context.runService.next(run.id);
    assert.equal(ready.nodes[0].skillWarnings[0].code, "SKILL_TOOL_CAPABILITY_UNVERIFIED");
    await assert.rejects(context.runService.checkpoint(run.id, receipt(run.id, "work", { ok: "yes" })), (error) => error.code === "OUTPUT_SCHEMA_MISMATCH");
    await context.runService.checkpoint(run.id, receipt(run.id, "work", { ok: true }));
    await context.runService.next(run.id);
  } finally { await rm(context.directory, { recursive: true, force: true }); }
});

test("flow document rejects unsupported Skill capability declarations", () => {
  const flow = { schemaVersion: "v1", id: "capabilities", nodes: [{ id: "work", skillToolSupport: { codex: "yes" } }] };
  assert.throws(() => validateFlowDocument(flow));
});
