import { FlowError } from "./errors.js";

const pushPolicies = new Set(["manual", "confirm", "after-validation"]);

export function planFlowSync({ direction, pushPolicy = "manual", validationPassed = false, intendedFiles = [], changedFiles = [], conflicts = false, detachedHead = false, branchMatches = true, remoteMatches = true } = {}) {
  if (!["pull", "push"].includes(direction) || !pushPolicies.has(pushPolicy)) throw new FlowError("INVALID_FLOW_SYNC_REQUEST", "Sync direction or push policy is invalid.");
  const blockers = [];
  if (conflicts) blockers.push("conflicts");
  if (detachedHead) blockers.push("detached-head");
  if (!branchMatches) blockers.push("branch-mismatch");
  if (!remoteMatches) blockers.push("remote-mismatch");
  if (direction === "push" && !validationPassed) blockers.push("validation-required");
  const intended = new Set(intendedFiles);
  const unrelated = changedFiles.filter((file) => !intended.has(file));
  if (direction === "push" && unrelated.length) blockers.push("unrelated-changes");
  if (blockers.length) return { decision: "blocked", blockers, unrelatedFiles: unrelated };
  if (direction === "pull") return { decision: "confirm", reason: "remote-flow-instructions-require-confirmation" };
  if (pushPolicy === "manual") return { decision: "manual", reason: "manual-policy" };
  if (pushPolicy === "confirm") return { decision: "confirm", reason: "push-confirmation-required" };
  return { decision: "allow", reason: "validated-flow-only-change" };
}
