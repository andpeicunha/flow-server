import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { validateFlowSourceConfig } from "../src/core/flow-source-config.js";
import { FileStateStore } from "../src/core/state-store.js";
import { defaultSkillRoots, expandSkillRoot, locateSkill, resolveFlowSkills } from "../src/core/skill-resolver.js";
import { diagnoseFlowSetup } from "../src/service/doctor-service.js";
import { FlowSourceService } from "../src/service/flow-source-service.js";
import { RunService } from "../src/service/run-service.js";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const source = (extra = {}) => ({ id: "work", mode: "local", path: "/flows/work", sync: { pull: "confirm", push: "manual" }, ...extra });
const config = (skills) => ({ schemaVersion: "v1", sources: [source({ skills })] });

async function skill(root, name, body = `# ${name}\n`) {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), body);
}

async function workdir(run) {
  const directory = await mkdtemp(join(tmpdir(), "flow-skill-paths-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("skills.roots expands ~, requires absolute paths, and rejects relative or .. entries", () => {
  const home = homedir();
  assert.deepEqual(validateFlowSourceConfig(config({ roots: ["~/dotfiles/skills", "/abs/skills/"] })).sources[0].skills.roots, [join(home, "dotfiles", "skills"), "/abs/skills"]);
  assert.equal(validateFlowSourceConfig({ schemaVersion: "v1", sources: [source()] }).sources[0].skills, undefined);
  for (const roots of [["relative/skills"], ["./skills"], ["/abs/../etc"], ["~/a/../b"], ["~other/x"], [], [""], ["/a", "/a"], "/abs"]) {
    assert.throws(() => validateFlowSourceConfig(config({ roots })), { code: "INVALID_FLOW_SOURCE_CONFIG" }, JSON.stringify(roots));
  }
  assert.throws(() => validateFlowSourceConfig(config({ roots: ["/abs"], extra: true })), { code: "INVALID_FLOW_SOURCE_CONFIG" });
  assert.equal(expandSkillRoot("skills"), undefined);
});

test("source config contract schema accepts skills.roots and rejects relative or .. roots", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/v1/flow-source-config.schema.json", import.meta.url), "utf8"));
  const validate = addFormats(new Ajv2020({ strict: true })).compile(schema);
  assert.equal(validate(config({ roots: ["~/Apps/dotfiles/skills", "/abs/skills"] })), true, JSON.stringify(validate.errors));
  for (const roots of [["relative"], ["/a/../b"], ["~x/y"], []]) assert.equal(validate(config({ roots })), false, JSON.stringify(roots));
});

test("a Skill resolves from the first root that has it, follows directory symlinks, and rejects invalid names", async () => {
  await workdir(async (directory) => {
    const first = join(directory, "first");
    const second = join(directory, "second");
    const elsewhere = join(directory, "elsewhere");
    await skill(second, "alpha", "second alpha");
    await skill(second, "beta");
    await skill(first, "alpha", "first alpha");
    await skill(elsewhere, "linked");
    await symlink(join(elsewhere, "linked"), join(first, "linked"));
    await mkdir(join(first, "empty"));
    assert.equal((await locateSkill("alpha", [first, second])).root, first);
    assert.equal((await locateSkill("alpha", [second, first])).root, second);
    assert.equal((await locateSkill("beta", [first, second])).path, join(second, "beta", "SKILL.md"));
    assert.equal((await locateSkill("linked", [first, second])).path, join(first, "linked", "SKILL.md"));
    assert.equal(await locateSkill("empty", [first, second]), undefined);
    assert.equal(await locateSkill("missing", [first, second]), undefined);
    for (const name of ["../alpha", "Alpha", "a/b", "", "1abc", "a".repeat(129)]) assert.equal(await locateSkill(name, [first, second]), undefined, name);
    const flow = { nodes: [{ id: "n1", skills: ["alpha", "beta"] }, { id: "n2", skills: ["alpha", "gone", "../bad"] }] };
    const { skills, missing } = await resolveFlowSkills(flow, [first, second]);
    assert.deepEqual(skills.alpha.nodes, ["n1", "n2"]);
    assert.equal(skills.alpha.sha256, sha("first alpha"));
    assert.deepEqual(missing.map(({ skill: name, nodes, reason }) => [name, nodes, reason]), [["gone", ["n2"], "not found"], ["../bad", ["n2"], "invalid name"]]);
  });
});

function runService(directory, roots, flow, configured = true) {
  const store = new FileStateStore(join(directory, "state"));
  const service = new RunService({ stateStore: store, createId: () => "run_skills", now: () => "2026-11-26T12:00:00Z",
    flowResolver: async () => ({ flowDefinition: flow, skillRoots: roots, skillRootsConfigured: configured }) });
  return { store, service };
}

const flow = { id: "skills-flow", nodes: [
  { id: "plan", skills: ["planner"] },
  { id: "build", after: ["plan"], skills: ["builder", "planner"] },
  { id: "extra", after: ["build"], when: { step: "plan", jsonPath: "go", equals: true }, skills: ["conditional-only"] }
] };

test("flow_start_guided fails with SKILL_MISSING listing skills, nodes and roots, and creates no run", async () => {
  await workdir(async (directory) => {
    const roots = [join(directory, "r1"), join(directory, "r2")];
    await skill(roots[0], "planner");
    const { store, service } = runService(directory, roots, flow);
    await assert.rejects(service.create({ flowId: flow.id, workspace: "/work/x", runtime: "codex", executionMode: "guided" }), (error) => {
      assert.equal(error.code, "SKILL_MISSING");
      assert.ok(error.message.length <= 500);
      assert.match(error.message, /builder \[not found; nodes: build\]/);
      assert.match(error.message, /conditional-only \[not found; nodes: extra\]/); // skipped-by-condition nodes count too
      assert.doesNotMatch(error.message, /planner \[/);
      assert.ok(error.message.includes(roots[0]) && error.message.includes(roots[1]));
      assert.deepEqual(error.details.missing.map((item) => item.skill), ["builder", "conditional-only"]);
      return true;
    });
    assert.deepEqual(await store.listRuns(), []);
  });
});

test("flow_next returns skillPaths with hashes, pins them in the run, and instructs reading the SKILL.md in full", async () => {
  await workdir(async (directory) => {
    const roots = [join(directory, "r1"), join(directory, "r2")];
    await skill(roots[0], "planner", "plan v1");
    await skill(roots[1], "builder", "build v1");
    await skill(roots[1], "conditional-only");
    const { store, service } = runService(directory, roots, flow);
    const run = await service.create({ flowId: flow.id, workspace: "/work/x", runtime: "codex", executionMode: "guided" });
    assert.equal(run.skillResolution.skills.planner.sha256, sha("plan v1"));
    assert.equal(run.skillResolution.configured, true);
    const next = await service.next(run.id);
    assert.equal(next.status, "ready");
    const [plan] = next.nodes;
    assert.deepEqual(plan.skillPaths, [{ name: "planner", path: join(roots[0], "planner", "SKILL.md"), sha256: sha("plan v1") }]);
    assert.match(plan.toolGuidance, /IN FULL every SKILL\.md listed in skillPaths/);
    assert.match(plan.toolGuidance, /references\//);
    assert.match(plan.toolGuidance, /only to this node/);
    assert.equal(plan.skillWarnings, undefined);
    assert.equal((await store.readRun(run.id)).skillResolution.skills.planner.path, plan.skillPaths[0].path);

    // A changed SKILL.md is recorded with both hashes; a vanished one fails flow_next without touching the run.
    await service.checkpoint(run.id, { schemaVersion: "v1", runId: run.id, nodeId: "plan", status: "completed", recordedAt: "2026-11-26T12:01:00Z", output: { go: false } });
    await skill(roots[1], "builder", "build v2");
    const second = await service.next(run.id);
    assert.equal(second.nodes[0].skillPaths.find((item) => item.name === "builder").sha256, sha("build v2"));
    const stored = await store.readRun(run.id);
    assert.deepEqual(stored.skillResolution.changes.map(({ skill: name, previousSha256, sha256 }) => ({ name, previousSha256, sha256 })),
      [{ name: "builder", previousSha256: sha("build v1"), sha256: sha("build v2") }]);
    assert.equal((await service.audit(run.id)).skillResolution.changes.length, 1);
    await rm(join(roots[1], "builder"), { recursive: true });
    await assert.rejects(service.next(run.id), { code: "SKILL_MISSING" });
    assert.equal((await store.readRun(run.id)).status, "running");
    await skill(roots[1], "builder", "build v2");
    assert.equal((await service.next(run.id)).status, "ready");
  });
});

test("without skills.roots the source falls back to ~/.agents/skills and ~/.claude/skills and still blocks", async () => {
  await workdir(async (directory) => {
    const flows = join(directory, "flows");
    await mkdir(flows);
    await writeFile(join(flows, "sample.json"), JSON.stringify({ schemaVersion: "v1", id: "sample", nodes: [{ id: "work", skills: ["only-here"] }] }));
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "work", mode: "local", path: flows, sync: { pull: "confirm", push: "manual" } }] }));
    const sources = new FlowSourceService({ configPath });
    await sources.initialize();
    const resolved = await sources.resolve({ flowId: "sample", profileId: "work", runtime: "codex" });
    assert.deepEqual(resolved.skillRoots, defaultSkillRoots());
    assert.equal(resolved.skillRootsConfigured, false);
    assert.deepEqual(defaultSkillRoots("/h"), ["/h/.agents/skills", "/h/.claude/skills"]);

    const home = join(directory, "home");
    const roots = defaultSkillRoots(home);
    const { store, service } = runService(directory, roots, { id: "sample", nodes: [{ id: "work", skills: ["only-here"] }] }, false);
    await assert.rejects(service.create({ flowId: "sample", workspace: "/w", runtime: "codex", executionMode: "guided" }), { code: "SKILL_MISSING" });
    await skill(roots[1], "only-here");
    const run = await service.create({ flowId: "sample", workspace: "/w", runtime: "codex", executionMode: "guided" });
    assert.equal(run.skillResolution.configured, false);
    assert.equal((await store.listRuns()).length, 1);
  });
});

test("a configured source passes its expanded roots to the run resolver", async () => {
  await workdir(async (directory) => {
    const flows = join(directory, "flows");
    const root = join(directory, "my-skills");
    await mkdir(flows);
    await skill(root, "planner");
    await writeFile(join(flows, "sample.json"), JSON.stringify({ schemaVersion: "v1", id: "sample", nodes: [{ id: "work", skills: ["planner"] }] }));
    const configPath = join(directory, "sources.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "work", mode: "local", path: flows, skills: { roots: [root] }, sync: { pull: "confirm", push: "manual" } }] }));
    const sources = new FlowSourceService({ configPath });
    await sources.initialize();
    const service = new RunService({ stateStore: new FileStateStore(join(directory, "state")), flowResolver: (selection) => sources.resolve(selection), createId: () => "run_cfg" });
    const run = await service.create({ flowId: "sample", profileId: "work", workspace: "/w", runtime: "codex", executionMode: "guided" });
    assert.deepEqual(run.skillResolution.roots, [root]);
    assert.equal(run.skillResolution.configured, true);
  });
});

const doctorSource = (skills) => ({
  sources: [{ id: "personal", mode: "local", ...(skills ? { skills } : {}) }],
  catalog: { listEntries: async () => [{ sourceId: "personal", flow: { id: "f", nodes: [{ id: "a", skills: ["present", "absent"] }] } }] },
  initialize: async () => {}
});
const doctorDeps = (sourceService, present) => ({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test", sourceService,
  client: { list: async () => ({ items: [{ id: "f" }] }) },
  runCommand: async () => ({ stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) }),
  fileAccess: async (path) => { if (!present.some((item) => path === item)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); } });

test("doctor reports missing Skills per skill with the roots searched, using configured skills.roots", async () => {
  const roots = ["/dot/skills", "/dot/claude/skills"];
  const result = await diagnoseFlowSetup(doctorDeps(doctorSource({ roots }), ["/dot/claude/skills/present/SKILL.md"]));
  const check = result.checks.find((item) => item.name === "skills");
  assert.equal(check.status, "failed");
  assert.deepEqual(check.missing, ["absent"]);
  assert.deepEqual(check.details, [{ skill: "absent", runtime: "codex", roots }]);
  assert.deepEqual(check.searchedRoots, roots);
  assert.ok(!JSON.stringify(check).includes(".claude/skills"));
});

test("doctor falls back to ~/.agents/skills and ~/.claude/skills without skills.roots", async () => {
  const result = await diagnoseFlowSetup(doctorDeps(doctorSource(), ["/home/test/.claude/skills/present/SKILL.md", "/home/test/.agents/skills/absent/SKILL.md"]));
  const check = result.checks.find((item) => item.name === "skills");
  assert.equal(check.status, "passed");
  assert.deepEqual(check.missing, []);
  assert.deepEqual(check.searchedRoots, ["/home/test/.agents/skills", "/home/test/.claude/skills"]);
});
