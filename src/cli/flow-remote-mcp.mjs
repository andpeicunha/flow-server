#!/usr/bin/env node
import { RemoteFlowCatalog } from "../remote/catalog.js";
import { loadRemoteReleases } from "../remote/release-file.js";
import { startRemoteStdioServer } from "../mcp/remote-server.js";

const bearerToken = process.env.FLOW_REMOTE_MCP_BEARER_TOKEN;
const catalogFile = process.env.FLOW_REMOTE_MCP_CATALOG_FILE;
if (!bearerToken || bearerToken.length < 16 || !catalogFile) {
  console.error("FLOW_REMOTE_MCP_BEARER_TOKEN and FLOW_REMOTE_MCP_CATALOG_FILE must be set.");
  process.exitCode = 1;
} else {
  try {
    startRemoteStdioServer(new RemoteFlowCatalog({ releases: await loadRemoteReleases(catalogFile) }), { bearerToken });
  } catch (error) {
    console.error(`flow-remote-mcp: ${error.code || "REMOTE_CATALOG_START_FAILED"}`);
    process.exitCode = 1;
  }
}
