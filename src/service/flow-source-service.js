import { realpath, stat } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { FlowCatalog } from "../core/flow-catalog.js";
import { FlowError } from "../core/errors.js";
import { loadFlowSourceConfig } from "../core/flow-source-config.js";

const execFile = promisify(execFileCallback);

async function readGitIdentity(path) {
  try {
    const [{ stdout: commit }, { stdout: branch }] = await Promise.all([
      execFile("git", ["-C", path, "rev-parse", "HEAD"], { timeout: 2_000 }),
      execFile("git", ["-C", path, "symbolic-ref", "--quiet", "--short", "HEAD"], { timeout: 2_000 })
    ]);
    return { commit: commit.trim(), branch: branch.trim() };
  } catch {
    throw new FlowError("INVALID_GIT_FLOW_SOURCE", "A configured Git flow source must be a worktree on an attached branch.");
  }
}

function containsPath(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function routeByTask(entries, task) {
  if (typeof task !== "string" || !task.trim()) return undefined;
  const text = task.toLocaleLowerCase();
  const matches = entries.map((entry) => {
    const routing = entry.flow.routing;
    const words = routing?.when ?? [];
    const avoid = routing?.avoid ?? [];
    const hit = (word) => new RegExp(`(^|[^\\p{L}\\p{N}_-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}_-]|$)`, "iu").test(text);
    const matched = words.filter(hit).length;
    const rejected = avoid.some(hit);
    return { entry, matched, rejected, priority: routing?.priority ?? 0 };
  }).filter((item) => item.matched > 0 && !item.rejected).sort((a, b) => b.priority - a.priority || b.matched - a.matched);
  if (!matches.length) return undefined;
  if (matches.length === 1) return { entry: matches[0].entry, reason: "unique local flow routing match" };
  return { ambiguous: true, candidates: matches.map(({ entry }) => entry) };
}

export class FlowSourceService {
  constructor({ configPath, loadConfig = loadFlowSourceConfig, createCatalog = (sources) => new FlowCatalog({ flowSources: sources }), gitIdentity = readGitIdentity, fs = { stat, realpath } } = {}) {
    this.configPath = configPath;
    this.loadConfig = loadConfig;
    this.createCatalog = createCatalog;
    this.fs = fs;
    this.gitIdentity = gitIdentity;
    this.sources = [];
    this.catalog = createCatalog([]);
  }

  async initialize() {
    if (!this.configPath) return this.status();
    const config = await this.loadConfig(this.configPath);
    const sources = [];
    for (const source of config.sources) {
      const info = await this.fs.stat(source.path).catch((error) => {
        if (error.code === "ENOENT") throw new FlowError("FLOW_SOURCE_NOT_FOUND", `Flow source ${source.id} does not exist.`);
        throw error;
      });
      if (!info.isDirectory()) throw new FlowError("FLOW_SOURCE_NOT_DIRECTORY", `Flow source ${source.id} must be a directory.`);
      const identity = source.mode === "git" ? await this.gitIdentity(source.path) : undefined;
      if (source.branch && identity?.branch !== source.branch) throw new FlowError("FLOW_SOURCE_BRANCH_MISMATCH", `Flow source ${source.id} is not on its configured branch.`);
      const workspaceRoots = [];
      for (const root of source.workspaceRoots ?? []) {
        const rootInfo = await this.fs.stat(root).catch((error) => {
          if (error.code === "ENOENT") throw new FlowError("WORKSPACE_ROOT_NOT_FOUND", `A workspace root for profile ${source.id} does not exist.`);
          throw error;
        });
        if (!rootInfo.isDirectory()) throw new FlowError("WORKSPACE_ROOT_NOT_DIRECTORY", `A workspace root for profile ${source.id} must be a directory.`);
        workspaceRoots.push(await this.fs.realpath(root));
      }
      sources.push({ ...source, path: await this.fs.realpath(source.path), workspaceRoots, ...(identity ? { gitCommit: identity.commit, currentBranch: identity.branch } : {}) });
    }
    this.sources = sources;
    this.catalog = this.createCatalog(sources);
    await this.catalog.listEntries();
    return this.status();
  }

  async list({ profileId } = {}) {
    await this.refreshGitIdentities();
    const entries = await this.catalog.listEntries();
    return entries.filter((entry) => !profileId || entry.sourceId === profileId).map(({ flow, sourceId, contentHash }) => ({ id: flow.id, title: flow.title ?? flow.name ?? flow.id, sourceId, profileId: sourceId, contentHash, ...(flow.description ? { description: flow.description } : {}), ...(this.sources.find((source) => source.id === sourceId)?.gitCommit ? { gitCommit: this.sources.find((source) => source.id === sourceId).gitCommit } : {}) }));
  }

  async profileForWorkspace(workspace) {
    if (typeof workspace !== "string" || !isAbsolute(workspace)) return undefined;
    let canonicalWorkspace;
    try { canonicalWorkspace = await this.fs.realpath(workspace); } catch { return undefined; }
    const matches = this.sources.flatMap((source) => source.workspaceRoots.map((root) => ({ source, root })))
      .filter(({ root }) => containsPath(root, canonicalWorkspace))
      .sort((a, b) => b.root.length - a.root.length);
    if (!matches.length) return undefined;
    const longest = matches.filter((item) => item.root.length === matches[0].root.length);
    const sourceIds = [...new Set(longest.map(({ source }) => source.id))];
    return sourceIds.length === 1 ? sourceIds[0] : undefined;
  }

  async selectFlow({ workspace, profileId, flowId, task } = {}) {
    const resolvedProfileId = profileId || await this.profileForWorkspace(workspace);
    if (!resolvedProfileId) {
      return { decision: "needs_confirmation", reason: "PROFILE_UNRESOLVED", profiles: this.sources.map(({ id }) => id) };
    }
    const source = this.sources.find((item) => item.id === resolvedProfileId);
    if (!source) throw new FlowError("PROFILE_NOT_FOUND", "The selected profile is not configured locally.");
    const entries = (await this.catalog.listEntries()).filter((entry) => entry.sourceId === resolvedProfileId);
    if (flowId) {
      const entry = entries.find((item) => item.flow.id === flowId);
      if (!entry) throw new FlowError("FLOW_NOT_FOUND", "The selected flow does not exist in the resolved profile.");
      return this.selection(entry, resolvedProfileId, "explicit flow selection");
    }
    const routed = routeByTask(entries, task);
    if (routed?.ambiguous) return { decision: "needs_confirmation", reason: "FLOW_AMBIGUOUS", profileId: resolvedProfileId, flows: routed.candidates.map(({ flow }) => ({ id: flow.id, title: flow.title ?? flow.name ?? flow.id })) };
    if (routed) return this.selection(routed.entry, resolvedProfileId, routed.reason);
    return { decision: "needs_confirmation", reason: "FLOW_UNRESOLVED", profileId: resolvedProfileId, flows: entries.map(({ flow }) => ({ id: flow.id, title: flow.title ?? flow.name ?? flow.id })) };
  }

  selection(entry, profileId, reason) {
    return { decision: "ready", reason, profileId, flowId: entry.flow.id, flowSourceId: entry.sourceId, flowContentHash: entry.contentHash };
  }

  async resolve(flowIdOrSelection, options = {}) {
    const selection = typeof flowIdOrSelection === "object" && flowIdOrSelection !== null
      ? flowIdOrSelection
      : { ...options, flowId: flowIdOrSelection };
    const { flowId, profileId, workspace } = selection;
    const selected = await this.selectFlow({ flowId, profileId, workspace });
    if (selected.decision !== "ready") throw new FlowError("FLOW_SELECTION_REQUIRED", "Workspace profile is unknown. Confirm the correct local profile before starting a run.");
    const entry = (await this.catalog.listEntries()).find((item) => item.flow.id === selected.flowId && item.sourceId === selected.profileId);
    const source = this.sources.find((item) => item.id === entry.sourceId);
    const gitIdentity = source?.mode === "git" ? await this.gitIdentity(source.path) : undefined;
    if (source?.branch && gitIdentity?.branch !== source.branch) throw new FlowError("FLOW_SOURCE_BRANCH_MISMATCH", `Flow source ${source.id} is not on its configured branch.`);
    if (source && gitIdentity) Object.assign(source, { gitCommit: gitIdentity.commit, currentBranch: gitIdentity.branch });
    return { flowId: entry.flow.id, profileId: selected.profileId, flowSourceId: entry.sourceId, flowContentHash: entry.contentHash, flowDefinition: structuredClone(entry.flow), ...(gitIdentity?.commit ? { flowGitCommit: gitIdentity.commit } : {}) };
  }

  async refreshGitIdentities() {
    for (const source of this.sources) {
      if (source.mode !== "git") continue;
      const identity = await this.gitIdentity(source.path);
      if (source.branch && identity.branch !== source.branch) throw new FlowError("FLOW_SOURCE_BRANCH_MISMATCH", `Flow source ${source.id} is not on its configured branch.`);
      Object.assign(source, { gitCommit: identity.commit, currentBranch: identity.branch });
    }
  }

  async status() {
    await this.refreshGitIdentities();
    return this.sources.map(({ id, mode, path, remote, branch, currentBranch, gitCommit, sync, workspaceRoots }) => ({ id, mode, path, ...(workspaceRoots.length ? { workspaceRoots } : {}), ...(remote ? { remote } : {}), ...(branch ? { branch } : {}), ...(currentBranch ? { currentBranch } : {}), ...(gitCommit ? { gitCommit } : {}), sync }));
  }
}
