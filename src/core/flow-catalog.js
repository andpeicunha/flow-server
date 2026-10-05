import { readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { FlowError } from "./errors.js";

const flowIdPattern = /^[a-z][a-z0-9-]{0,62}$/;

function isWithin(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !path.includes("../"));
}

function validateFlow(flow, source) {
  if (!flow || flow.schemaVersion !== "v1" || !flowIdPattern.test(flow.id) || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    throw new FlowError("INVALID_FLOW_DOCUMENT", `Invalid v1 flow document in ${source}.`);
  }
  return flow;
}

async function loadDirectory(directory, fs) {
  const root = await fs.realpath(directory).catch(() => {
    throw new FlowError("FLOW_SOURCE_NOT_FOUND", "An explicitly configured flow source does not exist.");
  });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const flows = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = resolve(root, entry.name);
    const canonicalFile = await fs.realpath(file);
    if (!isWithin(root, canonicalFile)) throw new FlowError("FLOW_SOURCE_ESCAPE", "A flow source resolves outside its authorized root.");
    let document;
    try {
      document = JSON.parse(await fs.readFile(canonicalFile, "utf8"));
    } catch {
      throw new FlowError("INVALID_FLOW_DOCUMENT", "A configured flow document is not valid JSON.");
    }
    flows.push(validateFlow(document, entry.name));
  }
  return flows;
}

/**
 * Loads only explicitly configured directories. It never searches $HOME.
 * JSON is the canonical v1 transport format; YAML authoring support is added
 * only when a parser with equivalent path controls is introduced.
 */
export class FlowCatalog {
  constructor({ coreFlows = [], flowDirectories = [], profileDirectory, profileName, fs = { readdir, readFile, realpath } } = {}) {
    this.coreFlows = coreFlows.map((flow) => validateFlow(flow, "core flow"));
    this.flowDirectories = flowDirectories;
    this.profileDirectory = profileDirectory;
    this.profileName = profileName;
    this.fs = fs;
  }

  async list() {
    if (this.profileName && !this.profileDirectory) throw new FlowError("PROFILE_ROOT_REQUIRED", "A selected profile requires an explicitly configured profile root.");
    if (this.profileName && !flowIdPattern.test(this.profileName)) throw new FlowError("INVALID_PROFILE_NAME", "Profile names must use lowercase letters, numbers, and hyphens.");
    const loaded = [...this.coreFlows];
    for (const directory of this.flowDirectories) loaded.push(...await loadDirectory(directory, this.fs));
    if (this.profileName) {
      const root = await this.fs.realpath(this.profileDirectory).catch(() => {
        throw new FlowError("PROFILE_ROOT_NOT_FOUND", "The explicitly configured profile root does not exist.");
      });
      const profile = resolve(root, this.profileName);
      const canonicalProfile = await this.fs.realpath(profile).catch(() => {
        throw new FlowError("PROFILE_NOT_FOUND", "The selected profile does not exist under the configured root.");
      });
      if (!isWithin(root, canonicalProfile)) throw new FlowError("PROFILE_ESCAPE", "The selected profile resolves outside its authorized root.");
      loaded.push(...await loadDirectory(canonicalProfile, this.fs));
    }
    return [...loaded.reduce((flows, flow) => flows.set(flow.id, flow), new Map()).values()];
  }
}
