import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileStateStore } from "../src/core/state-store.js";
import { RunReviewService } from "../src/service/run-review-service.js";
import { RunService } from "../src/service/run-service.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

test("flow review aggregates cheap evidence by immutable flow version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-review-test-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeRun({ schemaVersion: "v1", id: "run_new", flowId: "sdd", flowContentHash: hashB, runtime: "codex", executionMode: "guided", status: "completed", createdAt: "2026-02-01T00:00:00.000Z" });
    await store.writeRun({ schemaVersion: "v1", id: "run_old", flowId: "sdd", flowContentHash: hashA, runtime: "codex", executionMode: "guided", status: "failed", createdAt: "2026-01-01T00:00:00.000Z" });
    await store.writeReceipt({ schemaVersion: "v1", runId: "run_new", nodeId: "build", status: "completed", attempt: 1, durationMs: 100, validation: { mode: "deterministic", result: "passed" } });
    await store.writeReceipt({ schemaVersion: "v1", runId: "run_old", nodeId: "build", status: "failed", attempt: 2, durationMs: 300, signals: [{ severity: "warning", code: "REVIEW", reason: "Repeated attempt", affectsRun: false }] });

    const report = await new RunReviewService({ stateStore: store, now: () => "2026-03-01T00:00:00.000Z" }).review({ flowId: "sdd", compareVersions: true });
    assert.equal(report.anchorRunId, "run_new");
    assert.equal(report.advisoryOnly, true);
    assert.equal(report.versions.length, 2);
    assert.deepEqual(new Set(report.runIds), new Set(["run_new", "run_old"]));
    assert.equal(JSON.parse(await readFile(join(directory, "runs", "run_new", "review", "flow-review.json"), "utf8")).flowId, "sdd");
    const schema = JSON.parse(await readFile(new URL("../contracts/v1/flow-review.schema.json", import.meta.url), "utf8"));
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    assert.equal(ajv.validate(schema, report), true, JSON.stringify(ajv.errors));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow review excludes active runs and applies version, date, and count filters consistently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-review-test-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeRun({ id: "run_active", flowId: "sdd", flowContentHash: hashB, status: "running", createdAt: "2026-04-01T00:00:00.000Z" });
    await store.writeRun({ id: "run_latest", flowId: "sdd", flowContentHash: hashB, status: "completed", createdAt: "2026-03-01T00:00:00.000Z" });
    await store.writeRun({ id: "run_middle", flowId: "sdd", flowContentHash: hashA, status: "completed", createdAt: "2026-02-01T00:00:00.000Z" });
    await store.writeRun({ id: "run_early", flowId: "sdd", flowContentHash: hashA, status: "failed", createdAt: "2026-01-01T00:00:00.000Z" });
    const service = new RunReviewService({ stateStore: store });
    const latest = await service.review({ flowId: "sdd" });
    assert.deepEqual(latest.runIds, ["run_latest"]);
    assert.equal(latest.runsAnalyzed, 1);
    const hashFiltered = await service.review({ flowId: "sdd", contentHash: hashA, since: "2026-01-15T00:00:00.000Z" });
    assert.deepEqual(hashFiltered.runIds, ["run_middle"]);
    const shortOffset = await service.review({ flowId: "sdd", contentHash: hashA, since: "2026-01-01T00:00:00+00" });
    assert.deepEqual(shortOffset.runIds, ["run_middle", "run_early"]);
    const leapSecond = await service.review({ flowId: "sdd", contentHash: hashA, since: "2016-12-31T23:59:60Z" });
    assert.deepEqual(leapSecond.runIds, ["run_middle", "run_early"]);
    const spaceSeparator = await service.review({ flowId: "sdd", contentHash: hashA, since: "2026-01-01 00:00:00Z" });
    assert.deepEqual(spaceSeparator.runIds, ["run_middle", "run_early"]);
    const limited = await service.review({ flowId: "sdd", last: 1, compareVersions: true });
    assert.deepEqual(limited.runIds, ["run_latest"]);
    await assert.rejects(service.review({ flowId: "sdd", compareVersions: "false" }), (error) => error.code === "INVALID_FLOW_REVIEW");
    await assert.rejects(service.review({ flowId: "sdd", extra: true }), (error) => error.code === "INVALID_FLOW_REVIEW");
    await assert.rejects(service.review({ flowId: "sdd", since: "2026-01-01" }), (error) => error.code === "INVALID_FLOW_REVIEW");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow review does not mix runs with the same flow ID from different profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-review-profiles-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeRun({ id: "run_profilea", flowId: "shared-flow", profileId: "profile-a", flowContentHash: hashA, status: "completed", createdAt: "2026-01-02T00:00:00.000Z" });
    await store.writeRun({ id: "run_profileb", flowId: "shared-flow", profileId: "profile-b", flowContentHash: hashB, status: "completed", createdAt: "2026-01-01T00:00:00.000Z" });
    const service = new RunReviewService({ stateStore: store });
    await assert.rejects(service.review({ flowId: "shared-flow" }), (error) => error.code === "FLOW_PROFILE_REQUIRED");
    const report = await service.review({ flowId: "shared-flow", profileId: "profile-a" });
    assert.equal(report.profileId, "profile-a");
    assert.deepEqual(report.runIds, ["run_profilea"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("active checkpoint accepts passive signals but rejects signals that affect a run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-review-test-"));
  try {
    const store = new FileStateStore(directory);
    const service = new RunService({ stateStore: store, createId: () => "run_signal", now: () => "2026-01-01T00:00:00.000Z" });
    await service.create({ flowId: "sdd", workspace: "/workspace", runtime: "codex", executionMode: "guided" });
    await service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "build", status: "completed", recordedAt: "2026-01-01T00:00:00.000Z", signals: [{ severity: "warning", code: "REVIEW", reason: "Review later", affectsRun: false }] });
    assert.equal((await service.get("run_signal")).status, "created");
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "verify", status: "completed", recordedAt: "2026-01-01T00:00:00.000Z", signals: [{ severity: "critical", code: "STOP", reason: "Must not stop", affectsRun: true }] }), (error) => error.code === "INVALID_RECEIPT");
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "../escape", status: "completed", recordedAt: "2026-01-01T00:00:00.000Z" }), (error) => error.code === "INVALID_RECEIPT");
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: ["build"], status: "completed", recordedAt: "2026-01-01T00:00:00.000Z" }), (error) => error.code === "INVALID_RECEIPT");
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "build", status: "completed", recordedAt: "2026-01-01" }), (error) => error.code === "INVALID_RECEIPT");
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "build", status: "completed", recordedAt: "2026-02-30T00:00:00Z" }), (error) => error.code === "INVALID_RECEIPT");
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "build", status: "completed", recordedAt: "2026-01-01T24:00:00Z" }), (error) => error.code === "INVALID_RECEIPT");
    await service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "lowercase-time", status: "completed", recordedAt: "2026-01-01t00:00:00z" });
    await assert.rejects(service.checkpoint("run_signal", { schemaVersion: "v1", runId: "run_signal", nodeId: "build", status: "completed", recordedAt: "2026-01-01T00:00:00Z", signals: [{ severity: "warning", code: ["REVIEW"], reason: "Invalid type", affectsRun: false }] }), (error) => error.code === "INVALID_RECEIPT");
    await assert.rejects(store.writeReceipt({ runId: "run_signal", nodeId: "../escape", status: "completed" }), /Invalid node id/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow review reports partial and unexpected node evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-review-test-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeRun({ id: "run_partial", flowId: "sdd", flowContentHash: hashA, status: "completed", createdAt: "2026-01-01T00:00:00.000Z", flowDefinition: { nodes: [{ id: "build" }, { id: "verify" }] } });
    await store.writeReceipt({ runId: "run_partial", nodeId: "build", status: "completed" });
    await store.writeReceipt({ runId: "run_partial", nodeId: "extra", status: "completed" });
    const report = await new RunReviewService({ stateStore: store }).review({ flowId: "sdd" });
    assert.deepEqual(report.versions[0].missingReceiptRuns, ["run_partial"]);
    assert.deepEqual(report.versions[0].runEvidence, [{ runId: "run_partial", completeness: "incomplete", missingNodeIds: ["verify"], unexpectedNodeIds: ["extra"] }]);
    assert.ok(report.findings.some((finding) => finding.code === "NODE_RECEIPT_MISSING" && finding.nodeId === "verify"));
    assert.ok(report.findings.some((finding) => finding.code === "UNEXPECTED_NODE_RECEIPT" && finding.nodeId === "extra"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow review rejects unrealistic evidence volume and symlinked review directories", async () => {
  const receipts = Array.from({ length: 2049 }, (_value, index) => ({ nodeId: `n${index.toString(36)}`, status: "completed" }));
  const fakeStore = {
    listRuns: async () => [{ id: "run_large", flowId: "sdd", flowContentHash: hashA, status: "completed", createdAt: "2026-01-01T00:00:00.000Z" }],
    listReceipts: async () => receipts,
    writeReview: async () => { throw new Error("must not write"); }
  };
  await assert.rejects(new RunReviewService({ stateStore: fakeStore }).review({ flowId: "sdd" }), (error) => error.code === "FLOW_REVIEW_EVIDENCE_LIMIT");
  const expectedNodeStore = {
    listRuns: async () => [{ id: "run_expected", flowId: "sdd", flowContentHash: hashA, status: "completed", createdAt: "2026-01-01T00:00:00.000Z", flowDefinition: { nodes: receipts.map((receipt) => ({ id: receipt.nodeId })) } }],
    listReceipts: async () => [],
    writeReview: async () => { throw new Error("must not write"); }
  };
  await assert.rejects(new RunReviewService({ stateStore: expectedNodeStore }).review({ flowId: "sdd" }), (error) => error.code === "FLOW_REVIEW_EVIDENCE_LIMIT");

  const directory = await mkdtemp(join(tmpdir(), "flow-review-test-"));
  const outside = await mkdtemp(join(tmpdir(), "flow-review-outside-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeRun({ id: "run_link", flowId: "sdd", flowContentHash: hashA, status: "completed", createdAt: "2026-01-01T00:00:00.000Z" });
    await symlink(outside, join(directory, "runs", "run_link", "review"));
    await assert.rejects(new RunReviewService({ stateStore: store }).review({ flowId: "sdd" }), /must not be a symbolic link/);
    await assert.rejects(readFile(join(outside, "flow-review.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
