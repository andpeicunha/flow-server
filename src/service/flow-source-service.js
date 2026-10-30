import { stat } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
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

export class FlowSourceService {
  constructor({ configPath, loadConfig = loadFlowSourceConfig, createCatalog = (sources) => new FlowCatalog({ flowSources: sources }), gitIdentity = readGitIdentity, fs = { stat } } = {}) {
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
      sources.push({ ...source, ...(identity ? { gitCommit: identity.commit, currentBranch: identity.branch } : {}) });
    }
    this.sources = sources;
    this.catalog = this.createCatalog(sources);
    await this.catalog.listEntries();
    return this.status();
  }

  async list() {
    return (await this.catalog.listEntries()).map(({ flow, sourceId, contentHash }) => ({ id: flow.id, title: flow.title ?? flow.id, sourceId, contentHash, ...(this.sources.find((source) => source.id === sourceId)?.gitCommit ? { gitCommit: this.sources.find((source) => source.id === sourceId).gitCommit } : {}) }));
  }

  async resolve(flowId) {
    const entry = (await this.catalog.listEntries()).find((item) => item.flow.id === flowId);
    if (!entry) throw new FlowError("FLOW_NOT_FOUND", "The requested flow does not exist in a configured source.");
    const source = this.sources.find((item) => item.id === entry.sourceId);
    return { flowId: entry.flow.id, flowSourceId: entry.sourceId, flowContentHash: entry.contentHash, flowDefinition: structuredClone(entry.flow), ...(source?.gitCommit ? { flowGitCommit: source.gitCommit } : {}) };
  }

  status() {
    return this.sources.map(({ id, mode, path, remote, branch, currentBranch, gitCommit, sync }) => ({ id, mode, path, ...(remote ? { remote } : {}), ...(branch ? { branch } : {}), ...(currentBranch ? { currentBranch } : {}), ...(gitCommit ? { gitCommit } : {}), sync }));
  }
}
