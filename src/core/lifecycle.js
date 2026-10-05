import { FlowError } from "./errors.js";

export const terminalStates = new Set(["stopped", "completed", "failed"]);

const transitions = new Map([
  ["created:start", "running"],
  ["created:stop", "stopped"],
  ["running:pause", "paused"],
  ["running:stop", "stopped"],
  ["running:complete", "completed"],
  ["running:fail", "failed"],
  ["paused:resume", "running"],
  ["paused:stop", "stopped"]
]);

export function transitionRun(status, action) {
  const next = transitions.get(`${status}:${action}`);
  if (!next) {
    throw new FlowError("INVALID_LIFECYCLE_TRANSITION", `Cannot ${action} a run in ${status} state.`);
  }
  return next;
}
