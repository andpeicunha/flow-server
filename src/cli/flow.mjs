#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveStateDir } from "../core/state-dir.js";

const commands = new Set(["list", "start", "inspect", "checkpoint", "audit"]);

function usage() {
  return "Usage: flow <list|start|inspect|checkpoint|audit> [options]";
}

function parse(argumentsList) {
  const values = {};
  const positional = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const item = argumentsList[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    if (item === "--approve-host-adapter") {
      values[item] = true;
      continue;
    }
    if (values[item]) throw new Error(`Repeated option: ${item}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
    values[item] = value;
    index += 1;
  }
  const allowed = new Set(["--state-dir", "--flow", "--workspace", "--runtime", "--mode", "--receipt", "--approve-host-adapter"]);
  const unexpected = Object.keys(values).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`Unsupported option: ${unexpected}`);
  return { positional, values };
}

async function service(stateDir) {
  let info;
  try {
    info = JSON.parse(await readFile(`${stateDir}/service.json`, "utf8"));
  } catch {
    throw new Error("flow-service is unavailable. Start it with: flow-server start");
  }
  return {
    endpoint: info.endpoint,
    token: (await readFile(`${stateDir}/service.token`, "utf8")).trim()
  };
}

async function request(client, path, { method = "GET", body, mutate = false } = {}) {
  const headers = {};
  if (mutate) {
    headers["x-flow-local-token"] = client.token;
    headers["idempotency-key"] = `flow-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(`${client.endpoint}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("flow-service is unavailable. Start it with: flow-server start");
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(payload?.error?.message || `flow-service returned ${response.status}.`);
  return payload;
}

function requireOption(values, name) {
  if (!values[name]) throw new Error(`${name} is required.`);
  return values[name];
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (!commands.has(command)) throw new Error(usage());
  const { positional, values } = parse(argumentsList);
  const stateDir = values["--state-dir"] || resolveStateDir({ homeDir: homedir() });
  const client = await service(stateDir);

  if (command === "list") {
    const parameter = values["--flow"] ? `?flowId=${encodeURIComponent(values["--flow"])}` : "";
    return console.log(JSON.stringify(await request(client, `/v1/runs${parameter}`)));
  }
  if (command === "inspect") {
    return console.log(JSON.stringify(await request(client, `/v1/runs/${requireOption({ id: positional[0] }, "id")}`)));
  }
  if (command === "audit") {
    return console.log(JSON.stringify(await request(client, `/v1/runs/${requireOption({ id: positional[0] }, "id")}/audit`)));
  }
  if (command === "start") {
    const runtime = requireOption(values, "--runtime");
    const mode = requireOption(values, "--mode");
    if (mode === "direct" && !values["--approve-host-adapter"]) {
      throw new Error("Direct mode requires --approve-host-adapter. No adapter is launched by this development build.");
    }
    const body = { flowId: requireOption(values, "--flow"), workspace: requireOption(values, "--workspace"), runtime, executionMode: mode };
    return console.log(JSON.stringify(await request(client, "/v1/runs", { method: "POST", body, mutate: true })));
  }
  const receiptPath = requireOption(values, "--receipt");
  const runId = requireOption({ id: positional[0] }, "id");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  return console.log(JSON.stringify(await request(client, `/v1/runs/${runId}/checkpoint`, { method: "POST", body: { receipt }, mutate: true })));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
