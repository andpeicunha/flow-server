import { join } from "node:path";

export function resolveStateDir({ env = process.env, platform = process.platform, homeDir } = {}) {
  if (env.FLOW_STATE_DIR) return env.FLOW_STATE_DIR;
  if (!homeDir) throw new Error("homeDir is required when FLOW_STATE_DIR is not set.");

  if (platform === "darwin") return join(homeDir, "Library", "Application Support", "flow-server");
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homeDir, "AppData", "Local"), "flow-server");
  return join(env.XDG_STATE_HOME || join(homeDir, ".local", "state"), "flow-server");
}
