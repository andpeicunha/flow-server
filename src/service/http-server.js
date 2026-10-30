import { createServer } from "node:http";
import { FlowError } from "../core/errors.js";

const mutableMethods = new Set(["POST"]);
const maxBodyBytes = 64 * 1024;

function error(status, code, message) {
  return { status, body: { error: { code, message } } };
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(body === undefined ? undefined : `${JSON.stringify(body)}\n`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new FlowError("REQUEST_TOO_LARGE", "Request body exceeds 64 KiB.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FlowError("INVALID_JSON", "Request body must be valid JSON.");
  }
}

function validateCreate(body) {
  const valid = body && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).every((key) => ["flowId", "profileId", "workspace", "runtime", "executionMode", "task"].includes(key))
    && typeof body.flowId === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(body.flowId)
    && (body.profileId === undefined || (typeof body.profileId === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(body.profileId)))
    && typeof body.workspace === "string" && body.workspace.length > 0 && body.workspace.length <= 4096
    && ["codex", "claude"].includes(body.runtime) && ["guided", "direct"].includes(body.executionMode)
    && (body.task === undefined || (typeof body.task === "string" && body.task.length <= 64 * 1024));
  if (!valid) throw new FlowError("INVALID_RUN_REQUEST", "flowId, workspace, runtime, and executionMode are required.");
}

function validateFlowSelection(body) {
  const valid = body && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).every((key) => ["profileId", "flowId", "workspace", "task"].includes(key))
    && typeof body.workspace === "string" && body.workspace.length > 0 && body.workspace.length <= 4096
    && (body.profileId === undefined || (typeof body.profileId === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(body.profileId)))
    && (body.flowId === undefined || (typeof body.flowId === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(body.flowId)))
    && (body.task === undefined || (typeof body.task === "string" && body.task.length <= 64 * 1024));
  if (!valid) throw new FlowError("INVALID_FLOW_SELECTION", "workspace and optional profileId, flowId, or task must be valid.");
}

function page(items, url) {
  const limit = Number(url.searchParams.get("limit") || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new FlowError("INVALID_PAGE", "limit must be an integer from 1 to 100.");
  const cursor = url.searchParams.get("cursor");
  let offset = 0;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Number.isInteger(decoded.offset) || decoded.offset < 0) throw new Error("invalid offset");
      offset = decoded.offset;
    } catch {
      throw new FlowError("INVALID_CURSOR", "cursor is invalid.");
    }
  }
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return { items: slice, nextCursor: nextOffset < items.length ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString("base64url") : null };
}

export function createHttpServer({ runService, runReviewService, flowSourceService, token, serviceInfo, onShutdown = async () => {}, idempotencyStore = runService.stateStore }) {
  const idempotency = new Map();
  const inFlightIdempotency = new Map();

  async function mutation(request, body, handler) {
    if (!(await token.matches(request.headers["x-flow-local-token"]))) throw new FlowError("UNAUTHORIZED", "A valid local service token is required.");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 16 || key.length > 128) throw new FlowError("INVALID_IDEMPOTENCY_KEY", "A 16-128 character Idempotency-Key is required.");
    const fingerprint = `${request.method}:${request.url}:${JSON.stringify(body)}`;
    let existing = idempotency.get(key);
    if (!existing) {
      const persisted = await idempotencyStore.readIdempotency(key);
      existing = idempotency.get(key) ?? persisted;
    }
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new FlowError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used for another request.");
      return { status: 200, body: existing.body };
    }
    const inFlight = inFlightIdempotency.get(key);
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) throw new FlowError("IDEMPOTENCY_CONFLICT", "Idempotency-Key is already in use for another request.");
      return inFlight.promise;
    }
    const promise = (async () => {
      const result = await handler();
      const entry = { fingerprint, body: result.body };
      await idempotencyStore.writeIdempotency(key, entry);
      idempotency.set(key, entry);
      return result;
    })();
    inFlightIdempotency.set(key, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      if (inFlightIdempotency.get(key)?.promise === promise) inFlightIdempotency.delete(key);
    }
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (mutableMethods.has(request.method) && request.headers.origin) throw new FlowError("ORIGIN_NOT_ALLOWED", "Browser-originated mutations are not allowed.");
      if (request.method === "GET" && url.pathname === "/v1/health") return send(response, 200, serviceInfo());
      if (request.method === "GET" && url.pathname === "/v1/flows") return send(response, 200, page(flowSourceService ? await flowSourceService.list({ profileId: url.searchParams.get("profileId") || undefined }) : [], url));
      if (request.method === "GET" && url.pathname === "/v1/sources") return send(response, 200, { items: flowSourceService ? await flowSourceService.status() : [] });
      if (request.method === "GET" && url.pathname === "/v1/runs") return send(response, 200, page(await runService.list({ flowId: url.searchParams.get("flowId") || undefined, profileId: url.searchParams.get("profileId") || undefined, runId: url.searchParams.get("runId") || undefined }), url));

      const runMatch = url.pathname.match(/^\/v1\/runs\/(run_[a-z0-9-]{1,63})(?:\/(checkpoint|lifecycle|audit|next))?$/);
      if (request.method === "GET" && runMatch?.[2] === undefined) return send(response, 200, await runService.get(runMatch[1]));
      if (request.method === "GET" && runMatch?.[2] === "audit") return send(response, 200, await runService.audit(runMatch[1]));

      const body = request.method === "POST" ? await readJson(request) : undefined;
      if (request.method === "POST" && url.pathname === "/v1/runs") {
        const result = await mutation(request, body, async () => {
          validateCreate(body);
          return { status: 201, body: await runService.create(body) };
        });
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && url.pathname === "/v1/flow-selection") {
        const result = await mutation(request, body, async () => {
          validateFlowSelection(body);
          if (!flowSourceService) throw new FlowError("FLOW_SOURCE_UNAVAILABLE", "No local flow source is configured.");
          return { status: 200, body: await flowSourceService.selectFlow(body) };
        });
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && url.pathname === "/v1/reviews") {
        const result = await mutation(request, body, async () => {
          if (!runReviewService) throw new FlowError("FLOW_REVIEW_UNAVAILABLE", "Flow review is unavailable.");
          return { status: 201, body: await runReviewService.review(body) };
        });
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && runMatch?.[2] === "checkpoint") {
        const result = await mutation(request, body, async () => ({ status: 200, body: await runService.checkpoint(runMatch[1], body.receipt ?? {}) }));
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && runMatch?.[2] === "next") {
        const result = await mutation(request, body, async () => ({ status: 200, body: await runService.next(runMatch[1]) }));
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && runMatch?.[2] === "lifecycle") {
        const result = await mutation(request, body, async () => ({ status: 200, body: await runService.transition(runMatch[1], body.action) }));
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && runMatch?.[2] === "audit") {
        const result = await mutation(request, body, async () => ({ status: 200, body: await runService.audit(runMatch[1]) }));
        return send(response, result.status, result.body);
      }
      if (request.method === "POST" && url.pathname === "/v1/service/shutdown") {
        const result = await mutation(request, body, async () => {
          await onShutdown();
          return { status: 202, body: { status: "stopping" } };
        });
        return send(response, result.status, result.body);
      }
      return send(response, 404, error(404, "NOT_FOUND", "Route not found.").body);
    } catch (caught) {
      const known = caught instanceof FlowError;
      const status = caught.code === "UNAUTHORIZED" ? 401 : ["RUN_NOT_FOUND", "FLOW_NOT_FOUND"].includes(caught.code) ? 404 : caught.code === "IDEMPOTENCY_CONFLICT" ? 409 : known ? 400 : 500;
      return send(response, status, { error: { code: known ? caught.code : "INTERNAL_ERROR", message: known ? caught.message : "Internal service error." } });
    }
  });
}
