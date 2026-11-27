import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileStateStore } from "../src/core/state-store.js";
import { FlowError } from "../src/core/errors.js";
import { RunService } from "../src/service/run-service.js";

const workspace = "/work/server-timing";
const callerTime = "2026-01-01T00:00:00Z";
const T0 = "2026-11-10T12:00:00.000Z";
const T1 = "2026-11-10T12:00:05.250Z";
const T2 = "2026-11-10T12:01:00.000Z";
const T3 = "2026-11-10T12:01:07.000Z";
const flow = { id: "timing-flow", nodes: [{ id: "build" }, { id: "verify", after: ["build"] }] };
const stopFlow = { id: "timing-stop", stopWhen: [{ step: "build", jsonPath: "status", notEquals: "pass", status: "needs_fix", next: "fix", mode: "block" }],
  nodes: [{ id: "build" }, { id: "verify", after: ["build"] }] };
const review = { reason: "Fixed it.", workspace, worktreeReview: "Checked the worktree.", reviewedPredecessors: true };

function clock(start = T0) {
  const state = { value: start, set(value) { state.value = value; }, now: () => state.value };
  return state;
}

const receipt = (runId, nodeId, extra = {}) => ({ schemaVersion: "v1", runId, nodeId, status: "completed", recordedAt: callerTime, ...extra });

async function fixture({ definition = flow, resolver, now } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "flow-server-timing-"));
  const store = new FileStateStore(directory);
  const time = clock();
  let counter = 0;
  const service = new RunService({ stateStore: store, now: now ?? time.now, createId: () => `run_t${++counter}`,
    flowResolver: resolver ?? (async () => ({ flowDefinition: definition })), getWorkspaceFingerprint: async () => undefined });
  const run = await service.create({ flowId: definition.id, workspace, runtime: "codex", executionMode: "guided" });
  return { directory, store, service, time, runId: run.id };
}

const receiptOf = async (store, runId, nodeId) => (await store.listReceipts(runId)).find((item) => item.nodeId === nodeId);

test("C1 receipt carries the server-measured duration and keeps caller fields intact", async () => {
  const { directory, store, service, time, runId } = await fixture();
  try {
    await service.next(runId);
    time.set(T1);
    await service.checkpoint(runId, receipt(runId, "build", { durationMs: 42 }));
    const stored = await receiptOf(store, runId, "build");
    assert.deepEqual(stored.serverTiming, { dispatchedAt: T0, checkpointedAt: T1, durationMs: 5250 });
    assert.equal(stored.recordedAt, callerTime);
    assert.equal(stored.durationMs, 42);
    const names = await readdir(store.runDirectory(runId));
    assert.ok(names.includes("dispatch-build-1.json"));
    assert.equal((await store.listReceipts(runId)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C3 repeated flow_next keeps the first dispatch time", async () => {
  const { directory, store, service, time, runId } = await fixture();
  try {
    await service.next(runId);
    time.set(T1);
    await service.next(runId);
    assert.equal((await store.readDispatch(runId, "build", 1)).dispatchedAt, T0);
    time.set(T2);
    await service.checkpoint(runId, receipt(runId, "build"));
    assert.equal((await receiptOf(store, runId, "build")).serverTiming.durationMs, 60000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C2 a failed node retried through flow_continue measures each attempt on its own", async () => {
  const { directory, store, service, time, runId } = await fixture();
  try {
    await service.next(runId);
    time.set(T1);
    await service.checkpoint(runId, receipt(runId, "build", { status: "failed", summary: "broke" }));
    time.set(T2);
    const continued = await service.continueRun(runId, review);
    assert.equal(continued.next[0].attempt, 2);
    assert.equal((await store.readDispatch(runId, "build", 2)).dispatchedAt, T2);
    time.set(T3);
    await service.checkpoint(runId, receipt(runId, "build", { attempt: 2 }));
    const [archived] = await store.listArchivedReceipts(runId);
    assert.equal(archived.attempt ?? 1, 1);
    assert.deepEqual(archived.serverTiming, { dispatchedAt: T0, checkpointedAt: T1, durationMs: 5250 });
    assert.deepEqual((await receiptOf(store, runId, "build")).serverTiming, { dispatchedAt: T2, checkpointedAt: T3, durationMs: 7000 });
    const retry = (await service.audit(runId)).retryHistory[0];
    assert.equal(retry.serverTiming.durationMs, 5250);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C2 a stop-rule retry measures the new attempt only from its own dispatch", async () => {
  const { directory, store, service, time, runId } = await fixture({ definition: stopFlow });
  try {
    await service.next(runId);
    time.set(T1);
    await service.checkpoint(runId, receipt(runId, "build", { output: { status: "FAIL" } }));
    await service.next(runId);
    time.set(T2);
    await service.continueRun(runId, review);
    time.set(T3);
    await service.checkpoint(runId, receipt(runId, "build", { attempt: 2, output: { status: "pass" } }));
    assert.equal((await store.listArchivedReceipts(runId))[0].serverTiming.durationMs, 5250);
    assert.deepEqual((await receiptOf(store, runId, "build")).serverTiming, { dispatchedAt: T2, checkpointedAt: T3, durationMs: 7000 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C4 switching the runtime opens a new attempt with its own dispatch", async () => {
  const fallback = { build: { runtime: "claude", model: "m/claude", effort: "medium" } };
  const withModels = { id: "timing-fb", nodes: [{ id: "build", model: "m/codex", variant: "medium" }, { id: "verify", after: ["build"], model: "m/codex", variant: "medium" }] };
  const { directory, store, service, time, runId } = await fixture({ resolver: async () => ({ flowDefinition: withModels, fallbackExecutions: fallback }) });
  try {
    await service.next(runId);
    await service.block(runId, { nodeId: "build", reasonCode: "RATE_LIMIT", reason: "limit" });
    time.set(T2);
    const switched = await service.switchNode(runId, { nodeId: "build", ...review });
    assert.equal(switched.next[0].attempt, 2);
    assert.equal((await store.readDispatch(runId, "build", 1)).dispatchedAt, T0);
    assert.equal((await store.readDispatch(runId, "build", 2)).dispatchedAt, T2);
    time.set(T3);
    await service.checkpoint(runId, receipt(runId, "build", { attempt: 2, runtime: "claude", model: "m/claude", effort: "medium" }));
    assert.equal((await receiptOf(store, runId, "build")).serverTiming.durationMs, 7000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C4 switching the execution profile records the dispatch of the next attempt", async () => {
  const available = [{ id: "claude", runtime: "claude" }, { id: "codex", runtime: "codex" }];
  const profileFlow = { id: "timing-profile", nodes: [{ id: "build", model: "m/a", variant: "medium" }] };
  const resolver = async ({ executionProfileId = "claude" }) => ({ flowDefinition: profileFlow, runtime: executionProfileId, executionProfileId,
    executionProfileSnapshot: { id: executionProfileId, runtime: executionProfileId }, availableExecutionProfiles: available });
  const { directory, store, service, time, runId } = await fixture({ resolver });
  try {
    await service.next(runId);
    await service.block(runId, { nodeId: "build", reasonCode: "RATE_LIMIT", reason: "limit" });
    time.set(T2);
    const switched = await service.switchNode(runId, { nodeId: "build", executionProfileId: "codex", ...review });
    assert.equal(switched.next[0].attempt, 2);
    assert.equal((await store.readDispatch(runId, "build", 2)).dispatchedAt, T2);
    time.set(T3);
    await service.checkpoint(runId, receipt(runId, "build", { attempt: 2, runtime: "codex", model: "m/a", effort: "medium" }));
    assert.deepEqual((await receiptOf(store, runId, "build")).serverTiming, { dispatchedAt: T2, checkpointedAt: T3, durationMs: 7000 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C5 reused receipts do not inherit the source timing", async () => {
  const reusable = { id: "timing-reuse", nodes: [{ id: "build", reusable: true }] };
  const directory = await mkdtemp(join(tmpdir(), "flow-server-timing-"));
  const store = new FileStateStore(directory);
  const time = clock();
  let counter = 0;
  const fingerprint = { head: "abc", contextHash: "c".repeat(64), openSpecHash: "d".repeat(64) };
  const service = new RunService({ stateStore: store, now: time.now, createId: () => `run_r${++counter}`,
    flowResolver: async () => ({ flowDefinition: reusable }), getWorkspaceFingerprint: async () => fingerprint });
  try {
    const source = await service.create({ flowId: reusable.id, workspace, runtime: "codex", executionMode: "guided", task: "t" });
    await service.next(source.id);
    time.set(T1);
    await service.checkpoint(source.id, receipt(source.id, "build"));
    await service.transition(source.id, "complete");
    assert.equal((await receiptOf(store, source.id, "build")).serverTiming.durationMs, 5250);
    const reused = await service.create({ flowId: reusable.id, workspace, runtime: "codex", executionMode: "guided", task: "t", reuseFromRunId: source.id, reuseNodeIds: ["build"] });
    const copy = await receiptOf(store, reused.id, "build");
    assert.ok(copy.reusedFrom);
    assert.equal(copy.serverTiming, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C6 a checkpoint without a prior dispatch is accepted without a fabricated duration", async () => {
  const { directory, store, service, time, runId } = await fixture();
  try {
    time.set(T1);
    await service.checkpoint(runId, receipt(runId, "build"));
    assert.deepEqual((await receiptOf(store, runId, "build")).serverTiming, { dispatchedAt: null, checkpointedAt: T1, durationMs: null });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C7 a caller-supplied serverTiming is rejected", async () => {
  const { directory, store, service, runId } = await fixture();
  try {
    await service.next(runId);
    const forged = { dispatchedAt: T0, checkpointedAt: T1, durationMs: 1 };
    await assert.rejects(service.checkpoint(runId, receipt(runId, "build", { serverTiming: forged })), { code: "INVALID_RECEIPT" });
    assert.equal(await receiptOf(store, runId, "build"), undefined);
    await assert.rejects(service.checkpoint(runId, receipt(runId, "build", { serverTiming: forged })),
      { code: "INVALID_RECEIPT", message: "serverTiming is recorded by flow-server only." });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C7b checkpoint with an out-of-range or non-integer attempt fails with a FlowError, not an internal error", async () => {
  const { directory, store, service, runId } = await fixture();
  try {
    await service.next(runId);
    for (const attempt of [0, 101, 1.5]) {
      await assert.rejects(service.checkpoint(runId, receipt(runId, "build", { attempt })), (error) => error instanceof FlowError && typeof error.code === "string");
    }
    assert.equal(await receiptOf(store, runId, "build"), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C12 a failing dispatch write does not stop flow_next from delivering the node", async () => {
  const { directory, store, service, runId } = await fixture();
  try {
    store.writeDispatch = async () => { throw new Error("disk full"); };
    const result = await service.next(runId);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.nodes.map((node) => node.id), ["build"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C8 a clock that moves backwards yields a null duration", async () => {
  const { directory, store, service, time, runId } = await fixture();
  try {
    await service.next(runId);
    time.set("2026-11-10T11:59:00.000Z");
    await service.checkpoint(runId, receipt(runId, "build"));
    assert.deepEqual((await receiptOf(store, runId, "build")).serverTiming, { dispatchedAt: T0, checkpointedAt: "2026-11-10T11:59:00.000Z", durationMs: null });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C9 legacy runs without dispatch or serverTiming still load, audit and continue", async () => {
  const { directory, store, service, runId } = await fixture();
  try {
    await service.next(runId);
    await rm(join(store.runDirectory(runId), "dispatch-build-1.json"));
    const failed = receipt(runId, "build", { status: "failed" });
    await store.writeReceipt(failed);
    const run = await store.readRun(runId);
    await store.writeRun({ ...run, status: "blocked", block: { reason: "NODE_FAILED", nodeId: "build", recordedAt: callerTime } });
    assert.equal((await service.get(runId)).id, runId);
    assert.equal((await service.audit(runId)).result, "failed");
    const continued = await service.continueRun(runId, review);
    assert.equal(continued.next[0].attempt, 2);
    const [archived] = await store.listArchivedReceipts(runId);
    assert.equal(archived.serverTiming, undefined);
    assert.equal((await service.audit(runId)).retryHistory[0].serverTiming, undefined);
    await service.checkpoint(runId, receipt(runId, "build", { attempt: 2 }));
    assert.equal((await receiptOf(store, runId, "build")).serverTiming.durationMs !== undefined, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("C11 the injected clock is read once per dispatch and once per checkpoint", async () => {
  let calls = 0;
  const base = Date.parse(T0);
  const { directory, store, service, runId } = await fixture({ now: () => new Date(base + 1000 * ++calls).toISOString() });
  try {
    const beforeNext = calls;
    await service.next(runId);
    assert.equal(calls, beforeNext + 1);
    const dispatchedAt = new Date(base + 1000 * calls).toISOString();
    assert.equal((await store.readDispatch(runId, "build", 1)).dispatchedAt, dispatchedAt);
    await service.next(runId);
    assert.equal((await store.readDispatch(runId, "build", 1)).dispatchedAt, dispatchedAt);
    const beforeCheckpoint = calls;
    await service.checkpoint(runId, receipt(runId, "build"));
    assert.equal(calls, beforeCheckpoint + 1);
    const { serverTiming } = await receiptOf(store, runId, "build");
    assert.equal(serverTiming.dispatchedAt, dispatchedAt);
    assert.equal(serverTiming.durationMs, 2000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("dispatch files never count as receipts", async () => {
  const { directory, store, service, runId } = await fixture();
  try {
    await service.next(runId);
    assert.deepEqual(await store.listReceipts(runId), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
