import { createHash } from "node:crypto";
import { isAlias, parseDocument, visit } from "yaml";
import { FlowError } from "./errors.js";

const identifier = /^[a-z][a-z0-9-]{0,62}$/;
const nodeIdentifier = /^[a-z][a-z0-9_-]{0,62}$/;
const safeText = (value, max = 64 * 1024) => typeof value === "string" && value.length <= max;
const rootKeys = new Set(["schemaVersion", "id", "name", "title", "description", "keepAwake", "route", "routing", "stopWhen", "nodes"]);
const nodeKeys = new Set(["id", "title", "after", "dependsOn", "agent", "role", "model", "effort", "variant", "executor", "skills", "constraints", "prompt", "input", "output", "when", "evidencePolicy", "timeout", "retry", "parallelSafe"]);
const stopKeys = new Set(["step", "jsonPath", "equals", "notEquals", "in", "notIn", "status", "next"]);
const whenKeys = new Set(["step", "jsonPath", "equals", "notEquals", "in", "notIn"]);
export const flowDocumentLimits = Object.freeze({ bytes: 256 * 1024, depth: 32, scalarLength: 64 * 1024, collectionLength: 2048, nodes: 256 });

function fail(message = "Flow document does not match the v2 flow contract.") {
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

function validStringList(value, { maxItems = 64, maxLength = 4096 } = {}) {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => safeText(item, maxLength) && item.length > 0);
}

function validValueList(value) {
  return Array.isArray(value) && value.length <= 64 && value.every((item) => ["string", "number", "boolean"].includes(typeof item));
}

function validCondition(condition, allowed) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition) || !exactKeys(condition, allowed)) return false;
  const comparators = ["equals", "notEquals", "in", "notIn"].filter((key) => Object.hasOwn(condition, key));
  return nodeIdentifier.test(condition.step) && safeText(condition.jsonPath, 256) && condition.jsonPath.length > 0 && comparators.length === 1
    && (!Object.hasOwn(condition, "equals") || ["string", "number", "boolean"].includes(typeof condition.equals))
    && (!Object.hasOwn(condition, "notEquals") || ["string", "number", "boolean"].includes(typeof condition.notEquals))
    && (!Object.hasOwn(condition, "in") || validValueList(condition.in))
    && (!Object.hasOwn(condition, "notIn") || validValueList(condition.notIn));
}

function normalizeLegacy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.id && value.name && value.id !== value.name) fail("Flow id and name must identify the same flow.");
  if (value.routing !== undefined && value.route !== undefined) fail("Use either route or routing, not both.");
  const normalized = { ...value };
  if (normalized.schemaVersion === undefined && normalized.name) normalized.schemaVersion = "v2";
  if (normalized.id === undefined && normalized.name) normalized.id = normalized.name;
  if (normalized.title === undefined && normalized.name) normalized.title = normalized.name;
  if (normalized.routing === undefined && normalized.route !== undefined) normalized.routing = normalized.route;
  if (normalized.stopWhen && !Array.isArray(normalized.stopWhen)) normalized.stopWhen = [normalized.stopWhen];
  delete normalized.route;
  return normalized;
}

export function validateFlowDocument(input) {
  const value = normalizeLegacy(input);
  const version = value?.schemaVersion;
  const validRoot = value && typeof value === "object" && !Array.isArray(value)
    && exactKeys(value, rootKeys) && ["v1", "v2"].includes(version)
    && identifier.test(value.id) && (value.name === undefined || (safeText(value.name, 160) && value.name.length > 0))
    && (value.title === undefined || (safeText(value.title, 160) && value.title.length > 0))
    && (value.description === undefined || safeText(value.description, 4000))
    && (value.keepAwake === undefined || safeText(value.keepAwake, 32))
    && (value.routing === undefined || (value.routing && typeof value.routing === "object" && !Array.isArray(value.routing)
      && exactKeys(value.routing, new Set(["when", "avoid", "priority"]))
      && (value.routing.when === undefined || validStringList(value.routing.when, { maxItems: 128, maxLength: 128 }))
      && (value.routing.avoid === undefined || validStringList(value.routing.avoid, { maxItems: 128, maxLength: 128 }))
      && (value.routing.priority === undefined || (Number.isInteger(value.routing.priority) && value.routing.priority >= 0 && value.routing.priority <= 1000))))
    && (value.stopWhen === undefined || (Array.isArray(value.stopWhen) && value.stopWhen.length <= 64
      && value.stopWhen.every((rule) => validCondition(rule, stopKeys)
        && safeText(rule.status, 128) && rule.status.length > 0 && safeText(rule.next, 1000) && rule.next.length > 0)))
    && Array.isArray(value.nodes) && value.nodes.length >= 1 && value.nodes.length <= flowDocumentLimits.nodes;
  if (!validRoot) fail();

  const nodeIds = new Set();
  for (const node of value.nodes) {
    const dependencies = node?.after ?? node?.dependsOn;
    const validNode = node && typeof node === "object" && !Array.isArray(node) && exactKeys(node, nodeKeys)
      && nodeIdentifier.test(node.id)
      && (node.title === undefined || (safeText(node.title, 160) && node.title.length > 0))
      && (node.after === undefined || Array.isArray(node.after))
      && (node.dependsOn === undefined || Array.isArray(node.dependsOn))
      && !(node.after !== undefined && node.dependsOn !== undefined)
      && (dependencies === undefined || (new Set(dependencies).size === dependencies.length && dependencies.every((id) => nodeIdentifier.test(id))))
      && ["agent", "role", "model", "effort", "variant", "executor", "prompt", "input", "output", "evidencePolicy"].every((key) => node[key] === undefined || safeText(node[key], key === "prompt" || key === "input" ? 64 * 1024 : 4096))
      && ["skills", "constraints"].every((key) => node[key] === undefined || validStringList(node[key], { maxItems: 128, maxLength: 4096 }))
      && (node.when === undefined || validCondition(node.when, whenKeys))
      && (node.timeout === undefined || (Number.isInteger(node.timeout) && node.timeout >= 1 && node.timeout <= 604800))
      && (node.retry === undefined || (Number.isInteger(node.retry) && node.retry >= 0 && node.retry <= 10))
      && (node.parallelSafe === undefined || typeof node.parallelSafe === "boolean");
    if (!validNode || nodeIds.has(node?.id)) fail("Flow nodes must have unique IDs and valid agent, model, prompt, skill, condition, and dependency fields.");
    nodeIds.add(node.id);
  }

  const nodesById = new Map(value.nodes.map((node) => [node.id, node]));
  for (const node of value.nodes) {
    const dependencies = node.after ?? node.dependsOn ?? [];
    if (dependencies.some((dependency) => !nodeIds.has(dependency) || dependency === node.id)) fail("Flow dependencies must reference another node in the same document.");
    if (node.when && !nodeIds.has(node.when.step)) fail("Flow conditions must reference a node in the same document.");
  }
  for (const rule of value.stopWhen ?? []) if (!nodeIds.has(rule.step)) fail("Flow stop rules must reference a node in the same document.");

  const ancestorsCache = new Map();
  const ancestorVisiting = new Set();
  function ancestors(id) {
    if (ancestorsCache.has(id)) return ancestorsCache.get(id);
    if (ancestorVisiting.has(id)) fail("Flow dependencies must not contain cycles.");
    ancestorVisiting.add(id);
    const result = new Set();
    for (const dependency of nodesById.get(id).after ?? nodesById.get(id).dependsOn ?? []) {
      result.add(dependency);
      for (const ancestor of ancestors(dependency)) result.add(ancestor);
    }
    ancestorVisiting.delete(id);
    ancestorsCache.set(id, result);
    return result;
  }
  for (const node of value.nodes) {
    if (node.when && !ancestors(node.id).has(node.when.step)) fail("Conditional nodes must depend on their condition source.");
  }

  const visiting = new Set();
  const visited = new Set();
  function visitNode(id) {
    if (visiting.has(id)) fail("Flow dependencies must not contain cycles.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of nodesById.get(id).after ?? nodesById.get(id).dependsOn ?? []) visitNode(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodeIds) visitNode(id);
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
