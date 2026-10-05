import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { LocalToken } from "../src/core/local-token.js";
import { FileStateStore } from "../src/core/state-store.js";
import { createHttpServer } from "../src/service/http-server.js";
import { RunService } from "../src/service/run-service.js";
import { ServiceHost } from "../src/service/service-host.js";

const execFile = promisify(execFileCallback);
const cli = new URL("../src/cli/flow-server.mjs", import.meta.url).pathname;
const flowCli = new URL("../src/cli/flow.mjs", import.meta.url).pathname;

async function waitForHealth(base) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(200) });
      if (response.ok) return;
    } catch { /* Process is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Service did not become healthy.");
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flow-service-test-"));
  const token = new LocalToken(directory, { createToken: () => "x".repeat(32) });
  const server = createHttpServer({
    token,
    runService: new RunService({ stateStore: new FileStateStore(directory), createId: () => "run_test", now: () => "2026-01-01T00:00:00.000Z" }),
    serviceInfo: () => ({ version: "test", pid: 1, bind: "127.0.0.1", status: "ready" })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { directory, token: await token.loadOrCreate(), server, base: `http://127.0.0.1:${port}` };
}

test("HTTP service exposes health and protects mutations with token and idempotency", async () => {
  const context = await fixture();
  try {
    const health = await fetch(`${context.base}/v1/health`);
    assert.deepEqual(await health.json(), { version: "test", pid: 1, bind: "127.0.0.1", status: "ready" });
    const unauthorized = await fetch(`${context.base}/v1/runs`, { method: "POST", body: "{}" });
    assert.equal(unauthorized.status, 401);
    const options = { method: "POST", headers: { "content-type": "application/json", "x-flow-local-token": context.token, "idempotency-key": "create-run-key-01" }, body: JSON.stringify({ flowId: "hello-flow", workspace: "/workspace", runtime: "codex", executionMode: "guided" }) };
    const created = await fetch(`${context.base}/v1/runs`, options);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).id, "run_test");
    const replayed = await fetch(`${context.base}/v1/runs`, options);
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).id, "run_test");
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("HTTP service rejects browser-originated mutations and invalid lifecycle transitions", async () => {
  const context = await fixture();
  try {
    const headers = { "content-type": "application/json", "x-flow-local-token": context.token, "idempotency-key": "create-run-key-02" };
    await fetch(`${context.base}/v1/runs`, { method: "POST", headers, body: JSON.stringify({ flowId: "hello-flow", workspace: "/workspace", runtime: "claude", executionMode: "guided" }) });
    const invalid = await fetch(`${context.base}/v1/runs/run_test/lifecycle`, { method: "POST", headers: { ...headers, "idempotency-key": "lifecycle-key-001" }, body: JSON.stringify({ action: "resume" }) });
    assert.equal(invalid.status, 400);
    const origin = await fetch(`${context.base}/v1/runs/run_test/lifecycle`, { method: "POST", headers: { ...headers, origin: "https://example.test", "idempotency-key": "lifecycle-key-002" }, body: JSON.stringify({ action: "start" }) });
    assert.equal(origin.status, 400);
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("HTTP idempotency survives a new server instance and audit reflects stored failed receipts", async () => {
  const context = await fixture();
  const body = { flowId: "hello-flow", workspace: "/workspace", runtime: "codex", executionMode: "guided" };
  const headers = { "content-type": "application/json", "x-flow-local-token": context.token, "idempotency-key": "persisted-create-01" };
  try {
    await fetch(`${context.base}/v1/runs`, { method: "POST", headers, body: JSON.stringify(body) });
    await new Promise((resolve) => context.server.close(resolve));
    const token = new LocalToken(context.directory);
    const store = new FileStateStore(context.directory);
    context.server = createHttpServer({ token, runService: new RunService({ stateStore: store, createId: () => "run_other" }), serviceInfo: () => ({ version: "test", pid: 1, bind: "127.0.0.1", status: "ready" }) });
    await new Promise((resolve) => context.server.listen(0, "127.0.0.1", resolve));
    context.base = `http://127.0.0.1:${context.server.address().port}`;
    const replayed = await fetch(`${context.base}/v1/runs`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).id, "run_test");
    await fetch(`${context.base}/v1/runs/run_test/checkpoint`, { method: "POST", headers: { ...headers, "idempotency-key": "failed-receipt-001" }, body: JSON.stringify({ receipt: { runId: "run_test", nodeId: "verify", status: "failed" } }) });
    const audit = await fetch(`${context.base}/v1/runs/run_test/audit`);
    assert.deepEqual(await audit.json(), { schemaVersion: "v1", runId: "run_test", result: "failed", findings: [{ code: "NODE_FAILED", nodeId: "verify" }] });
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("HTTP list runs uses an opaque cursor with stable pages", async () => {
  const context = await fixture();
  try {
    const store = new FileStateStore(context.directory);
    await store.writeRun({ schemaVersion: "v1", id: "run_first", flowId: "hello-flow", runtime: "codex", executionMode: "guided", status: "completed", createdAt: "2026-01-01T00:00:00.000Z" });
    await store.writeRun({ schemaVersion: "v1", id: "run_second", flowId: "hello-flow", runtime: "codex", executionMode: "guided", status: "completed", createdAt: "2026-02-01T00:00:00.000Z" });
    await store.writeRun({ schemaVersion: "v1", id: "run_third", flowId: "hello-flow", runtime: "codex", executionMode: "guided", status: "completed", createdAt: "2026-03-01T00:00:00.000Z" });
    const first = await (await fetch(`${context.base}/v1/runs?limit=2`)).json();
    assert.deepEqual(first.items.map((run) => run.id), ["run_third", "run_second"]);
    assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/);
    const second = await (await fetch(`${context.base}/v1/runs?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    assert.deepEqual(second.items.map((run) => run.id), ["run_first"]);
    assert.equal(second.nextCursor, null);
    assert.equal((await fetch(`${context.base}/v1/runs?cursor=not-a-cursor`)).status, 400);
  } finally {
    await new Promise((resolve) => context.server.close(resolve));
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("service host acquires its lock before loopback bind and releases only on stop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-service-test-"));
  const port = 47991;
  const host = new ServiceHost({ stateDir: directory, port, version: "test" });
  try {
    assert.deepEqual(await host.start(), { version: "test", pid: process.pid, bind: "127.0.0.1", status: "ready" });
    const health = await fetch(`http://127.0.0.1:${port}/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ready");
    assert.equal(await host.stop(), true);
    assert.equal(await host.stop(), false);
    await assert.rejects(readFile(join(directory, "service.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI starts, inspects, and stops a local service without adapters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-cli-test-"));
  const port = 47992;
  const argumentsList = [cli];
  try {
    const started = await execFile(process.execPath, [...argumentsList, "start", "--state-dir", directory, "--port", String(port)]);
    assert.equal(JSON.parse(started.stdout).status, "ready");
    const status = await execFile(process.execPath, [...argumentsList, "status", "--state-dir", directory]);
    assert.equal(JSON.parse(status.stdout).bind, "127.0.0.1");
    const stopped = await execFile(process.execPath, [...argumentsList, "stop", "--state-dir", directory]);
    assert.equal(JSON.parse(stopped.stdout).status, "stopping");
  } finally {
    try { await execFile(process.execPath, [...argumentsList, "stop", "--state-dir", directory]); } catch { /* The service may already be stopped. */ }
    await rm(directory, { recursive: true, force: true });
  }
});

test("flow CLI uses the local API and requires explicit direct-mode approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flow-client-test-"));
  const port = 47995;
  const host = new ServiceHost({ stateDir: directory, port });
  const withStateDir = (command, ...argumentsList) => [flowCli, command, "--state-dir", directory, ...argumentsList];
  try {
    await host.start();
    const listed = await execFile(process.execPath, withStateDir("list"));
    assert.deepEqual(JSON.parse(listed.stdout), { items: [], nextCursor: null });
    await assert.rejects(execFile(process.execPath, withStateDir("start", "--flow", "hello-flow", "--workspace", "/workspace", "--runtime", "codex", "--mode", "direct")), /approve-host-adapter/);
    const created = await execFile(process.execPath, withStateDir("start", "--flow", "hello-flow", "--workspace", "/workspace", "--runtime", "codex", "--mode", "guided"));
    const run = JSON.parse(created.stdout);
    assert.equal(run.status, "created");
    const inspected = await execFile(process.execPath, withStateDir("inspect", run.id));
    assert.equal(JSON.parse(inspected.stdout).id, run.id);
    const audit = await execFile(process.execPath, withStateDir("audit", run.id));
    assert.equal(JSON.parse(audit.stdout).result, "passed");
  } finally {
    await host.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [signal, port] of [["SIGINT", 47993], ["SIGTERM", 47994]]) {
  test(`CLI serve exits cleanly on ${signal}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "flow-cli-signal-test-"));
    const child = spawn(process.execPath, [cli, "serve", "--state-dir", directory, "--port", String(port)], { stdio: "ignore" });
    try {
      await waitForHealth(`http://127.0.0.1:${port}`);
      child.kill(signal);
      const [exitCode, exitSignal] = await once(child, "exit");
      assert.equal(exitCode, 0);
      assert.equal(exitSignal, null);
      await assert.rejects(readFile(join(directory, "service.json"), "utf8"), { code: "ENOENT" });
      await assert.rejects(readFile(join(directory, "service.lock", "owner.json"), "utf8"), { code: "ENOENT" });
    } finally {
      child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  });
}
