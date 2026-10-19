#!/usr/bin/env node
import { FileCatalogStateStore, RemoteFlowCatalog } from "../remote/catalog.js";
import { loadRemoteReleases } from "../remote/release-file.js";
import { startRemoteStdioServer } from "../mcp/remote-server.js";

const bearerToken = process.env.FLOW_REMOTE_MCP_BEARER_TOKEN;
const catalogFile = process.env.FLOW_REMOTE_MCP_CATALOG_FILE;
const dataFile = process.env.FLOW_REMOTE_MCP_DATA_FILE;
if (!bearerToken || bearerToken.length < 16 || !catalogFile || !dataFile) {
  console.error("FLOW_REMOTE_MCP_BEARER_TOKEN, FLOW_REMOTE_MCP_CATALOG_FILE, and FLOW_REMOTE_MCP_DATA_FILE must be set.");
  process.exitCode = 1;
} else {
  try {
    startRemoteStdioServer(new RemoteFlowCatalog({ releases: await loadRemoteReleases(catalogFile), stateStore: new FileCatalogStateStore({ filePath: dataFile }) }), { bearerToken });
  } catch (error) {
    console.error(`flow-remote-mcp: ${error.code || "REMOTE_CATALOG_START_FAILED"}`);
    process.exitCode = 1;
  }
}
