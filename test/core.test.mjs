import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FlowError } from "../src/core/errors.js";
import { FlowCatalog } from "../src/core/flow-catalog.js";
import { transitionRun } from "../src/core/lifecycle.js";
import { redact } from "../src/core/redaction.js";
import { resolveStateDir } from "../src/core/state-dir.js";
import { FileStateStore } from "../src/core/state-store.js";
import { ServiceLock } from "../src/core/service-lock.js";
import { assertAdapterCapability, capabilityMatrix, createRuntimeAdapter } from "../src/adapters/runtime-adapter.js";

const flow = (id) => ({ schemaVersion: "v1", id, nodes: [{ id: "work", title: "Work" }] });

test("state directory resolution honours explicit configuration on every platform", () => {
  assert.equal(resolveStateDir({ env: { FLOW_STATE_DIR: "/safe/state" }, platform: "darwin", homeDir: "/home/a" }), "/safe/state");
  assert.equal(resolveStateDir({ env: {}, platform: "darwin", homeDir: "/Users/a" }), "/Users/a/Library/Application Support/flow-server");
  assert.equal(resolveStateDir({ env: { XDG_STATE_HOME: "/state" }, platform: "linux", homeDir: "/home/a" }), "/state/flow-server");
  assert.equal(resolveStateDir({ env: { LOCALAPPDATA: "C:\\Data" }, platform: "win32", homeDir: "C:\\Users\\a" }), "C:\\Data/flow-server");
});

test("lifecycle only permits documented transitions", () => {
  assert.equal(transitionRun("created", "start"), "running");
  assert.equal(transitionRun("paused", "resume"), "running");
  assert.throws(() => transitionRun("completed", "resume"), (error) => error instanceof FlowError && error.code === "INVALID_LIFECYCLE_TRANSITION");
});

test("redaction removes recognized secrets recursively", () => {
  const token = ["access", "token=abc123secret"].join("_");
  const result = redact({ log: token, nested: ["sk_abcdefghijklmnop"] });
  assert.deepEqual(result, { log: "[REDACTED]", nested: ["[REDACTED]"] });
});

test("state store persists redacted JSON atomically in a run directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-server-test-"));
  try {
    const store = new FileStateStore(directory);
    const credential = ["secret", "do-not-save"].join("=");
    await store.writeReceipt({ runId: "run_example", nodeId: "verify", status: "completed", credential });
    const receipt = await readFile(join(directory, "runs", "run_example", "receipt-verify.json"), "utf8");
    assert.match(receipt, /\[REDACTED\]/);
    assert.doesNotMatch(receipt, /do-not-save/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("state store reads runs without migrating or deleting existing dossiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-server-test-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeRun({ id: "run_old", createdAt: "2026-01-01T00:00:00.000Z", status: "completed" });
    await store.writeRun({ id: "run_new", createdAt: "2026-02-01T00:00:00.000Z", status: "created" });
    assert.deepEqual((await store.listRuns()).map((run) => run.id), ["run_new", "run_old"]);
    assert.equal((await store.readRun("run_old")).status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("state store keeps receipts and idempotency entries outside public run identifiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-server-test-"));
  try {
    const store = new FileStateStore(directory);
    await store.writeReceipt({ runId: "run_example", nodeId: "verify", status: "failed" });
    await store.writeReceipt({ runId: "run_example", nodeId: "prepare", status: "completed" });
    assert.deepEqual((await store.listReceipts("run_example")).map((receipt) => receipt.nodeId), ["prepare", "verify"]);
    await store.writeIdempotency("a key that is never used as a filename", { fingerprint: "request", body: { ok: true } });
    assert.deepEqual(await store.readIdempotency("a key that is never used as a filename"), { fingerprint: "request", body: { ok: true } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("service lock is exclusive and only its owner may release it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-server-test-"));
  try {
    const first = new ServiceLock(directory, { processId: 101, instanceId: () => "first", isProcessAlive: () => true });
    await first.acquire({ endpoint: "http://127.0.0.1:4729" });
    const second = new ServiceLock(directory, { processId: 102, instanceId: () => "second", isProcessAlive: () => true });
    await assert.rejects(second.acquire(), (error) => error.code === "SERVICE_LOCK_BUSY");
    assert.equal(await first.release(), true);
    assert.equal((await second.acquire()).instanceId, "second");
    assert.equal((await second.readOwner()).instanceId, "second");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("service lock replaces a stale owner only after its process is confirmed dead", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-server-test-"));
  try {
    const lockDirectory = join(directory, "service.lock");
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(lockDirectory, "owner.json"), '{"pid":9,"instanceId":"old"}\n', { mode: 0o600 });
    const lock = new ServiceLock(directory, { processId: 102, instanceId: () => "new", isProcessAlive: () => false });
    await lock.acquire();
    assert.equal((await lock.readOwner()).instanceId, "new");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow catalog loads only explicit sources with documented precedence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-catalog-test-"));
  try {
    const external = join(directory, "external");
    const profiles = join(directory, "profiles");
    await mkdir(join(profiles, "team"), { recursive: true });
    await mkdir(external);
    await writeFile(join(external, "core.json"), JSON.stringify(flow("core")));
    await writeFile(join(external, "external.json"), JSON.stringify(flow("external")));
    await writeFile(join(profiles, "team", "core.json"), JSON.stringify({ ...flow("core"), title: "Profile value" }));
    const catalog = new FlowCatalog({ coreFlows: [{ ...flow("core"), title: "Core value" }], flowDirectories: [external], profileDirectory: profiles, profileName: "team" });
    assert.deepEqual((await catalog.list()).map((item) => item.id), ["core", "external"]);
    assert.equal((await catalog.list())[0].title, "Profile value");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow catalog rejects implicit profiles and sources that escape configured roots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-catalog-test-"));
  try {
    const profiles = join(directory, "profiles");
    const outside = join(directory, "outside");
    await mkdir(profiles);
    await mkdir(outside);
    await writeFile(join(outside, "flow.json"), JSON.stringify(flow("outside")));
    await symlink(outside, join(profiles, "team"));
    await assert.rejects(new FlowCatalog({ profileName: "team" }).list(), (error) => error.code === "PROFILE_ROOT_REQUIRED");
    await assert.rejects(new FlowCatalog({ profileDirectory: profiles, profileName: "team" }).list(), (error) => error.code === "PROFILE_ESCAPE");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime adapters expose guided-only capability and fail closed", async () => {
  assert.deepEqual(capabilityMatrix(), { codex: { guided: true, direct: false }, claude: { guided: true, direct: false } });
  assert.doesNotThrow(() => assertAdapterCapability("codex", "guided"));
  assert.throws(() => assertAdapterCapability("claude", "direct"), (error) => error.code === "UNSUPPORTED_ADAPTER_OPERATION");
  assert.throws(() => assertAdapterCapability("cursor", "guided"), (error) => error.code === "UNSUPPORTED_RUNTIME");
  await assert.rejects(createRuntimeAdapter("codex").launch(), (error) => error.code === "ADAPTER_LAUNCH_DISABLED");
});
