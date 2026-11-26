import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import { FlowError } from "./errors.js";

export const skillNamePattern = /^[a-z][a-z0-9-]{0,127}$/;

/** Roots searched when a source does not configure `skills.roots` (compatibility). */
export function defaultSkillRoots(home = homedir()) {
  return [join(home, ".agents", "skills"), join(home, ".claude", "skills")];
}

/** Expands `~`, then requires an absolute path without `..` segments. Returns undefined when invalid. */
export function expandSkillRoot(root, home = homedir()) {
  if (typeof root !== "string" || root.length === 0 || root.length > 4096 || root.includes("\0")) return undefined;
  const expanded = root === "~" ? home : root.startsWith("~/") ? join(home, root.slice(2)) : root;
  if (!isAbsolute(expanded) || root.split(/[\\/]/).includes("..")) return undefined;
  return normalize(expanded).replace(new RegExp(`${sep === "\\" ? "\\\\" : sep}+$`), "") || sep;
}

/** Validates `skills: { roots: [...] }` and returns the expanded form, or undefined when invalid. */
export function validateSkillsConfig(skills, home = homedir()) {
  if (skills === undefined) return { valid: true, value: undefined };
  if (!skills || typeof skills !== "object" || Array.isArray(skills) || !Object.keys(skills).every((key) => key === "roots")) return { valid: false };
  if (!Array.isArray(skills.roots) || skills.roots.length < 1 || skills.roots.length > 16) return { valid: false };
  const roots = skills.roots.map((root) => expandSkillRoot(root, home));
  if (roots.some((root) => root === undefined) || new Set(roots).size !== roots.length) return { valid: false };
  return { valid: true, value: { roots } };
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); } // stat follows symlinks, so a symlinked skill directory resolves.
  catch { return false; }
}

/** Returns the first `<root>/<name>/SKILL.md` that exists, or undefined. `exists` is injectable. */
export async function locateSkill(name, roots, { exists = isFile } = {}) {
  if (typeof name !== "string" || !skillNamePattern.test(name)) return undefined;
  for (const root of roots) {
    const path = join(root, name, "SKILL.md");
    if (await exists(path)) return { name, root, path };
  }
  return undefined;
}

export function skillsDeclaredBy(flow) {
  const declared = new Map();
  for (const node of flow?.nodes ?? []) for (const skill of node.skills ?? []) {
    if (!declared.has(skill)) declared.set(skill, []);
    if (!declared.get(skill).includes(node.id)) declared.get(skill).push(node.id);
  }
  return declared;
}

export async function hashSkillFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/**
 * Resolves every Skill declared by every node (skipped-by-condition nodes included).
 * Returns { skills: {name: {path, root, sha256, nodes}}, missing: [{skill, nodes, reason}] }.
 */
export async function resolveFlowSkills(flow, roots, { exists } = {}) {
  const skills = {};
  const missing = [];
  for (const [name, nodes] of skillsDeclaredBy(flow)) {
    const found = await locateSkill(name, roots, { exists });
    if (!found) { missing.push({ skill: name, nodes, reason: skillNamePattern.test(name) ? "not found" : "invalid name" }); continue; }
    skills[name] = { path: found.path, root: found.root, sha256: await hashSkillFile(found.path), nodes };
  }
  return { skills, missing };
}

// The HTTP error envelope caps messages at 500 chars, so the searched roots come first and the skill list is truncated.
export function skillMissingError(missing, roots) {
  const head = `Declared Skills could not be resolved; no run was created. Searched roots, in order: ${roots.join(", ")}. Missing: `;
  const list = missing.map(({ skill, nodes, reason }) => `${skill} [${reason}; nodes: ${nodes.join(", ")}]`).join("; ");
  const room = Math.max(0, 500 - head.length);
  const message = head + (list.length > room ? `${list.slice(0, Math.max(0, room - 1))}…` : list);
  const error = new FlowError("SKILL_MISSING", message);
  error.details = { missing, roots };
  return error;
}
