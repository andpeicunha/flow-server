#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveStateDir } from "../core/state-dir.js";
import { ServiceHost } from "../service/service-host.js";

const commands = new Set(["start", "status", "stop", "doctor", "serve"]);

function usage() {
  return "Usage: flow-server <start|status|stop|doctor> [--state-dir DIR] [--port PORT]";
}

function options(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const key = argumentsList[index];
    if (!key.startsWith("--") || values[key]) throw new Error(`Invalid option: ${key}`);
    values[key] = argumentsList[index + 1];
    if (!values[key] || values[key].startsWith("--")) throw new Error(`Missing value for ${key}`);
    index += 1;
  }
  const unexpected = Object.keys(values).find((key) => !["--state-dir", "--port"].includes(key));
  if (unexpected) throw new Error(`Unsupported option: ${unexpected}`);
  const port = values["--port"] === undefined ? 4729 : Number(values["--port"]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer from 1 to 65535.");
  return { stateDir: values["--state-dir"] || resolveStateDir({ homeDir: homedir() }), port };
}

async function metadata(stateDir) {
  return JSON.parse(await readFile(`${stateDir}/service.json`, "utf8"));
}

async function health(endpoint) {
  const response = await fetch(`${endpoint}/v1/health`, { signal: AbortSignal.timeout(1_000) });
  if (!response.ok) throw new Error(`Service health returned ${response.status}.`);
  return response.json();
}

async function serve(configuration) {
  const host = new ServiceHost(configuration);
  await host.start();
  const stop = async () => { await host.stop(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function start(configuration) {
  try {
    console.log(JSON.stringify(await health(`http://127.0.0.1:${configuration.port}`)));
    return;
  } catch { /* Start a new local service. */ }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve", "--state-dir", configuration.stateDir, "--port", String(configuration.port)], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      console.log(JSON.stringify(await health(`http://127.0.0.1:${configuration.port}`)));
      return;
    } catch { /* Wait for the child. */ }
  }
  throw new Error("flow-service did not become healthy within 2 seconds.");
}

async function status(configuration) {
  const info = await metadata(configuration.stateDir);
  const result = await health(info.endpoint);
  console.log(JSON.stringify(result));
  return result;
}

async function stop(configuration) {
  const info = await metadata(configuration.stateDir);
  const token = (await readFile(`${configuration.stateDir}/service.token`, "utf8")).trim();
  const response = await fetch(`${info.endpoint}/v1/service/shutdown`, { method: "POST", headers: { "x-flow-local-token": token, "idempotency-key": `cli-stop-${Date.now()}-${process.pid}` } });
  if (!response.ok) throw new Error(`Service shutdown returned ${response.status}.`);
  console.log(JSON.stringify(await response.json()));
}

async function doctor(configuration) {
  let service = "stopped";
  try { service = (await status(configuration)).status; } catch { /* Report state below. */ }
  console.log(JSON.stringify({ node: process.version, stateDir: configuration.stateDir, expectedBind: "127.0.0.1", service }));
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (!commands.has(command)) throw new Error(usage());
  const configuration = options(argumentsList);
  if (command === "serve") return serve(configuration);
  if (command === "start") return start(configuration);
  if (command === "status") return status(configuration);
  if (command === "stop") return stop(configuration);
  return doctor(configuration);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
