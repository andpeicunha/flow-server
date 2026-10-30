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
      { id: "personal", mode: "git", path: "/flows/personal", remote: "origin", branch: "main", workspaceRoots: ["/work/projects"], sync: { pull: "confirm", push: "after-validation" } }
    ]
  });
  assert.equal(config.sources[1].sync.push, "after-validation");
  assert.deepEqual(config.sources[1].workspaceRoots, ["/work/projects"]);
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

test("legacy agent workflow YAML preserves routing, model, skills, conditions, and stop rules", () => {
  const yaml = `name: sample-workflow\ndescription: A private local workflow\nroute:\n  when: [review, change]\n  avoid: [bug]\n  priority: 30\nstopWhen:\n  step: intake\n  jsonPath: decision\n  notEquals: ready\n  status: needs_confirmation\n  next: ask the developer\nnodes:\n  - id: intake\n    agent: explorer\n    model: provider/model-name\n    variant: low\n    executor: cli-session\n    skills: [local-skill]\n    output: Return a decision\n    prompt: 'Task: {{task}}'\n  - id: work_node\n    after: [intake]\n    agent: builder\n    model: provider/model-name\n    effort: medium\n    constraints: [stay in scope]\n    when: { step: intake, jsonPath: decision, in: [ready, true] }\n    prompt: Implement only the approved work\n`;
  const parsed = parseFlowDocument(yaml, { format: "yaml" });
  assert.equal(parsed.schemaVersion, "v2");
  assert.equal(parsed.id, "sample-workflow");
  assert.equal(parsed.routing.priority, 30);
  assert.equal(parsed.nodes[1].agent, "builder");
  assert.equal(parsed.nodes[1].model, "provider/model-name");
  assert.deepEqual(parsed.nodes[1].skills ?? [], []);
  assert.equal(parsed.nodes[1].when.step, "intake");
  assert.deepEqual(parsed.stopWhen, [{ step: "intake", jsonPath: "decision", notEquals: "ready", status: "needs_confirmation", next: "ask the developer" }]);
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
    const workspace = join(directory, "project");
    await mkdir(flows);
    await mkdir(workspace);
    await writeFile(join(flows, "hello.yaml"), "schemaVersion: v1\nid: hello-flow\ntitle: Hello\nnodes: [{ id: work, title: Work }]\n");
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "personal", mode: "git", path: flows, remote: "origin", branch: "main", workspaceRoots: [workspace], sync: { pull: "confirm", push: "manual" } }] }));
    let commit = "a".repeat(40);
    const service = new FlowSourceService({ configPath, gitIdentity: async () => ({ commit, branch: "main" }) });
    await service.initialize();
    assert.deepEqual(await service.status(), [{ id: "personal", mode: "git", path: flows, workspaceRoots: [workspace], remote: "origin", branch: "main", currentBranch: "main", gitCommit: "a".repeat(40), sync: { pull: "confirm", push: "manual" } }]);
    const listed = await service.list();
    assert.equal(listed[0].sourceId, "personal");
    assert.equal(listed[0].profileId, "personal");
    assert.match(listed[0].contentHash, /^[a-f0-9]{64}$/);
    const writes = [];
    const runService = new RunService({ stateStore: { writeRun: async (run) => writes.push(run) }, flowResolver: (selection) => service.resolve(selection), createId: () => "run_identity", now: () => "2026-01-01T00:00:00.000Z" });
    const run = await runService.create({ flowId: "hello-flow", workspace, runtime: "codex", executionMode: "guided" });
    assert.equal(run.profileId, "personal");
    assert.equal(run.flowSourceId, "personal");
    assert.equal(run.flowContentHash, listed[0].contentHash);
    assert.equal(run.flowGitCommit, "a".repeat(40));
    assert.equal(writes[0].workspace, workspace);
    assert.equal(writes[0].flowDefinition.id, "hello-flow");
    assert.equal(run.flowDefinition, undefined);
    await assert.rejects(service.resolve("missing", { profileId: "personal" }), { code: "FLOW_NOT_FOUND" });
    assert.deepEqual(await service.selectFlow({ workspace, flowId: "hello-flow" }).then(({ decision, profileId }) => ({ decision, profileId })), { decision: "ready", profileId: "personal" });
    assert.equal((await service.selectFlow({ workspace: directory, flowId: "hello-flow" })).decision, "needs_confirmation");
    commit = "b".repeat(40);
    assert.equal((await service.list())[0].gitCommit, commit);
    assert.equal((await service.status())[0].gitCommit, commit);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("profiles isolate duplicate flow IDs and ask when a workspace is not mapped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-profile-routing-"));
  try {
    const projectOne = join(directory, "project-one");
    const projectTwo = join(directory, "project-two");
    const sourceOne = join(directory, "flows-one");
    const sourceTwo = join(directory, "flows-two");
    await Promise.all([mkdir(projectOne), mkdir(projectTwo), mkdir(sourceOne), mkdir(sourceTwo)]);
    const definition = (title) => `name: shared-flow\ndescription: ${title}\nrouting: { when: [feature], priority: 10 }\nnodes: [{ id: work_node, agent: builder, model: provider/model, skills: [review], prompt: 'Do {{task}}' }]\n`;
    await writeFile(join(sourceOne, "shared.yaml"), definition("Workspace one"));
    await writeFile(join(sourceTwo, "shared.yaml"), definition("Workspace two"));
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [
      { id: "profile-one", mode: "local", path: sourceOne, workspaceRoots: [projectOne], sync: { pull: "confirm", push: "manual" } },
      { id: "profile-two", mode: "local", path: sourceTwo, workspaceRoots: [projectTwo], sync: { pull: "confirm", push: "manual" } }
    ] }));
    const service = new FlowSourceService({ configPath });
    await service.initialize();
    const listed = await service.list();
    assert.equal(listed.length, 2);
    assert.deepEqual(listed.map(({ profileId }) => profileId), ["profile-one", "profile-two"]);
    const routed = await service.selectFlow({ workspace: projectTwo, task: "implement a feature" });
    assert.equal(routed.decision, "ready");
    assert.equal(routed.profileId, "profile-two");
    const unknown = await service.selectFlow({ workspace: directory, task: "implement a feature" });
    assert.equal(unknown.decision, "needs_confirmation");
    assert.equal(unknown.reason, "PROFILE_UNRESOLVED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow routing asks the developer when multiple flows match the task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-ambiguous-routing-"));
  try {
    const workspace = join(directory, "project");
    const flows = join(directory, "flows");
    await Promise.all([mkdir(workspace), mkdir(flows)]);
    await writeFile(join(flows, "sdd.yaml"), "name: sdd\nrouting: { when: [api], priority: 110 }\nnodes: [{ id: work }]\n");
    await writeFile(join(flows, "pr-review.yaml"), "name: pr-review\nrouting: { when: [review], priority: 30 }\nnodes: [{ id: work }]\n");
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "profile", mode: "local", path: flows, workspaceRoots: [workspace], sync: { pull: "confirm", push: "manual" } }] }));
    const service = new FlowSourceService({ configPath });
    await service.initialize();
    const selection = await service.selectFlow({ workspace, task: "review API" });
    assert.equal(selection.decision, "needs_confirmation");
    assert.equal(selection.reason, "FLOW_AMBIGUOUS");
    assert.deepEqual(selection.flows.map(({ id }) => id), ["sdd", "pr-review"]);
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
