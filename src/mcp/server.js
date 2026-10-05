import readline from "node:readline";
import { FlowError } from "../core/errors.js";

const identifier = { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" };
const runId = { type: "string", pattern: "^run_[a-z0-9-]{1,63}$" };

export const tools = Object.freeze([
  { name: "flow_list", description: "List flow metadata from the local loopback service.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "flow_inspect", description: "Inspect one redacted local run.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } },
  { name: "flow_start_guided", description: "Create a guided run. It never starts a host adapter.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId", "workspace", "runtime"], properties: { flowId: identifier, workspace: { type: "string", minLength: 1, maxLength: 4096 }, runtime: { enum: ["codex", "claude"] } } } },
  { name: "flow_next", description: "Reserved for a future local scheduler. This version fails closed.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } },
  { name: "flow_checkpoint", description: "Write one redacted receipt to an active local run.", inputSchema: { type: "object", additionalProperties: false, required: ["runId", "receipt"], properties: { runId, receipt: { type: "object" } } } },
  { name: "flow_audit", description: "Read the deterministic audit for one local run.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } },
  { name: "flow_open", description: "Reserved for an optional read-only viewer. This version fails closed.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } }
]);

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function failure(error) {
  const code = error instanceof FlowError ? error.code : "MCP_INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : "Unexpected MCP error.";
  return { content: [{ type: "text", text: `${code}: ${message}` }], isError: true };
}

export async function callTool(client, name, input = {}) {
  try {
    if (name === "flow_list") return result(await client.list());
    if (name === "flow_inspect") return result(await client.inspect(input.runId));
    if (name === "flow_start_guided") return result(await client.startGuided(input));
    if (name === "flow_checkpoint") return result(await client.checkpoint(input.runId, input.receipt));
    if (name === "flow_audit") return result(await client.audit(input.runId));
    if (name === "flow_next" || name === "flow_open") throw new FlowError("MCP_OPERATION_UNAVAILABLE", `${name} is not available until the local scheduler or viewer is installed.`);
    throw new FlowError("MCP_UNKNOWN_TOOL", `Unknown flow-mcp tool: ${name}`);
  } catch (error) {
    return failure(error);
  }
}

export async function handleRequest(client, request) {
  if (request.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "flow-mcp", version: "0.0.0-development" } };
  if (request.method === "tools/list") return { tools };
  if (request.method === "tools/call") return callTool(client, request.params?.name, request.params?.arguments);
  throw new FlowError("MCP_METHOD_NOT_FOUND", `Unsupported MCP method: ${request.method}`);
}

export function startStdioServer(client, { input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {}) {
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  reader.on("line", async (line) => {
    let request;
    try {
      request = JSON.parse(line);
      if (!request.id) {
        await handleRequest(client, request);
        return;
      }
      output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: await handleRequest(client, request) })}\n`);
    } catch (error) {
      if (request?.id) output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error.message || "Internal MCP error." } })}\n`);
      else errorOutput.write(`flow-mcp: ${error.message || "Invalid request."}\n`);
    }
  });
  return reader;
}
