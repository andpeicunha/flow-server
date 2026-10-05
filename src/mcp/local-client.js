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

  async request(path, { method = "GET", body, mutate = false } = {}) {
    const connection = await this.connection();
    const headers = body === undefined ? {} : { "content-type": "application/json" };
    if (mutate) {
      headers["x-flow-local-token"] = connection.token;
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

  list() { return this.request("/v1/flows"); }
  inspect(runId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}`); }
  audit(runId) { return this.request(`/v1/runs/${encodeURIComponent(runId)}/audit`); }
  startGuided({ flowId, workspace, runtime }) {
    return this.request("/v1/runs", { method: "POST", mutate: true, body: { flowId, workspace, runtime, executionMode: "guided" } });
  }
  checkpoint(runId, receipt) {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/checkpoint`, { method: "POST", mutate: true, body: { receipt } });
  }
}
