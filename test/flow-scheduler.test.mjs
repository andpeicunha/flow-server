import assert from "node:assert/strict";
import test from "node:test";
import { planFlowNext } from "../src/service/flow-scheduler.js";
import { RunService } from "../src/service/run-service.js";

const flow = {
  schemaVersion: "v2", id: "task-flow", title: "Task flow",
  stopWhen: [{ step: "intake", jsonPath: "decision", notEquals: "continue", status: "needs_confirmation", next: "ask the developer" }],
  nodes: [
    { id: "intake", agent: "oracle", model: "provider/fast", variant: "low", executor: "cli-session", skills: ["intake-skill"], prompt: "Classify {{task}}" },
    { id: "feature_work", after: ["intake"], when: { step: "intake", jsonPath: "branch", in: ["feature"] }, agent: "builder", model: "provider/strong", effort: "medium", skills: ["build-skill"], constraints: ["stay in scope"], prompt: "Task: {{task}}\nIntake: {{step.intake}}", output: "Return a concise result" },
    { id: "bug_work", after: ["intake"], when: { step: "intake", jsonPath: "branch", in: ["bug"] }, agent: "fixer", effort: "custom-effort-mode", skills: Array.from({ length: 40 }, (_value, index) => `skill-${index}`), prompt: "Fix the bug" }
  ]
};

const completed = (nodeId, output) => ({ schemaVersion: "v1", runId: "run_test", nodeId, status: "completed", recordedAt: "2026-01-01T00:00:00.000Z", output });

test("flow scheduler returns configured node guidance and marks conditional branches skipped", () => {
  const result = planFlowNext(flow, { task: "Add a field" }, [completed("intake", { decision: "continue", branch: "feature" })]);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.nodes.map(({ id }) => id), ["feature_work"]);
  assert.equal(result.nodes[0].agent, "builder");
  assert.equal(result.nodes[0].model, "provider/strong");
  assert.equal(result.nodes[0].effort, "medium");
  assert.deepEqual(result.nodes[0].skills, ["build-skill"]);
  assert.match(result.nodes[0].prompt, /Task: Add a field/);
  assert.match(result.nodes[0].prompt, /\"branch\": \"feature\"/);
  assert.deepEqual(result.skipped.map(({ nodeId }) => nodeId), ["bug_work"]);
});

test("flow scheduler blocks missing conditional output and honors stop rules", () => {
  const missing = planFlowNext(flow, { task: "task" }, [completed("intake", { decision: "continue" })]);
  assert.equal(missing.status, "blocked");
  assert.equal(missing.reason, "CONDITION_OUTPUT_MISSING");

  const stopped = planFlowNext(flow, { task: "task" }, [completed("intake", { decision: "blocked", branch: "feature" })]);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.stop.status, "needs_confirmation");
});

test("conditional skips satisfy joins and context carries completed node outputs", () => {
  const branching = {
    nodes: [
      { id: "intake" },
      { id: "backend", after: ["intake"], when: { step: "intake", jsonPath: "target", in: ["backend"] } },
      { id: "frontend", after: ["intake"], when: { step: "intake", jsonPath: "target", in: ["frontend"] } },
      { id: "validate", after: ["backend", "frontend"], prompt: "Context: {{context}}\nLatest: {{lastAnswer}}" }
    ]
  };
  const result = planFlowNext(branching, {}, [completed("intake", { target: "backend" }), completed("backend", { status: "pass" })]);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.nodes.map(({ id }) => id), ["validate"]);
  assert.match(result.nodes[0].prompt, /## intake/);
  assert.match(result.nodes[0].prompt, /## backend/);
  assert.match(result.nodes[0].prompt, /"status": "pass"/);
  assert.deepEqual(result.skipped.map(({ nodeId }) => nodeId), ["frontend"]);
});

test("real SDD branch comparisons ignore case and skipped branches do not trigger stop rules", () => {
  const branching = {
    stopWhen: [
      { step: "backend", jsonPath: "status", notEquals: "pass", status: "backend_failed", next: "fix backend" },
      { step: "frontend", jsonPath: "status", notEquals: "pass", status: "frontend_failed", next: "fix frontend" }
    ],
    nodes: [
      { id: "execution_mode" },
      { id: "backend", after: ["execution_mode"], when: { step: "execution_mode", jsonPath: "runBranch", in: ["backend"] } },
      { id: "frontend", after: ["execution_mode"], when: { step: "execution_mode", jsonPath: "runBranch", in: ["frontend"] } },
      { id: "implementation_validation", after: ["backend", "frontend"] }
    ]
  };
  const intake = completed("execution_mode", { runBranch: "BACKEND" });
  const first = planFlowNext(branching, {}, [intake]);
  assert.equal(first.status, "ready");
  assert.deepEqual(first.nodes.map(({ id }) => id), ["backend"]);
  assert.deepEqual(first.skipped.map(({ nodeId }) => nodeId), ["frontend"]);
  const afterImplementation = planFlowNext(branching, {}, [intake, completed("backend", { status: "PASS" }), { nodeId: "frontend", status: "skipped" }]);
  assert.equal(afterImplementation.status, "ready");
  assert.deepEqual(afterImplementation.nodes.map(({ id }) => id), ["implementation_validation"]);
});

test("RunService persists deterministic skipped-node receipts before returning ready work", async () => {
  let run;
  const receipts = new Map();
  const stateStore = {
    writeRun: async (value) => { run = value; },
    readRun: async () => run,
    listReceipts: async () => [...receipts.values()],
    writeReceipt: async (receipt) => { receipts.set(receipt.nodeId, receipt); }
  };
  const service = new RunService({ stateStore, flowResolver: async () => ({ profileId: "personal", flowSourceId: "personal", flowDefinition: flow }), createId: () => "run_test", now: () => "2026-01-01T00:00:00.000Z" });
  await service.create({ flowId: flow.id, profileId: "personal", workspace: "/workspace", runtime: "codex", executionMode: "guided" });
  assert.equal(run.status, "created");
  receipts.set("intake", completed("intake", { decision: "continue", branch: "feature" }));
  const next = await service.next("run_test");
  assert.equal(next.status, "ready");
  assert.deepEqual(next.skipped, ["bug_work"]);
  assert.equal(receipts.get("bug_work").status, "skipped");
  assert.equal(receipts.get("bug_work").agent, undefined);
  assert.equal(receipts.get("bug_work").skills, undefined);
  assert.equal(next.nodes[0].agent, "builder");
});

test("RunService starts on first next, completes when all nodes are done, and holds pause", async () => {
  let run;
  const receipts = new Map();
  const stateStore = {
    writeRun: async (value) => { run = value; },
    readRun: async () => run,
    listReceipts: async () => [...receipts.values()],
    writeReceipt: async (receipt) => { receipts.set(receipt.nodeId, receipt); }
  };
  const service = new RunService({ stateStore, flowResolver: async () => ({ flowDefinition: { id: "single", nodes: [{ id: "work" }] } }), createId: () => "run_test", now: () => "2026-01-01T00:00:00.000Z" });
  await service.create({ flowId: "single", workspace: "/workspace", runtime: "codex", executionMode: "guided", task: "Do the work" });
  assert.equal(run.task, "Do the work");
  assert.equal((await service.next("run_test")).status, "ready");
  assert.equal(run.status, "running");
  await service.transition("run_test", "pause");
  assert.equal((await service.next("run_test")).reason, "RUN_PAUSED");
  await assert.rejects(service.checkpoint("run_test", { schemaVersion: "v1", runId: "run_test", nodeId: "work", status: "completed", recordedAt: "2026-01-01T00:00:00.000Z" }), { code: "RUN_PAUSED" });
  await service.transition("run_test", "resume");
  await service.checkpoint("run_test", { schemaVersion: "v1", runId: "run_test", nodeId: "work", status: "completed", recordedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal((await service.next("run_test")).status, "done");
  assert.equal(run.status, "completed");
});

test("RunService rejects receipts for nodes that bypass dependencies or conditions", async () => {
  let run;
  const receipts = new Map();
  const stateStore = {
    writeRun: async (value) => { run = value; },
    readRun: async () => run,
    listReceipts: async () => [...receipts.values()],
    writeReceipt: async (receipt) => { receipts.set(receipt.nodeId, receipt); }
  };
  const service = new RunService({ stateStore, flowResolver: async () => ({ profileId: "personal", flowSourceId: "personal", flowDefinition: flow }), createId: () => "run_test", now: () => "2026-01-01T00:00:00.000Z" });
  await service.create({ flowId: flow.id, profileId: "personal", workspace: "/workspace", runtime: "codex", executionMode: "guided" });
  const outOfOrder = { schemaVersion: "v1", runId: "run_test", nodeId: "feature_work", status: "completed", recordedAt: "2026-01-01T00:00:00.000Z" };
  await assert.rejects(service.checkpoint("run_test", outOfOrder), (error) => error.code === "NODE_NOT_READY");
  const skipped = { ...outOfOrder, nodeId: "intake", status: "skipped" };
  await assert.rejects(service.checkpoint("run_test", skipped), (error) => error.code === "SCHEDULER_OWNS_SKIPS");
});

test("run audit reports incomplete evidence and accepts scheduler-skipped nodes", async () => {
  let run = { id: "run_test", flowId: "audit-flow", status: "running", flowDefinition: { nodes: [{ id: "optional" }] } };
  const receipts = new Map();
  const service = new RunService({ stateStore: { readRun: async () => run, listReceipts: async () => [...receipts.values()] } });
  const active = await service.audit("run_test");
  assert.equal(active.result, "incomplete");
  assert.deepEqual(active.findings.map(({ code }) => code), ["NODE_EVIDENCE_MISSING", "RUN_INCOMPLETE"]);
  run = { ...run, status: "completed" };
  receipts.set("optional", { nodeId: "optional", status: "skipped" });
  assert.deepEqual(await service.audit("run_test"), { schemaVersion: "v1", runId: "run_test", result: "passed", findings: [] });
});
