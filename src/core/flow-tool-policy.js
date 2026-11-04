import { FlowError } from "./errors.js";

const namePattern = /^[A-Za-z0-9._:/-]{1,128}$/;
const rulePattern = /^!?[A-Za-z0-9._:/*-]{1,128}$/;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
export const validToolName = (name) => typeof name === "string" && namePattern.test(name);

export function validToolPolicy(policy) {
  if (policy === undefined) return true;
  if (!object(policy) || Object.keys(policy).some((key) => !["skills", "mcps", "mcpRegistrations"].includes(key))) return false;
  for (const type of ["skills", "mcps"]) {
    const rules = policy[type];
    if (rules === undefined) continue;
    if (!Array.isArray(rules) || rules.length > 64 || rules.some((rule) => typeof rule !== "string" || rule.length > 128 || !rulePattern.test(rule)) ||
      new Set(rules).size !== rules.length || (rules.length && !rules.some((rule) => !rule.startsWith("!")))) return false;
  }
  const mappings = policy.mcpRegistrations;
  return mappings === undefined || (object(mappings) && Object.keys(mappings).length <= 64 && Object.entries(mappings).every(([name, runtimes]) =>
    validToolName(name) && object(runtimes) && Object.keys(runtimes).every((runtime) => ["codex", "claude"].includes(runtime) && validToolName(runtimes[runtime]))));
}

export function registrationFor(policy, name, runtime) {
  return policy?.mcpRegistrations?.[name]?.[runtime] ?? name;
}

function allowed(rules, name) {
  if (rules === undefined) return true;
  const matches = (rule) => new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(name);
  return rules.some((rule) => !rule.startsWith("!") && matches(rule)) && !rules.some((rule) => rule.startsWith("!") && matches(rule.slice(1)));
}

export function validateFlowToolPolicy(source, flow, runtime) {
  const policy = source.policy;
  const runtimes = [...new Set([source.execution?.runtime ?? runtime ?? "codex", source.execution?.fallback?.runtime].filter(Boolean))];
  for (const node of flow.nodes) {
    const check = (type, name, runtimeName) => {
      if (!allowed(policy?.[type], name)) throw new FlowError("FLOW_TOOL_POLICY_DENIED", `Profile ${source.id}, flow ${flow.id}, node ${node.id}: ${type} tool ${name} denied${runtimeName ? ` for runtime ${runtimeName}` : ""}.`);
    };
    for (const skill of node.skills ?? []) check("skills", skill);
    for (const mcp of node.mcps ?? []) {
      check("mcps", mcp);
      for (const runtimeName of runtimes) check("mcps", registrationFor(policy, mcp, runtimeName), runtimeName);
    }
  }
}
