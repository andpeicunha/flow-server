#!/usr/bin/env node
import { homedir } from "node:os";
import { resolveStateDir } from "../core/state-dir.js";
import { LocalFlowClient } from "../mcp/local-client.js";
import { startStdioServer } from "../mcp/server.js";

const argumentsList = process.argv.slice(2);
if (argumentsList.length > 2 || (argumentsList.length && (argumentsList[0] !== "--state-dir" || !argumentsList[1]))) {
  console.error("Usage: flow-mcp [--state-dir DIR]");
  process.exitCode = 1;
} else {
  const stateDir = argumentsList[1] || resolveStateDir({ homeDir: homedir() });
  startStdioServer(new LocalFlowClient({ stateDir }));
}
