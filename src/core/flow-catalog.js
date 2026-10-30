import { readdir, readFile, realpath } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { FlowError } from "./errors.js";
import { identifyFlowDocument, parseFlowDocument, validateFlowDocument } from "./flow-document.js";

const flowIdPattern = /^[a-z][a-z0-9-]{0,62}$/;

function isWithin(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !path.includes("../"));
}

async function loadDirectory(directory, fs, sourceId) {
  const root = await fs.realpath(directory).catch(() => {
    throw new FlowError("FLOW_SOURCE_NOT_FOUND", "An explicitly configured flow source does not exist.");
  });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const flows = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || ![".json", ".yaml", ".yml"].includes(extname(entry.name))) continue;
    const file = resolve(root, entry.name);
    const canonicalFile = await fs.realpath(file);
    if (!isWithin(root, canonicalFile)) throw new FlowError("FLOW_SOURCE_ESCAPE", "A flow source resolves outside its authorized root.");
    const format = entry.name.endsWith(".json") ? "json" : "yaml";
    const flow = parseFlowDocument(await fs.readFile(canonicalFile, "utf8"), { format, source: entry.name });
    const { contentHash } = identifyFlowDocument(flow);
    flows.push({ flow, sourceId, contentHash });
  }
  return flows;
}

/**
 * Loads only explicitly configured directories. It never searches $HOME.
 * YAML and JSON pass through the same strict v1 validation and path controls.
 */
export class FlowCatalog {
  constructor({ coreFlows = [], flowDirectories = [], flowSources = [], profileDirectory, profileName, fs = { readdir, readFile, realpath } } = {}) {
    this.coreFlows = coreFlows.map((flow) => ({ flow: validateFlowDocument(flow), sourceId: "core", contentHash: identifyFlowDocument(flow).contentHash }));
    this.flowSources = [
      ...flowDirectories.map((path, index) => ({ id: `external-${index + 1}`, path })),
      ...flowSources
    ];
    this.profileDirectory = profileDirectory;
    this.profileName = profileName;
    this.fs = fs;
  }

  async listEntries() {
    if (this.profileName && !this.profileDirectory) throw new FlowError("PROFILE_ROOT_REQUIRED", "A selected profile requires an explicitly configured profile root.");
    if (this.profileName && !flowIdPattern.test(this.profileName)) throw new FlowError("INVALID_PROFILE_NAME", "Profile names must use lowercase letters, numbers, and hyphens.");
    const loaded = [...this.coreFlows];
    for (const source of this.flowSources) loaded.push(...await loadDirectory(source.path, this.fs, source.id));
    if (this.profileName) {
      const root = await this.fs.realpath(this.profileDirectory).catch(() => {
        throw new FlowError("PROFILE_ROOT_NOT_FOUND", "The explicitly configured profile root does not exist.");
      });
      const profile = resolve(root, this.profileName);
      const canonicalProfile = await this.fs.realpath(profile).catch(() => {
        throw new FlowError("PROFILE_NOT_FOUND", "The selected profile does not exist under the configured root.");
      });
      if (!isWithin(root, canonicalProfile)) throw new FlowError("PROFILE_ESCAPE", "The selected profile resolves outside its authorized root.");
      loaded.push(...await loadDirectory(canonicalProfile, this.fs, `profile-${this.profileName}`));
    }
    return [...loaded.reduce((flows, entry) => flows.set(entry.flow.id, entry), new Map()).values()];
  }

  async list() {
    return (await this.listEntries()).map((entry) => entry.flow);
  }
}
