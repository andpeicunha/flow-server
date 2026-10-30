import { createHash } from "node:crypto";
import { isAlias, parseDocument, visit } from "yaml";
import { FlowError } from "./errors.js";

const identifier = /^[a-z][a-z0-9-]{0,62}$/;
const allowedRoot = new Set(["schemaVersion", "id", "title", "nodes"]);
const allowedNode = new Set(["id", "title", "dependsOn"]);
export const flowDocumentLimits = Object.freeze({ bytes: 256 * 1024, depth: 32, scalarLength: 64 * 1024, collectionLength: 2048 });

function fail(message = "Flow document does not match the v1 schema.") {
  throw new FlowError("INVALID_FLOW_DOCUMENT", message);
}

function validateLimits(value, depth = 0) {
  if (depth > flowDocumentLimits.depth) fail("Flow document exceeds the maximum nesting depth.");
  if (typeof value === "string" && value.length > flowDocumentLimits.scalarLength) fail("Flow document contains an oversized scalar.");
  if (Array.isArray(value)) {
    if (value.length > flowDocumentLimits.collectionLength) fail("Flow document contains an oversized collection.");
    for (const item of value) validateLimits(item, depth + 1);
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > flowDocumentLimits.collectionLength) fail("Flow document contains an oversized collection.");
    for (const [key, item] of entries) {
      validateLimits(key, depth + 1);
      validateLimits(item, depth + 1);
    }
  }
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function validateFlowDocument(value) {
  const validRoot = value && typeof value === "object" && !Array.isArray(value)
    && exactKeys(value, allowedRoot) && value.schemaVersion === "v1"
    && identifier.test(value.id) && (value.title === undefined || (typeof value.title === "string" && value.title.length >= 1 && value.title.length <= 160))
    && Array.isArray(value.nodes) && value.nodes.length >= 1;
  if (!validRoot) fail();

  const nodeIds = new Set();
  for (const node of value.nodes) {
    const validNode = node && typeof node === "object" && !Array.isArray(node) && exactKeys(node, allowedNode)
      && identifier.test(node.id) && typeof node.title === "string" && node.title.length >= 1 && node.title.length <= 160
      && (node.dependsOn === undefined || (Array.isArray(node.dependsOn) && new Set(node.dependsOn).size === node.dependsOn.length && node.dependsOn.every((id) => identifier.test(id))));
    if (!validNode || nodeIds.has(node?.id)) fail("Flow nodes must have unique valid IDs, titles, and dependency lists.");
    nodeIds.add(node.id);
  }
  for (const node of value.nodes) {
    if ((node.dependsOn ?? []).some((dependency) => !nodeIds.has(dependency) || dependency === node.id)) fail("Flow dependencies must reference another node in the same document.");
  }
  validateLimits(value);
  return structuredClone(value);
}

export function parseFlowDocument(content, { format, source = "flow document" } = {}) {
  if (typeof content !== "string" || Buffer.byteLength(content) > flowDocumentLimits.bytes) fail("Flow document exceeds 256 KiB.");
  const selectedFormat = format ?? "yaml";
  let value;
  try {
    if (selectedFormat === "json") value = JSON.parse(content);
    else if (selectedFormat === "yaml") {
      const document = parseDocument(content, { schema: "core", uniqueKeys: true, merge: false, maxAliasCount: 0, strict: true });
      if (document.errors.length) fail(`Invalid YAML in ${source}.`);
      let unsafe = false;
      visit(document, {
        Node(_key, node) {
          if (isAlias(node) || node.anchor || (node.tag && !node.tag.startsWith("tag:yaml.org,2002:"))) unsafe = true;
        },
        Pair(_key, pair) {
          if (pair.key?.value === "<<") unsafe = true;
        }
      });
      if (unsafe) fail(`Unsafe YAML feature in ${source}.`);
      value = document.toJS({ maxAliasCount: 0 });
    } else fail("Flow document format must be yaml or json.");
  } catch (error) {
    if (error instanceof FlowError) throw error;
    fail(`Invalid ${selectedFormat.toUpperCase()} in ${source}.`);
  }
  return validateFlowDocument(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

export function canonicalizeFlowDocument(value) {
  const flow = validateFlowDocument(value);
  return `${JSON.stringify(canonicalValue(flow))}\n`;
}

export function identifyFlowDocument(value) {
  const canonical = canonicalizeFlowDocument(value);
  return { flow: validateFlowDocument(value), canonical, contentHash: createHash("sha256").update(canonical).digest("hex") };
}
