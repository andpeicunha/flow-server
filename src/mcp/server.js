import readline from "node:readline";
import receiptContract from "../../contracts/v1/receipt.schema.json" with { type: "json" };
import { FlowError } from "../core/errors.js";

const identifier = { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" };
const runId = { type: "string", pattern: "^run_[a-z0-9-]{1,63}$" };
const checkpointReceipt = {
  type: "object",
  additionalProperties: false,
  required: receiptContract.required,
  properties: { ...receiptContract.properties, status: { enum: ["completed", "failed"] } }
};

export const tools = Object.freeze([
  { name: "flow_list", description: "List local flow metadata, optionally scoped to one private profile.", inputSchema: { type: "object", additionalProperties: false, properties: { profileId: identifier } } },
  { name: "flow_select", description: "Resolve the workspace profile and flow. If decision is needs_confirmation, ask the developer before starting a run.", inputSchema: { type: "object", additionalProperties: false, required: ["workspace"], properties: { profileId: identifier, flowId: identifier, workspace: { type: "string", minLength: 1, maxLength: 4096 }, task: { type: "string", maxLength: 65536 } } } },
  { name: "flow_inspect", description: "Inspect one redacted local run.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } },
  { name: "flow_retry_inspect", description: "Read a blocked node's receipt, predecessor receipts, worktree path, and archived attempts before deciding whether a retry is safe. This does not change the run.", inputSchema: { type: "object", additionalProperties: false, required: ["runId", "nodeId"], properties: { runId, nodeId: identifier } } },
  { name: "flow_retry_node", description: "Advanced retry operation kept for existing clients. For a blocked guided run, use flow_continue. This operation needs a prior flow_retry_inspect and the full failed receipt and predecessor review.", inputSchema: { type: "object", additionalProperties: false, required: ["runId", "nodeId", "failedRecordedAt", "workspace", "reviewedNodeIds", "worktreeReview", "reason"], properties: { runId, nodeId: identifier, failedRecordedAt: { type: "string", format: "date-time" }, workspace: { type: "string", minLength: 1, maxLength: 4096 }, reviewedNodeIds: { type: "array", maxItems: 128, items: identifier }, worktreeReview: { type: "string", minLength: 1, maxLength: 2000 }, reason: { type: "string", minLength: 1, maxLength: 2000 } } } },
  { name: "flow_block", description: "Record a resolvable problem before the pending node has a receipt. Give the pending node and the reason. The run waits for an explicit resolution.", inputSchema: { type: "object", additionalProperties: false, required: ["runId", "nodeId", "reason"], properties: { runId, nodeId: identifier, reason: { type: "string", minLength: 1, maxLength: 2000 } } } },
  { name: "flow_continue", description: "Main path after the developer fixes a block. Keep the same run and prior checkpoints. Supply a short resolution reason. If the pending node has a failed receipt or a completed receipt that triggered stopWhen mode block, first inspect its pinned workspace and completed predecessors with flow_retry_inspect. Then also supply that workspace, a factual worktreeReview, and reviewedPredecessors true only after checking every predecessor. The service checks receipt status and workspace, archives the old attempt, and returns the retry node and attempt. The next node stays locked until a fresh checkpoint satisfies the rule. Do not continue if an external review still rejects the action.", inputSchema: { type: "object", additionalProperties: false, required: ["runId", "reason"], properties: { runId, reason: { type: "string", minLength: 1, maxLength: 2000 }, workspace: { type: "string", minLength: 1, maxLength: 4096 }, worktreeReview: { type: "string", minLength: 1, maxLength: 2000 }, reviewedPredecessors: { const: true } } } },
  {
    name: "flow_start_guided",
    description: "Create a guided run for an explicitly selected or uniquely workspace-mapped flow. Call flow_select first when profile or flow is uncertain. Runtime defaults to the selected machine profile when configured. It never starts a host adapter.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["flowId", "workspace"],
      properties: { flowId: identifier, profileId: identifier, workspace: { type: "string", minLength: 1, maxLength: 4096 }, runtime: { enum: ["codex", "claude"] }, task: { type: "string", maxLength: 65536 } }
    }
  },
  { name: "flow_next", description: "Return the ready nodes from the pinned flow definition, honoring dependencies, conditions, and stop rules. Run the node using its configured agent, model, effort, executor, Skills, constraints, and prompt.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } },
  { name: "flow_lifecycle", description: "Pause, resume, stop, or fail a local guided run. Completion is set automatically when all required nodes finish.", inputSchema: { type: "object", additionalProperties: false, required: ["runId", "action"], properties: { runId, action: { enum: ["pause", "resume", "stop", "fail"] } } } },
  {
    name: "flow_checkpoint",
    description: "Record the real result of one ready node. The outer runId and receipt.runId must match. Receipt requires schemaVersion 'v1', nodeId, status 'completed' or 'failed', and an RFC 3339 recordedAt timestamp. Put node answers such as decision, reason, next, and evidence inside receipt.output, not beside it. For a completed node with a configured model, record the actual matching model and effort. On retry, include the attempt number returned by flow_continue or flow_next. Do not invent evidence or token counts. Skips belong to flow_next. Example receipt: {schemaVersion:'v1',runId:'run_example',nodeId:'gate0_check',status:'completed',recordedAt:'2026-01-01T00:00:00Z',model:'provider/model',effort:'low',output:{decision:'continue'}}.",
    inputSchema: { type: "object", additionalProperties: false, required: ["runId", "receipt"], properties: { runId, receipt: checkpointReceipt } }
  },
  { name: "flow_audit", description: "Read the deterministic audit for one local run.", inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId } } },
  { name: "flow_review", description: "On explicit maintainer request, review completed local runs for one flow. Returns an advisory evidence report for an independent agent using the flow-performance-review Skill. Never call from an active flow node.", inputSchema: { type: "object", additionalProperties: false, required: ["flowId"], properties: { flowId: identifier, profileId: identifier, last: { type: "integer", minimum: 1, maximum: 100 }, since: { type: "string" }, contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" }, compareVersions: { type: "boolean" } } } },
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
    if (name === "flow_list") return result(await client.list(input.profileId));
    if (name === "flow_select") return result(await client.selectFlow(input));
    if (name === "flow_inspect") return result(await client.inspect(input.runId));
    if (name === "flow_retry_inspect") return result(await client.retryInspect(input.runId, input.nodeId));
    if (name === "flow_retry_node") return result(await client.retryNode(input.runId, { nodeId: input.nodeId, failedRecordedAt: input.failedRecordedAt, workspace: input.workspace, reviewedNodeIds: input.reviewedNodeIds, worktreeReview: input.worktreeReview, reason: input.reason }));
    if (name === "flow_block") return result(await client.block(input.runId, { nodeId: input.nodeId, reason: input.reason }));
    if (name === "flow_continue") return result(await client.continueRun(input.runId, { reason: input.reason, workspace: input.workspace, worktreeReview: input.worktreeReview, reviewedPredecessors: input.reviewedPredecessors }));
    if (name === "flow_start_guided") return result(await client.startGuided(input));
    if (name === "flow_checkpoint") return result(await client.checkpoint(input.runId, input.receipt));
    if (name === "flow_audit") return result(await client.audit(input.runId));
    if (name === "flow_review") return result(await client.review(input));
    if (name === "flow_next") return result(await client.next(input.runId));
    if (name === "flow_lifecycle") return result(await client.lifecycle(input.runId, input.action));
    if (name === "flow_open") throw new FlowError("MCP_OPERATION_UNAVAILABLE", `${name} is not available until the viewer is installed.`);
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
      if (request.id === undefined) {
        await handleRequest(client, request);
        return;
      }
      output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: await handleRequest(client, request) })}\n`);
    } catch (error) {
      if (request?.id !== undefined) output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error.message || "Internal MCP error." } })}\n`);
      else errorOutput.write(`flow-mcp: ${error.message || "Invalid request."}\n`);
    }
  });
  return reader;
}
