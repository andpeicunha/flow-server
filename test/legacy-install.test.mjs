import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateLegacyInstallation } from "../scripts/migrate-legacy-install.mjs";

test("legacy installation migrates flows before removing its known entrypoints", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-install-"));
  try {
    const dotfiles = join(homeDir, "Apps", "dotfiles");
    const oldRoot = join(dotfiles, "opencode", "flow-runner");
    const oldPlugin = join(dotfiles, "herdr", "flow-tui-bridge");
    const oldWrapper = join(homeDir, ".local", "bin", "flow");
    const configPath = join(homeDir, ".config", "flow-server", "sources.json");
    await mkdir(join(oldRoot, "flows", "profiles", "sample"), { recursive: true });
    await mkdir(oldPlugin, { recursive: true });
    await mkdir(join(homeDir, ".local", "bin"), { recursive: true });
    await mkdir(join(homeDir, ".local", "state", "flow-runs"), { recursive: true });
    await writeFile(join(homeDir, ".local", "state", "flow-runs", "log.txt"), "old log\n");
    await mkdir(join(homeDir, ".config", "flow-server"), { recursive: true });
    await writeFile(join(oldRoot, "package.json"), JSON.stringify({ name: "omo-flow-runner" }));
    await writeFile(join(oldRoot, "flows", "profiles", "sample", "work.yaml"), "schemaVersion: v1\nid: work\nnodes: [{ id: task }]\n");
    await writeFile(join(oldPlugin, "herdr-plugin.toml"), 'id = "andpeicunha.flow-tui-bridge"\n');
    await writeFile(oldWrapper, "#!/bin/sh\n# opencode/flow-runner\nnpm run run-flow\n");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "v1", sources: [{ id: "sample", mode: "local", path: join(oldRoot, "flows", "profiles", "sample"), sync: { pull: "confirm", push: "manual" } }] }));
    const calls = [];
    const runCommand = async (command, args) => { calls.push([command, args]); return { stdout: command === "herdr" ? "- andpeicunha.flow-tui-bridge enabled [local:/old]\n" : "" }; };
    const result = await migrateLegacyInstallation({ homeDir, runCommand });
    assert.equal(result.migrated, 1);
    assert.match(await readFile(join(dotfiles, "flows", "profiles", "sample", "work.yaml"), "utf8"), /id: work/);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).sources[0].path, join(dotfiles, "flows", "profiles", "sample"));
    await assert.rejects(readFile(oldWrapper), { code: "ENOENT" });
    await assert.rejects(readFile(join(oldRoot, "package.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(oldPlugin, "herdr-plugin.toml")), { code: "ENOENT" });
    assert.equal(await readFile(join(homeDir, ".local", "share", "flow-server", "legacy-runs", "log.txt"), "utf8"), "old log\n");
    assert.ok(calls.some(([command, args]) => command === "herdr" && args[1] === "unlink"));
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});

test("legacy installer preserves conflicting flow copies", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-conflict-"));
  try {
    const dotfiles = join(homeDir, "Apps", "dotfiles");
    const oldRoot = join(dotfiles, "opencode", "flow-runner");
    const newFlows = join(dotfiles, "flows");
    await mkdir(join(oldRoot, "flows"), { recursive: true });
    await mkdir(newFlows, { recursive: true });
    await writeFile(join(oldRoot, "package.json"), JSON.stringify({ name: "omo-flow-runner" }));
    await writeFile(join(oldRoot, "flows", "work.yaml"), "schemaVersion: v1\nid: work\nnodes: [{ id: task }]\n");
    await writeFile(join(newFlows, "work.yaml"), "schemaVersion: v1\nid: other\nnodes: [{ id: task }]\n");
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand: async () => ({ stdout: "" }) }), /Flow migration conflict/);
    assert.match(await readFile(join(oldRoot, "flows", "work.yaml"), "utf8"), /id: work/);
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});

test("unknown command blocks every deletion before migration starts", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-unknown-"));
  try {
    const oldRoot = join(homeDir, "Apps", "dotfiles", "opencode", "flow-runner");
    const wrapper = join(homeDir, ".local", "bin", "flow");
    await mkdir(join(oldRoot, "flows"), { recursive: true });
    await mkdir(join(homeDir, ".local", "bin"), { recursive: true });
    await writeFile(join(oldRoot, "package.json"), JSON.stringify({ name: "omo-flow-runner" }));
    await writeFile(join(oldRoot, "flows", "work.yaml"), "schemaVersion: v1\nid: work\nnodes: [{ id: task }]\n");
    await writeFile(wrapper, "another user's flow command\n");
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand: async () => ({ stdout: "" }) }), /Unknown flow command/);
    assert.match(await readFile(join(oldRoot, "flows", "work.yaml"), "utf8"), /id: work/);
    assert.equal(await readFile(wrapper, "utf8"), "another user's flow command\n");
    await assert.rejects(readFile(join(homeDir, "Apps", "dotfiles", "flows", "work.yaml")), { code: "ENOENT" });
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});

test("dirty runner blocks cleanup while old logs stay untouched", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-dirty-"));
  try {
    const oldRoot = join(homeDir, "Apps", "dotfiles", "opencode", "flow-runner");
    const state = join(homeDir, ".local", "state", "flow-runs");
    await mkdir(join(oldRoot, "flows"), { recursive: true });
    await mkdir(state, { recursive: true });
    await writeFile(join(oldRoot, "package.json"), JSON.stringify({ name: "omo-flow-runner" }));
    await writeFile(join(oldRoot, "flows", "work.yaml"), "schemaVersion: v1\nid: work\nnodes: [{ id: task }]\n");
    await writeFile(join(state, "personal.txt"), "keep this\n");
    const dirty = async (command, args) => ({ stdout: command === "git" && args.includes("--porcelain") ? " M work.yaml\n" : "" });
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand: dirty }), /local edits/);
    const ignored = async (command, args) => ({ stdout: command === "git" && args.includes("--ignored") ? "!! personal-cache/\n" : "" });
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand: ignored }), /unknown ignored files/);
    assert.match(await readFile(join(oldRoot, "flows", "work.yaml"), "utf8"), /id: work/);
    assert.equal(await readFile(join(state, "personal.txt"), "utf8"), "keep this\n");
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});

test("legacy logs are archived intact and an existing archive blocks migration", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-state-"));
  try {
    const state = join(homeDir, ".local", "state", "flow-runs");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "notes.txt"), "keep this\n");
    const archive = join(homeDir, ".local", "share", "flow-server", "legacy-runs");
    await mkdir(archive, { recursive: true });
    await writeFile(join(archive, "previous.txt"), "older archive\n");
    const runCommand = async () => ({ stdout: "" });
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand }), /archive already exists/);
    assert.equal(await readFile(join(state, "notes.txt"), "utf8"), "keep this\n");
    assert.equal(await readFile(join(archive, "previous.txt"), "utf8"), "older archive\n");
    await rm(archive, { recursive: true });
    await migrateLegacyInstallation({ homeDir, runCommand });
    assert.equal(await readFile(join(archive, "notes.txt"), "utf8"), "keep this\n");
    await migrateLegacyInstallation({ homeDir, runCommand });
    assert.equal(await readFile(join(archive, "notes.txt"), "utf8"), "keep this\n");
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});

test("only known generated directories may remain after a Git update", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-orphan-"));
  try {
    const oldRoot = join(homeDir, "Apps", "dotfiles", "opencode", "flow-runner");
    await mkdir(join(oldRoot, "node_modules"), { recursive: true });
    await mkdir(join(oldRoot, "dist"), { recursive: true });
    await migrateLegacyInstallation({ homeDir, runCommand: async () => ({ stdout: "" }) });
    await assert.rejects(readFile(join(oldRoot, "dist", "missing")), { code: "ENOENT" });
    await mkdir(oldRoot, { recursive: true });
    await writeFile(join(oldRoot, "personal.txt"), "keep\n");
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand: async () => ({ stdout: "" }) }), /Unknown residual files/);
    assert.equal(await readFile(join(oldRoot, "personal.txt"), "utf8"), "keep\n");
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});

test("a linked destination cannot replace a copied flow", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "flow-legacy-link-"));
  try {
    const dotfiles = join(homeDir, "Apps", "dotfiles");
    const oldRoot = join(dotfiles, "opencode", "flow-runner");
    const oldFlow = join(oldRoot, "flows", "work.yaml");
    const newFlows = join(dotfiles, "flows");
    await mkdir(join(oldRoot, "flows"), { recursive: true });
    await mkdir(newFlows, { recursive: true });
    await writeFile(join(oldRoot, "package.json"), JSON.stringify({ name: "omo-flow-runner" }));
    await writeFile(oldFlow, "schemaVersion: v1\nid: work\nnodes: [{ id: task }]\n");
    await symlink(oldFlow, join(newFlows, "work.yaml"));
    await assert.rejects(migrateLegacyInstallation({ homeDir, runCommand: async () => ({ stdout: "" }) }), /Flow destination contains a link/);
    assert.match(await readFile(oldFlow, "utf8"), /id: work/);
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});
