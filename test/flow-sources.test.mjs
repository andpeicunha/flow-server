import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FlowCatalog } from "../src/core/flow-catalog.js";
import { FlowChangeTracker } from "../src/core/flow-change-tracker.js";
import { canonicalizeFlowDocument, identifyFlowDocument, parseFlowDocument } from "../src/core/flow-document.js";
import { loadFlowSourceConfig, validateFlowSourceConfig } from "../src/core/flow-source-config.js";
import { planFlowSync } from "../src/core/flow-sync-policy.js";
import { FlowSourceService } from "../src/service/flow-source-service.js";
import { RunService } from "../src/service/run-service.js";

const flow = { schemaVersion: "v1", id: "hello-flow", title: "Hello", nodes: [{ id: "prepare", title: "Prepare" }, { id: "verify", title: "Verify", dependsOn: ["prepare"] }] };

test("source configuration supports local and git modes without credentials", () => {
  const config = validateFlowSourceConfig({
    schemaVersion: "v1",
    sources: [
      { id: "local", mode: "local", path: "/flows/local", sync: { pull: "confirm", push: "manual" } },
      { id: "personal", mode: "git", path: "/flows/personal", remote: "origin", branch: "main", sync: { pull: "confirm", push: "after-validation" } }
    ]
  });
  assert.equal(config.sources[1].sync.push, "after-validation");
  assert.throws(() => validateFlowSourceConfig({ schemaVersion: "v1", sources: [{ id: "bad", mode: "local", path: "relative", sync: { pull: "auto", push: "manual" } }] }), { code: "INVALID_FLOW_SOURCE_CONFIG" });
  assert.throws(() => validateFlowSourceConfig({ schemaVersion: "v1", sources: [{ id: "bad", mode: "git", path: "/flows", sync: { pull: "confirm", push: "force" }, token: "secret" }] }), { code: "INVALID_FLOW_SOURCE_CONFIG" });
});

test("source configuration loads only an explicit absolute JSON file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-source-config-"));
  try {
    const path = join(directory, "sources.json");
    await writeFile(path, JSON.stringify({ schemaVersion: "v1", sources: [] }));
    assert.deepEqual(await loadFlowSourceConfig(path), { schemaVersion: "v1", sources: [] });
    await assert.rejects(loadFlowSourceConfig("sources.json"), { code: "INVALID_FLOW_SOURCE_CONFIG_PATH" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source configuration accepts restricted YAML and rejects aliases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-source-config-yaml-"));
  try {
    const path = join(directory, "sources.yaml");
    await writeFile(path, "schemaVersion: v1\nsources:\n  - id: local\n    mode: local\n    path: /flows\n    sync: { pull: confirm, push: manual }\n");
    assert.equal((await loadFlowSourceConfig(path)).sources[0].id, "local");
    await writeFile(path, "schemaVersion: v1\nsources: &sources []\ncopy: *sources\n");
    await assert.rejects(loadFlowSourceConfig(path), { code: "INVALID_FLOW_SOURCE_CONFIG" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restricted YAML and JSON produce the same canonical identity", () => {
  const yaml = `schemaVersion: v1\nid: hello-flow\ntitle: Hello\nnodes:\n  - id: prepare\n    title: Prepare\n  - id: verify\n    title: Verify\n    dependsOn: [prepare]\n`;
  const fromYaml = parseFlowDocument(yaml, { format: "yaml" });
  const fromJson = parseFlowDocument(JSON.stringify(flow), { format: "json" });
  assert.deepEqual(fromYaml, fromJson);
  assert.equal(canonicalizeFlowDocument(fromYaml), canonicalizeFlowDocument(fromJson));
  assert.equal(identifyFlowDocument(fromYaml).contentHash, identifyFlowDocument(fromJson).contentHash);
});

test("restricted YAML rejects aliases, merge keys, duplicates, unknown fields, and invalid dependencies", () => {
  const documents = [
    "schemaVersion: v1\nid: alias-flow\nnodes:\n  - &node { id: work, title: Work }\n  - *node\n",
    "schemaVersion: v1\nid: merge-flow\ndefaults: &defaults { title: Work }\nnodes:\n  - <<: *defaults\n    id: work\n",
    "schemaVersion: v1\nid: duplicate\nid: again\nnodes: [{ id: work, title: Work }]\n",
    "schemaVersion: v1\nid: unknown\nextra: true\nnodes: [{ id: work, title: Work }]\n",
    "schemaVersion: v1\nid: missing-dependency\nnodes: [{ id: work, title: Work, dependsOn: [missing] }]\n"
  ];
  for (const document of documents) assert.throws(() => parseFlowDocument(document, { format: "yaml" }), { code: "INVALID_FLOW_DOCUMENT" });
});

test("flow catalog loads YAML and JSON with existing precedence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-source-catalog-"));
  try {
    await mkdir(join(directory, "flows"));
    await writeFile(join(directory, "flows", "hello.yaml"), "schemaVersion: v1\nid: hello-flow\ntitle: YAML\nnodes: [{ id: work, title: Work }]\n");
    await writeFile(join(directory, "flows", "other.json"), JSON.stringify({ schemaVersion: "v1", id: "other", nodes: [{ id: "work", title: "Work" }] }));
    const listed = await new FlowCatalog({ flowDirectories: [join(directory, "flows")] }).list();
    assert.deepEqual(listed.map((item) => item.id), ["hello-flow", "other"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow source service exposes non-secret status and resolves canonical run identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-source-service-"));
  try {
    const flows = join(directory, "flows");
    await mkdir(flows);
    await writeFile(join(flows, "hello.yaml"), "schemaVersion: v1\nid: hello-flow\ntitle: Hello\nnodes: [{ id: work, title: Work }]\n");
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "personal", mode: "git", path: flows, remote: "origin", branch: "main", sync: { pull: "confirm", push: "manual" } }] }));
    const service = new FlowSourceService({ configPath, gitIdentity: async () => ({ commit: "a".repeat(40), branch: "main" }) });
    await service.initialize();
    assert.deepEqual(service.status(), [{ id: "personal", mode: "git", path: flows, remote: "origin", branch: "main", currentBranch: "main", gitCommit: "a".repeat(40), sync: { pull: "confirm", push: "manual" } }]);
    const listed = await service.list();
    assert.equal(listed[0].sourceId, "personal");
    assert.match(listed[0].contentHash, /^[a-f0-9]{64}$/);
    const writes = [];
    const runService = new RunService({ stateStore: { writeRun: async (run) => writes.push(run) }, flowResolver: (id) => service.resolve(id), createId: () => "run_identity", now: () => "2026-01-01T00:00:00.000Z" });
    const run = await runService.create({ flowId: "hello-flow", workspace: "/workspace", runtime: "codex", executionMode: "guided" });
    assert.equal(run.flowSourceId, "personal");
    assert.equal(run.flowContentHash, listed[0].contentHash);
    assert.equal(run.flowGitCommit, "a".repeat(40));
    assert.equal(writes[0].workspace, "/workspace");
    assert.equal(writes[0].flowDefinition.id, "hello-flow");
    assert.equal(run.flowDefinition, undefined);
    await assert.rejects(service.resolve("missing"), { code: "FLOW_NOT_FOUND" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("change tracker validates pending changes, keeps local backups, and never mutates Git", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-change-tracker-"));
  try {
    const sourcePath = join(directory, "flows");
    const stateDir = join(directory, "state");
    await mkdir(sourcePath);
    const flowPath = join(sourcePath, "hello.yaml");
    await writeFile(flowPath, "schemaVersion: v1\nid: hello-flow\nnodes: [{ id: work, title: Work }]\n");
    const tracker = new FlowChangeTracker({ stateDir, now: () => "2026-01-01T00:00:00.000Z" });
    const record = await tracker.mark({ id: "personal", mode: "local", path: sourcePath }, flowPath);
    assert.equal(record.status, "pending");
    assert.match(record.contentHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(await readFile(join(stateDir, "sources", "personal", "pending", "hello-flow.json"), "utf8")), record);
    assert.match(await readFile(join(stateDir, "sources", "personal", "backups", "hello-flow", `${record.contentHash}.yaml`), "utf8"), /hello-flow/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync planner covers every push policy and always confirms pull", () => {
  const safe = { direction: "push", validationPassed: true, intendedFiles: ["sdd.yaml"], changedFiles: ["sdd.yaml"] };
  assert.deepEqual(planFlowSync({ ...safe, pushPolicy: "manual" }), { decision: "manual", reason: "manual-policy" });
  assert.deepEqual(planFlowSync({ ...safe, pushPolicy: "confirm" }), { decision: "confirm", reason: "push-confirmation-required" });
  assert.deepEqual(planFlowSync({ ...safe, pushPolicy: "after-validation" }), { decision: "allow", reason: "validated-flow-only-change" });
  assert.deepEqual(planFlowSync({ direction: "pull", pushPolicy: "after-validation" }), { decision: "confirm", reason: "remote-flow-instructions-require-confirmation" });
});

test("sync planner blocks every documented unsafe state", () => {
  const blocked = planFlowSync({ direction: "push", pushPolicy: "after-validation", validationPassed: false, intendedFiles: ["sdd.yaml"], changedFiles: ["sdd.yaml", "notes.txt"], conflicts: true, detachedHead: true, branchMatches: false, remoteMatches: false });
  assert.equal(blocked.decision, "blocked");
  assert.deepEqual(blocked.blockers, ["conflicts", "detached-head", "branch-mismatch", "remote-mismatch", "validation-required", "unrelated-changes"]);
  assert.deepEqual(blocked.unrelatedFiles, ["notes.txt"]);
});
