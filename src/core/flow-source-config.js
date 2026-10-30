import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { isAlias, parseDocument, visit } from "yaml";
import { FlowError } from "./errors.js";

const identifier = /^[a-z][a-z0-9-]{0,62}$/;
const remoteName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const pushPolicies = new Set(["manual", "confirm", "after-validation"]);

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function validateFlowSourceConfig(value) {
  const invalidRoot = !value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== "v1" || !Array.isArray(value.sources)
    || value.sources.length > 32 || !exactKeys(value, new Set(["schemaVersion", "sources"]));
  if (invalidRoot) throw new FlowError("INVALID_FLOW_SOURCE_CONFIG", "Flow source configuration must use the v1 schema.");

  const ids = new Set();
  const sources = value.sources.map((source) => {
    const allowed = new Set(["id", "mode", "path", "remote", "branch", "sync"]);
    const validSync = source?.sync && typeof source.sync === "object" && !Array.isArray(source.sync)
      && exactKeys(source.sync, new Set(["pull", "push"]))
      && source.sync.pull === "confirm" && pushPolicies.has(source.sync.push);
    const valid = source && typeof source === "object" && !Array.isArray(source)
      && exactKeys(source, allowed) && identifier.test(source.id) && ["local", "git"].includes(source.mode)
      && typeof source.path === "string" && source.path.length <= 4096 && isAbsolute(source.path)
      && validSync;
    if (!valid || ids.has(source?.id)) throw new FlowError("INVALID_FLOW_SOURCE_CONFIG", "Each flow source must have a unique ID, an absolute path, a mode, and safe sync policies.");
    if (source.mode === "local" && (source.remote !== undefined || source.branch !== undefined)) {
      throw new FlowError("INVALID_FLOW_SOURCE_CONFIG", "Local flow sources cannot configure a Git remote or branch.");
    }
    if (source.mode === "git" && ((source.remote !== undefined && !remoteName.test(source.remote)) || (source.branch !== undefined && (typeof source.branch !== "string" || source.branch.length < 1 || source.branch.length > 255)))) {
      throw new FlowError("INVALID_FLOW_SOURCE_CONFIG", "Git source remote or branch is invalid.");
    }
    ids.add(source.id);
    return structuredClone(source);
  });
  return { schemaVersion: "v1", sources };
}

export async function loadFlowSourceConfig(filePath, { fs = { readFile, realpath } } = {}) {
  if (!filePath || !isAbsolute(filePath)) throw new FlowError("INVALID_FLOW_SOURCE_CONFIG_PATH", "Flow source configuration path must be absolute.");
  let content;
  try {
    content = await fs.readFile(await fs.realpath(filePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new FlowError("FLOW_SOURCE_CONFIG_NOT_FOUND", "The configured flow source file does not exist.");
    throw error;
  }
  if (Buffer.byteLength(content) > 64 * 1024) throw new FlowError("FLOW_SOURCE_CONFIG_TOO_LARGE", "Flow source configuration exceeds 64 KiB.");
  let value;
  try {
    if ([".yaml", ".yml"].includes(extname(filePath))) {
      const document = parseDocument(content, { schema: "core", uniqueKeys: true, merge: false, maxAliasCount: 0, strict: true });
      if (document.errors.length) throw new Error("invalid YAML");
      let unsafe = false;
      visit(document, {
        Node(_key, node) { if (isAlias(node) || node.anchor || (node.tag && !node.tag.startsWith("tag:yaml.org,2002:"))) unsafe = true; },
        Pair(_key, pair) { if (pair.key?.value === "<<") unsafe = true; }
      });
      if (unsafe) throw new Error("unsafe YAML");
      value = document.toJS({ maxAliasCount: 0 });
    } else value = JSON.parse(content);
  } catch {
    throw new FlowError("INVALID_FLOW_SOURCE_CONFIG", "Flow source configuration must be safe valid JSON or YAML.");
  }
  return validateFlowSourceConfig(value);
}
