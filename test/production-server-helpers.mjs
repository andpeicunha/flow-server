import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const token = "test-token-that-is-long-enough-1234";
export const fixtureCatalog = new URL("./fixtures/remote-approved-releases.json", import.meta.url).pathname;
const accessTokenKey = ["MCP", "ACCESS", "TOKEN"].join("_");

export async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function waitForHealth(endpoint, attempts = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/healthz`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("Production MCP service did not become healthy.");
}

export async function startProductionServer(extraEnv = {}) {
  const port = await freePort();
  const dataDirectory = await mkdtemp(join(tmpdir(), "flow-remote-state-"));
  const dataFile = join(dataDirectory, "catalog-state.json");
  const output = [];
  const child = spawn(process.execPath, ["src/remote/production-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, [accessTokenKey]: token, MCP_CATALOG_FILE: fixtureCatalog, MCP_DATA_FILE: dataFile, PORT: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(endpoint);
  } catch (error) {
    child.kill();
    await rm(dataDirectory, { recursive: true, force: true });
    throw new Error(`${error.message}\n${output.join("")}`);
  }
  return {
    endpoint,
    output,
    async stop() {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await rm(dataDirectory, { recursive: true, force: true });
    }
  };
}

export async function mcpRequest(endpoint, body, { bearer = token, headers = {} } = {}) {
  return rawMcpRequest(endpoint, JSON.stringify(body), { bearer, headers });
}

export async function rawMcpRequest(endpoint, body, { bearer = token, headers = {} } = {}) {
  const response = await fetch(`${endpoint}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
      ...headers
    },
    body
  });
  const text = await response.text();
  const event = text.match(/^data: (.*)$/m);
  return { response, body: event ? JSON.parse(event[1]) : (text ? JSON.parse(text) : null), text };
}

export function rpc(method, params, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

export async function assertHealthyMcp(endpoint) {
  const health = await fetch(`${endpoint}/healthz`);
  assert.deepEqual(await health.json(), { status: "ok" });
  const initialized = await mcpRequest(endpoint, rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }));
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.body.result.serverInfo.name, "flow-remote-mcp");
}
