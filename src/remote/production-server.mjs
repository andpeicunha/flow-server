import { createHash } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { RemoteFlowCatalog } from "./catalog.js";
import { loadRemoteReleases } from "./release-file.js";
import { authenticateBearer, challenge, metadataUrl, oauthConfig, protectedResourceMetadata } from "./auth.js";

const config = requiredConfig();
const oauth = oauthConfig(process.env);
const catalog = new RemoteFlowCatalog({ releases: await loadRemoteReleases(config.catalogFile) });
const requests = new Map();

function requiredConfig() {
  const accessToken = process.env.MCP_ACCESS_TOKEN;
  const catalogFile = process.env.MCP_CATALOG_FILE;
  if (!accessToken || accessToken.length < 16 || !catalogFile) throw new Error("MCP_ACCESS_TOKEN and MCP_CATALOG_FILE are required.");
  return { accessToken, catalogFile };
}

function audit(actor, action, status) {
  const safeActor = createHash("sha256").update(actor).digest("hex").slice(0, 16);
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), actor: safeActor, action, status }));
}

function rateLimit(actor) {
  const key = createHash("sha256").update(actor).digest("hex").slice(0, 16);
  const now = Date.now();
  const recent = (requests.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 60) throw new Error("Rate limit exceeded.");
  recent.push(now);
  requests.set(key, recent);
}

function buildServer(auth) {
  const server = new McpServer({ name: "flow-remote-mcp", version: "0.0.0-development" });
  const tool = (name, description, inputSchema, callback) => server.registerTool(name, { description, inputSchema }, async (input) => {
    const result = await callback(input);
    audit(auth.subject, name, "ok");
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  tool("flow_recommend", "Recommend approved flow releases from a small task summary.", { taskSummary: z.string().min(1).max(500), tags: z.array(z.string()).max(20).optional() }, (input) => catalog.recommend(input));
  tool("flow_get_definition", "Get one exact approved flow definition.", { flowId: z.string(), version: z.string() }, (input) => catalog.getDefinition(input.flowId, input.version));
  tool("flow_record_run_evidence", "Record one bounded, redacted run evidence event.", { flowId: z.string(), version: z.string(), eventId: z.string(), runId: z.string(), nodeId: z.string(), status: z.enum(["completed", "failed", "blocked", "skipped"]), durationMs: z.number().int().nonnegative(), errorCode: z.string().optional(), counters: z.record(z.string(), z.number().int().nonnegative()).optional() }, (input) => catalog.recordEvidence(input));
  tool("flow_list_runs", "List safe summaries for one approved flow version.", { flowId: z.string(), version: z.string() }, (input) => catalog.listRuns(input.flowId, input.version));
  tool("flow_get_run_evidence", "Get redacted evidence for one approved flow run.", { flowId: z.string(), version: z.string(), runId: z.string() }, (input) => catalog.getEvidence(input.flowId, input.version, input.runId));
  tool("flow_analyze_flow", "Analyze sufficient valid evidence for one approved flow version.", { flowId: z.string(), version: z.string() }, (input) => catalog.analyze(input.flowId, input.version));
  tool("flow_record_improvement_proposal", "Create a pending-review proposal from a stored analysis.", { analysisId: z.string(), kind: z.enum(["flow-gap", "node-reliability", "validation-gap"]) }, (input) => catalog.recordProposal(input));
  return server;
}

async function authenticate(request, response, next) {
  try {
    const authorization = request.headers.authorization;
    const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    request.auth = await authenticateBearer(presented, { accessToken: config.accessToken, oauth });
    rateLimit(request.auth.subject);
    next();
  } catch {
    response.setHeader("WWW-Authenticate", challenge(oauth));
    response.status(401).json({ error: "Authentication is required." });
  }
}

const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: ["localhost", "127.0.0.1", ...(process.env.MCP_ALLOWED_HOST ? [process.env.MCP_ALLOWED_HOST] : [])] });
app.use(express.json({ limit: "64kb" }));
app.disable("x-powered-by");
app.get("/healthz", (_request, response) => response.status(200).json({ status: "ok" }));
if (oauth) {
  const metadata = protectedResourceMetadata(oauth);
  app.get(["/.well-known/oauth-protected-resource", new URL(metadataUrl(oauth.resource)).pathname], (_request, response) => response.status(200).json(metadata));
}
app.post("/mcp", authenticate, async (request, response) => {
  const server = buildServer(request.auth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), event: "mcp_error", message: error instanceof Error ? error.message : "unknown" }));
    if (!response.headersSent) response.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  } finally {
    response.on("close", () => Promise.allSettled([transport.close(), server.close()]));
  }
});

app.listen(process.env.PORT ?? 3422, "0.0.0.0", () => console.log("flow remote MCP started"));
