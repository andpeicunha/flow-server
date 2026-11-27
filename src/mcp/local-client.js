import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FlowError } from "../core/errors.js";

function localEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") {
    throw new FlowError("MCP_NON_LOOPBACK_SERVICE", "flow-mcp only connects to a loopback flow-service.");
  }
  return endpoint.toString().replace(/\/$/, "");
}

export class LocalFlowClient {
  constructor({ stateDir, fs = { readFile }, fetchImpl = fetch, idempotencyKey = () => `mcp-${randomUUID()}` } = {}) {
    if (!stateDir) throw new TypeError("stateDir is required.");
    this.stateDir = stateDir;
    this.fs = fs;
    this.fetch = fetchImpl;
    this.idempotencyKey = idempotencyKey;
  }

  async connection() {
    let info;
    try {
      info = JSON.parse(await this.fs.readFile(`${this.stateDir}/service.json`, "utf8"));
    } catch {
      throw new FlowError("MCP_SERVICE_UNAVAILABLE", "flow-service is unavailable. Start it with: flow-server start");
    }
    return {
      endpoint: localEndpoint(info.endpoint),
      token: (await this.fs.readFile(`${this.stateDir}/service.token`, "utf8")).trim()
    };
  }

  async request(path, { method = "GET", body, mutate = false, privateRead = false } = {}) {
    const connection = await this.connection();
    const headers = body === undefined ? {} : { "content-type": "application/json" };
    if (mutate || privateRead) headers["x-flow-local-token"] = connection.token;
    if (mutate) {
      headers["idempotency-key"] = this.idempotencyKey();
    }
    let response;
    try {
      response = await this.fetch(`${connection.endpoint}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new FlowError("MCP_SERVICE_UNAVAILABLE", "flow-service is unavailable. Start it with: flow-server start");
    }
    const result = await response.json().catch(() => undefined);
    if (!response.ok) throw new FlowError(result?.error?.code || "MCP_SERVICE_ERROR", result?.error?.message || `flow-service returned ${response.status}.`);
    return result;
  }

  list(profileId) { return this.request(`/v1/flows${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`); }
  selectFlow(selection) { return this.request("/v1/flow-selection", { method: "POST", mutate: true, body: selection }); }
  inspect(runId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}`); }
  retryInspect(runId, nodeId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/retry?nodeId=${encodeURIComponent(nodeId)}`, { privateRead: true }); }
  retryNode(runId, review) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/retry`, { method: "POST", mutate: true, body: review }); }
  block(runId, details) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/block`, { method: "POST", mutate: true, body: details }); }
  continueRun(runId, resolution) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/continue`, { method: "POST", mutate: true, body: resolution }); }
  switchRuntime(runId, review) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/switch-runtime`, { method: "POST", mutate: true, body: review }); }
  audit(runId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/audit`); }
  review({ flowId, profileId, last = 20, since, contentHash, compareVersions = false }) {
    return this.request("/v1/reviews", { method: "POST", mutate: true, body: {
      flowId, ...(profileId ? { profileId } : {}), last,
      ...(since ? { since } : {}), ...(contentHash ? { contentHash } : {}), compareVersions
    } });
  }
  next(runId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/next`, { method: "POST", mutate: true, body: {} }); }
  writeReport(runId, nodeId, report) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/reports/${encodeURIComponent(nodeId)}`, { method: "POST", mutate: true, body: { report } }); }
  readReport(runId, nodeId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/reports/${encodeURIComponent(nodeId)}`, { privateRead: true }); }
  lifecycle(runId, action) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/lifecycle`, { method: "POST", mutate: true, body: { action } }); }
  startGuided({ flowId, profileId, workspace, runtime, executionProfileId, task, reuseFromRunId, reuseNodeIds }) {
    return this.request("/v1/runs", { method: "POST", mutate: true, body: { flowId, ...(profileId ? { profileId } : {}), workspace, ...(runtime ? { runtime } : {}), ...(executionProfileId ? { executionProfileId } : {}), executionMode: "guided", ...(task !== undefined ? { task } : {}), ...(reuseFromRunId ? { reuseFromRunId } : {}), ...(reuseNodeIds ? { reuseNodeIds } : {}) } });
  }
  checkpoint(runId, receipt) {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/checkpoint`, { method: "POST", mutate: true, body: { receipt } });
  }
}
