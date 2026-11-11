import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseFlowDocument } from "../src/core/flow-document.js";
import { FileStateStore } from "../src/core/state-store.js";
import { RunService } from "../src/service/run-service.js";

// Copy of dotfiles/flows/profiles/pravaler/pr-review.yaml. Keep in sync when the flow changes.
const fixturePath = new URL("./fixtures/pr-review-flow/pr-review.yaml", import.meta.url);
const flow = parseFlowDocument(await readFile(fixturePath, "utf8"), { format: "yaml", source: "pr-review fixture" });
const node = (id) => {
  const found = flow.nodes.find((item) => item.id === id);
  assert.ok(found, `node ${id} must exist in the fixture`);
  return found;
};

const findingsNodes = ["backend_standard", "backend_deep", "frontend_standard", "frontend_deep", "design_system_standard", "design_system_deep"]
  .map((suffix) => `review_findings_${suffix}`);

const now = "2026-11-11T12:00:00Z";
const workspace = "/work/review";
const resolution = { reason: "Cause resolved.", workspace, worktreeReview: "Checked the pinned worktree.", reviewedPredecessors: true };

// Mini flow built from the REAL nodes/rules of the fixture so mutations of the YAML are observed.
async function miniRun(nodeId, { withFollowUp = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pr-review-flow-"));
  const store = new FileStateStore(directory);
  const real = node(nodeId);
  const definition = {
    id: "pr-review-mini",
    stopWhen: (flow.stopWhen ?? []).filter((rule) => rule.step === nodeId),
    nodes: [{ ...real, after: undefined, dependsOn: undefined, when: undefined }, ...(withFollowUp ? [{ id: "follow_up", after: [nodeId] }] : [])]
  };
  const service = new RunService({ stateStore: store, flowResolver: async () => ({ flowDefinition: definition }), createId: () => "run_pr-review", now: () => now });
  await service.create({ flowId: definition.id, workspace, runtime: "codex", executionMode: "guided" });
  await service.next("run_pr-review");
  const checkpoint = (output, attempt) => service.checkpoint("run_pr-review", {
    schemaVersion: "v1", runId: "run_pr-review", nodeId, status: "completed", recordedAt: now, output,
    ...(real.model ? { model: real.model, effort: real.effort ?? real.variant } : {}), ...(attempt ? { attempt } : {})
  });
  return { directory, service, checkpoint };
}

test("a) the six review_findings stop rules are resolvable via flow_continue, never flow_retry_node", () => {
  for (const nodeId of findingsNodes) {
    const rules = (flow.stopWhen ?? []).filter((rule) => rule.step === nodeId);
    assert.equal(rules.length, 1, `${nodeId} must have exactly one stop rule`);
    assert.equal(rules[0].mode, "block", `${nodeId} rule must use mode: block`);
    assert.match(rules[0].next, /flow_continue/, `${nodeId} next must mention flow_continue`);
    assert.doesNotMatch(rules[0].next, /flow_retry_node/, `${nodeId} next must not mention flow_retry_node`);
  }
});

test("a) a degraded review_findings receipt blocks the run and continue re-executes the node", async () => {
  const { directory, service, checkpoint } = await miniRun(findingsNodes[1]);
  try {
    await checkpoint({ status: "degraded", reducedConfidence: true, findings: [] });
    const blocked = await service.next("run_pr-review");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.reason, "STOP_RULE");
    const continued = await service.continueRun("run_pr-review", resolution);
    assert.deepEqual(continued.next.map((item) => [item.id, item.attempt]), [[findingsNodes[1], 2]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("b) the output JSON of the six review_findings nodes includes missingEvidence", () => {
  for (const nodeId of findingsNodes) {
    const prompt = node(nodeId).prompt;
    const schemaLine = prompt.split("Retorne somente JSON válido:").at(-1);
    assert.match(schemaLine, /"missingEvidence"\s*:/, `${nodeId} output schema must include missingEvidence`);
    assert.match(prompt, /reducedConfidence=true/, `${nodeId} must route unexecuted evidence to reducedConfidence`);
  }
});

test("b) closeout and comment_drafts carry missingEvidence into the published review", () => {
  assert.match(node("review_closeout").prompt.split("Retorne JSON:").at(-1), /"missingEvidence"\s*:/);
  assert.match(node("comment_drafts").prompt, /reviewBody DEVE listar explicitamente[\s\S]*missingEvidence/);
});

test("c) risk_triage pass without route/tier is rejected, blocked and complete pass are accepted", async () => {
  const bad = [{ status: "pass" }, { status: "pass", surface: "backend", route: "backend-low" }, { status: "pass", surface: "backend", tier: "low" }];
  for (const output of bad) {
    const { directory, checkpoint } = await miniRun("risk_triage");
    try {
      await assert.rejects(checkpoint(output), { code: "OUTPUT_SCHEMA_MISMATCH" }, JSON.stringify(output));
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const blocked = await miniRun("risk_triage");
  try { await blocked.checkpoint({ status: "blocked", missing: ["diff_recon"] }); } finally { await rm(blocked.directory, { recursive: true, force: true }); }
  const pass = await miniRun("risk_triage");
  try { await pass.checkpoint({ status: "pass", surface: "backend", tier: "low", route: "backend-low" }); } finally { await rm(pass.directory, { recursive: true, force: true }); }
});

test("c) risk_triage blocked stays resolvable through flow_continue", async () => {
  const rule = (flow.stopWhen ?? []).find((item) => item.step === "risk_triage");
  assert.equal(rule?.mode, "block");
  const { directory, service, checkpoint } = await miniRun("risk_triage");
  try {
    await checkpoint({ status: "blocked", missing: ["diff_recon"] });
    assert.equal((await service.next("run_pr-review")).reason, "STOP_RULE");
    assert.equal((await service.continueRun("run_pr-review", resolution)).next[0].attempt, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("d) publish_review transient gh error blocks and continue re-executes the node", async () => {
  const { directory, service, checkpoint } = await miniRun("publish_review");
  try {
    await checkpoint({ status: "blocked", blockedReason: "transient_error", error: "HTTP 502" });
    const blocked = await service.next("run_pr-review");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.reason, "STOP_RULE");
    assert.match(blocked.block.next, /flow_continue/);
    const continued = await service.continueRun("run_pr-review", resolution);
    assert.deepEqual(continued.next.map((item) => [item.id, item.attempt]), [["publish_review", 2]]);
    await checkpoint({ status: "pass", blockedReason: "none", reviewUrl: "https://example.test/review" }, 2);
    assert.deepEqual((await service.next("run_pr-review")).nodes.map((item) => item.id), ["follow_up"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("d) publish_review stale head is terminal: stopped and not continuable", async () => {
  const { directory, service, checkpoint } = await miniRun("publish_review");
  try {
    await checkpoint({ status: "blocked", blockedReason: "head_changed" });
    assert.equal((await service.next("run_pr-review")).status, "stopped");
    assert.equal((await service.get("run_pr-review")).status, "stopped");
    await assert.rejects(service.continueRun("run_pr-review", resolution), { code: "RUN_NOT_BLOCKED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("d) publish_review output without blockedReason is rejected so stop rules always see a value", async () => {
  const { directory, checkpoint } = await miniRun("publish_review");
  try {
    await assert.rejects(checkpoint({ status: "pass" }), { code: "OUTPUT_SCHEMA_MISMATCH" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("skeptical_validation documents PREREQ_MISSING and partial CI evidence", () => {
  const prompt = node("skeptical_validation").prompt;
  for (const needle of ["npm ci --dry-run", "npm whoami --registry", ".npmrc", "PREREQ_MISSING", "evidenceSource", "gh pr checks", "gh run view"]) {
    assert.ok(prompt.includes(needle), `skeptical_validation prompt must mention ${needle}`);
  }
  assert.match(prompt.split("Retorne somente JSON válido:").at(-1), /"reasonCode"\s*:/);
});
