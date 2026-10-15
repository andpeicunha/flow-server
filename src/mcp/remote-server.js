import readline from "node:readline";
import { FlowError } from "../core/errors.js";

const flowId = { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" };
const version = { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$" };

export const remoteTools = Object.freeze([
  { name: "flow_recommend", description: "Recommend approved remote flow releases from a small task summary.", inputSchema: { type: "object", additionalProperties: false, required: ["taskSummary"], properties: { taskSummary: { type: "string", minLength: 1, maxLength: 500 }, tags: { type: "array", items: { type: "string" }, maxItems: 20 } } } },
  { name: "flow_get_definition", description: "Get one exact approved remote flow definition.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId", "version"], properties: { flowId, version } } },
  { name: "flow_record_run_evidence", description: "Record one bounded, redacted run evidence event.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId", "version", "eventId", "runId", "nodeId", "status", "durationMs"], properties: { flowId, version, eventId: { type: "string" }, runId: { type: "string" }, nodeId: { type: "string" }, status: { enum: ["completed", "failed", "blocked", "skipped"] }, durationMs: { type: "integer", minimum: 0 }, errorCode: { type: "string" }, counters: { type: "object" } } } },
  { name: "flow_list_runs", description: "List safe summaries of runs for one approved flow version.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId", "version"], properties: { flowId, version } } },
  { name: "flow_get_run_evidence", description: "Get redacted evidence for one approved flow run.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId", "version", "runId"], properties: { flowId, version, runId: { type: "string" } } } },
  { name: "flow_analyze_flow", description: "Analyze sufficient valid evidence for one approved flow version.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId", "version"], properties: { flowId, version } } },
  { name: "flow_record_improvement_proposal", description: "Create a pending-review improvement proposal from a stored analysis.", inputSchema: { type: "object", additionalProperties: false, required: ["analysisId", "kind"], properties: { analysisId: { type: "string" }, kind: { enum: ["flow-gap", "node-reliability", "validation-gap"] } } } }
]);

function response(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function failure(error) {
  const code = error instanceof FlowError ? error.code : "REMOTE_MCP_INTERNAL_ERROR";
  return { content: [{ type: "text", text: `${code}: Request rejected.` }], isError: true };
}

function requireBearer(expected, received) {
  if (typeof expected !== "string" || expected.length < 16 || received !== `Bearer ${expected}`) {
    throw new FlowError("REMOTE_MCP_UNAUTHORIZED", "Request rejected.");
  }
}

export async function callRemoteTool(catalog, name, input = {}, { bearerToken, authorization } = {}) {
  try {
    requireBearer(bearerToken, authorization);
    if (name === "flow_recommend") return response(catalog.recommend(input));
    if (name === "flow_get_definition") return response(catalog.getDefinition(input.flowId, input.version));
    if (name === "flow_record_run_evidence") return response(catalog.recordEvidence(input));
    if (name === "flow_list_runs") return response(catalog.listRuns(input.flowId, input.version));
    if (name === "flow_get_run_evidence") return response(catalog.getEvidence(input.flowId, input.version, input.runId));
    if (name === "flow_analyze_flow") return response(catalog.analyze(input.flowId, input.version));
    if (name === "flow_record_improvement_proposal") return response(catalog.recordProposal(input));
    throw new FlowError("REMOTE_MCP_UNKNOWN_TOOL", "Request rejected.");
  } catch (error) {
    return failure(error);
  }
}

export async function handleRemoteRequest(catalog, request, context = {}) {
  if (request.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "flow-remote-mcp", version: "0.0.0-development" } };
  if (request.method === "tools/list") return { tools: remoteTools };
  if (request.method === "tools/call") return callRemoteTool(catalog, request.params?.name, request.params?.arguments, { ...context, authorization: context.authorization || request.params?._meta?.authorization });
  throw new FlowError("REMOTE_MCP_METHOD_NOT_FOUND", "Request rejected.");
}

export function startRemoteStdioServer(catalog, { bearerToken, input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {}) {
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  reader.on("line", async (line) => {
    let request;
    try {
      request = JSON.parse(line);
      const result = await handleRemoteRequest(catalog, request, { bearerToken });
      if (request.id) output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    } catch (error) {
      if (request?.id) output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "Request rejected." } })}\n`);
      else errorOutput.write("flow-remote-mcp: request rejected.\n");
    }
  });
  return reader;
}
