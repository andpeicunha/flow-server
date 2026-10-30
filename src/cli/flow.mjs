#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveStateDir } from "../core/state-dir.js";

const commands = new Set(["list", "flows", "select", "start", "next", "lifecycle", "inspect", "checkpoint", "audit", "review"]);

function usage() {
  return "Usage: flow <flows|list|select|start|next|lifecycle|inspect|checkpoint|audit|review> [options]";
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
    if (["--approve-host-adapter", "--compare-versions"].includes(item)) {
      values[item] = true;
      continue;
    }
    if (values[item]) throw new Error(`Repeated option: ${item}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
    values[item] = value;
    index += 1;
  }
  const allowed = new Set(["--state-dir", "--flow", "--profile", "--task", "--workspace", "--runtime", "--mode", "--receipt", "--approve-host-adapter", "--last", "--since", "--content-hash", "--compare-versions"]);
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
  if (command === "flows") {
    const parameter = values["--profile"] ? `?profileId=${encodeURIComponent(values["--profile"])}` : "";
    return console.log(JSON.stringify(await request(client, `/v1/flows${parameter}`)));
  }
  if (command === "inspect") {
    return console.log(JSON.stringify(await request(client, `/v1/runs/${requireOption({ id: positional[0] }, "id")}`)));
  }
  if (command === "next") {
    return console.log(JSON.stringify(await request(client, `/v1/runs/${requireOption({ id: positional[0] }, "id")}/next`, { method: "POST", body: {}, mutate: true })));
  }
  if (command === "lifecycle") {
    const runId = requireOption({ id: positional[0] }, "runId");
    const action = requireOption({ action: positional[1] }, "action");
    if (!["pause", "resume", "stop", "fail"].includes(action)) throw new Error("action must be pause, resume, stop, or fail.");
    return console.log(JSON.stringify(await request(client, `/v1/runs/${encodeURIComponent(runId)}/lifecycle`, { method: "POST", body: { action }, mutate: true })));
  }
  if (command === "audit") {
    return console.log(JSON.stringify(await request(client, `/v1/runs/${requireOption({ id: positional[0] }, "id")}/audit`)));
  }
  if (command === "review") {
    const last = values["--last"] === undefined ? 20 : Number(values["--last"]);
    if (!Number.isInteger(last)) throw new Error("--last must be an integer.");
    const body = {
      flowId: requireOption({ flowId: positional[0] ?? values["--flow"] }, "flowId"),
      ...(values["--profile"] ? { profileId: values["--profile"] } : {}),
      last,
      ...(values["--since"] ? { since: values["--since"] } : {}),
      ...(values["--content-hash"] ? { contentHash: values["--content-hash"] } : {}),
      ...(values["--compare-versions"] ? { compareVersions: true } : {})
    };
    return console.log(JSON.stringify(await request(client, "/v1/reviews", { method: "POST", body, mutate: true })));
  }
  if (command === "select") {
    const body = {
      workspace: requireOption(values, "--workspace"),
      ...(values["--profile"] ? { profileId: values["--profile"] } : {}),
      ...(values["--flow"] ? { flowId: values["--flow"] } : {}),
      ...(values["--task"] ? { task: values["--task"] } : {})
    };
    return console.log(JSON.stringify(await request(client, "/v1/flow-selection", { method: "POST", body, mutate: true })));
  }
  if (command === "start") {
    const runtime = requireOption(values, "--runtime");
    const mode = requireOption(values, "--mode");
    if (mode === "direct" && !values["--approve-host-adapter"]) {
      throw new Error("Direct mode requires --approve-host-adapter. No adapter is launched by this development build.");
    }
    const workspace = requireOption(values, "--workspace");
    const selection = await request(client, "/v1/flow-selection", { method: "POST", body: {
      workspace,
      ...(values["--profile"] ? { profileId: values["--profile"] } : {}),
      ...(values["--flow"] ? { flowId: values["--flow"] } : {}),
      ...(values["--task"] ? { task: values["--task"] } : {})
    }, mutate: true });
    if (selection.decision !== "ready") {
      console.log(JSON.stringify(selection));
      process.exitCode = 2;
      return;
    }
    const body = { flowId: selection.flowId, profileId: selection.profileId, workspace, runtime, executionMode: mode, ...(values["--task"] ? { task: values["--task"] } : {}) };
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
