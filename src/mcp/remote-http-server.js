import { createServer } from "node:http";
import { FlowError } from "../core/errors.js";
import { handleRemoteRequest } from "./remote-server.js";

const maxBodyBytes = 64 * 1024;

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new FlowError("REMOTE_MCP_REQUEST_TOO_LARGE", "Request rejected.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FlowError("REMOTE_MCP_INVALID_JSON", "Request rejected.");
  }
}

export function createRemoteMcpHttpServer({ catalog, bearerToken }) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/mcp" || request.headers.origin) {
        return send(response, 404, { error: { code: "REMOTE_MCP_NOT_FOUND", message: "Request rejected." } });
      }
      const rpcRequest = await readJson(request);
      const result = await handleRemoteRequest(catalog, rpcRequest, { bearerToken, authorization: request.headers.authorization });
      return send(response, 200, { jsonrpc: "2.0", id: rpcRequest.id ?? null, result });
    } catch (error) {
      const code = error instanceof FlowError ? error.code : "REMOTE_MCP_INTERNAL_ERROR";
      return send(response, 400, { error: { code, message: "Request rejected." } });
    }
  });
}
