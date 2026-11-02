#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseFlowDocument } from "../src/core/flow-document.js";
import { validateFlowSourceConfig } from "../src/core/flow-source-config.js";

const execFile = promisify(execFileCallback);
const exists = async (path) => lstat(path).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
const hash = (content) => createHash("sha256").update(content).digest("hex");

async function filesUnder(root, current = root) {
  if (!await exists(root)) return [];
  if (!(await lstat(root)).isDirectory()) throw new Error(`Legacy flow root is not a directory: ${root}`);
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in legacy flows: ${path}`);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported legacy flow entry: ${path}`);
  }
  return files;
}

async function assertCleanRepo(path, runCommand) {
  const { stdout } = await runCommand("git", ["-C", path, "status", "--porcelain", "--untracked-files=all", "--", "."], { timeout: 5_000 });
  if (stdout.trim()) throw new Error(`Legacy source has local edits; review them before plugin installation: ${path}`);
  const ignored = await runCommand("git", ["-C", path, "status", "--ignored", "--short", "--", "."], { timeout: 5_000 });
  const unknown = ignored.stdout.split("\n").filter(Boolean).filter((line) => !["!! dist/", "!! node_modules/"].includes(line));
  if (unknown.length) throw new Error(`Legacy source has unknown ignored files; review them before plugin installation: ${path}`);
}

export async function migrateLegacyInstallation({ homeDir = homedir(), runCommand = execFile } = {}) {
  const dotfiles = join(homeDir, "Apps", "dotfiles");
  const oldRoot = join(dotfiles, "opencode", "flow-runner");
  const oldFlows = join(oldRoot, "flows");
  const newFlows = join(dotfiles, "flows");
  const oldPlugin = join(dotfiles, "herdr", "flow-tui-bridge");
  const oldPluginConfig = join(homeDir, ".config", "herdr", "plugins", "config", "andpeicunha.flow-tui-bridge");
  const oldWrapper = join(homeDir, ".local", "bin", "flow");
  const oldState = join(homeDir, ".local", "state", "flow-runs");
  const archivedState = join(homeDir, ".local", "share", "flow-server", "legacy-runs");
  const sourceConfig = join(homeDir, ".config", "flow-server", "sources.json");

  // Complete every check before the first copy or deletion.
  const hasOldRoot = await exists(oldRoot);
  const hasOldPlugin = await exists(oldPlugin);
  if (hasOldRoot && !(await lstat(oldRoot)).isDirectory()) throw new Error(`Unknown runner path: ${oldRoot}`);
  if (hasOldPlugin && !(await lstat(oldPlugin)).isDirectory()) throw new Error(`Unknown plugin path: ${oldPlugin}`);
  if (await exists(newFlows) && !(await lstat(newFlows)).isDirectory()) throw new Error(`Flow destination must be a real directory: ${newFlows}`);
  const files = hasOldRoot ? await filesUnder(oldFlows) : [];
  if (hasOldRoot) {
    if (await exists(join(oldRoot, "package.json"))) {
      const packageFile = JSON.parse(await readFile(join(oldRoot, "package.json"), "utf8"));
      if (packageFile.name !== "omo-flow-runner") throw new Error(`Unknown runner at ${oldRoot}; no files removed.`);
      await assertCleanRepo(oldRoot, runCommand);
    } else {
      const entries = await readdir(oldRoot, { withFileTypes: true });
      if (!entries.length || !entries.every((entry) => entry.isDirectory() && ["node_modules", "dist"].includes(entry.name))) {
        throw new Error(`Unknown residual files at ${oldRoot}; no files removed.`);
      }
    }
    for (const file of files) {
      const extension = extname(file);
      if (![".yaml", ".yml", ".json"].includes(extension)) throw new Error(`Unknown file in legacy flows: ${file}`);
      const content = await readFile(file);
      parseFlowDocument(content.toString("utf8"), { format: extension === ".json" ? "json" : "yaml" });
      const target = join(newFlows, relative(oldFlows, file));
      for (let parent = dirname(target); parent.startsWith(newFlows) && parent !== newFlows; parent = dirname(parent)) {
        if (await exists(parent) && !(await lstat(parent)).isDirectory()) throw new Error(`Flow destination contains a link or file: ${parent}`);
      }
      if (await exists(target) && !(await lstat(target)).isFile()) throw new Error(`Flow destination contains a link or directory: ${target}`);
      if (await exists(target) && hash(content) !== hash(await readFile(target))) throw new Error(`Flow migration conflict: ${target}`);
    }
  }
  if (hasOldPlugin) {
    const manifest = await readFile(join(oldPlugin, "herdr-plugin.toml"), "utf8");
    if (!/^id = "andpeicunha\.flow-tui-bridge"$/m.test(manifest)) throw new Error(`Unknown plugin at ${oldPlugin}; no plugin source removed.`);
    await assertCleanRepo(oldPlugin, runCommand);
  }
  let removeWrapper = false;
  if (await exists(oldWrapper)) {
    const info = await lstat(oldWrapper);
    if (info.isFile()) {
      const content = await readFile(oldWrapper, "utf8");
      if (!content.includes("opencode/flow-runner") || !content.includes("run-flow")) throw new Error(`Unknown flow command at ${oldWrapper}; no command removed.`);
      removeWrapper = true;
    } else if (info.isSymbolicLink()) {
      const target = await readlink(oldWrapper);
      if (target.includes("opencode/flow-runner")) removeWrapper = true;
      else if (!target.includes("flow-server/src/cli/flow.mjs")) throw new Error(`Unknown flow command link at ${oldWrapper}; no command removed.`);
    } else throw new Error(`Unknown flow command at ${oldWrapper}; no command removed.`);
  }
  const legacySkills = [join(dotfiles, "skills", "flow-server-routing", "legacy-routing.md"),
    join(homeDir, ".config", "opencode", "skills", "flow-server-routing", "legacy-routing.md")];
  for (const file of legacySkills) {
    if (!await exists(file)) continue;
    const content = await readFile(file, "utf8");
    if (!content.includes("flow-tui-bridge") || !content.includes("flow-runner")) throw new Error(`Unknown legacy Skill file: ${file}`);
  }
  if (await exists(oldState)) {
    if (!(await lstat(oldState)).isDirectory()) throw new Error(`Unknown legacy run state: ${oldState}`);
    if (await exists(archivedState)) throw new Error(`Legacy run archive already exists: ${archivedState}`);
  }
  let pluginRemoval;
  try {
    const { stdout } = await runCommand("herdr", ["plugin", "list"], { timeout: 5_000 });
    const line = stdout.split("\n").find((item) => item.startsWith("- andpeicunha.flow-tui-bridge "));
    if (line) pluginRemoval = line.includes("[local:") ? "unlink" : "uninstall";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let nextConfig;
  if (await exists(sourceConfig)) {
    const config = JSON.parse(await readFile(sourceConfig, "utf8"));
    for (const source of config.sources ?? []) {
      if (source.path === oldFlows || source.path.startsWith(`${oldFlows}/`)) {
        if (!hasOldRoot) throw new Error(`Source still points to a missing legacy runner: ${source.id}`);
        const target = join(newFlows, relative(oldFlows, source.path));
        if (!await exists(target) && files.length === 0) throw new Error(`Migrated source is missing: ${target}`);
        source.path = target;
        nextConfig = config;
      }
    }
    validateFlowSourceConfig(config);
  }

  for (const file of files) {
    const target = join(newFlows, relative(oldFlows, file));
    await mkdir(dirname(target), { recursive: true });
    if (!await exists(target)) await copyFile(file, target);
  }
  if (nextConfig) {
    const next = `${sourceConfig}.migration-${process.pid}`;
    await writeFile(next, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(next, sourceConfig);
  }
  if (pluginRemoval) await runCommand("herdr", ["plugin", pluginRemoval, "andpeicunha.flow-tui-bridge"], { timeout: 10_000 });
  if (removeWrapper) await rm(oldWrapper);
  for (const file of legacySkills) if (await exists(file)) await rm(file);
  if (hasOldRoot) await rm(oldRoot, { recursive: true });
  if (hasOldPlugin) await rm(oldPlugin, { recursive: true });
  if (await exists(oldPluginConfig)) {
    try { await rmdir(oldPluginConfig); }
    catch (error) { if (error.code !== "ENOTEMPTY") throw error; }
  }
  if (await exists(oldState)) {
    await mkdir(dirname(archivedState), { recursive: true });
    await rename(oldState, archivedState);
  }
  return { migrated: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateLegacyInstallation().then(({ migrated }) => console.log(`Legacy flow cleanup complete (${migrated} flows migrated).`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
