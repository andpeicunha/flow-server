#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadFlowSourceConfig, validateFlowSourceConfig } from "../src/core/flow-source-config.js";
import { resolveStateDir } from "../src/core/state-dir.js";
import { LocalFlowClient } from "../src/mcp/local-client.js";
import { FlowSourceService } from "../src/service/flow-source-service.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.FLOW_SOURCE_CONFIG || join(homedir(), ".config", "flow-server", "sources.json");
const stateDir = resolveStateDir({ homeDir: homedir() });
const port = process.env.FLOW_SERVICE_PORT || "4741";
const terminal = createInterface({ input: process.stdin, output: process.stdout });

async function ask(label, defaultValue = "") {
  const value = (await terminal.question(`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `)).trim();
  return value || defaultValue;
}

async function sourceConfig() {
  try {
    await readFile(configPath);
    return await loadFlowSourceConfig(configPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log("No local flow source is configured. Choose a directory that you own.");
  const mode = await ask("Source mode (local/git)", "local");
  if (!["local", "git"].includes(mode)) throw new Error("Source mode must be local or git.");
  const id = await ask("Source ID", "personal");
  const path = await realpath(resolve(await ask("Flow directory (existing)")));
  const rootInput = await ask("Workspace directory (existing; optional)");
  const workspaceRoots = rootInput ? [await realpath(resolve(rootInput))] : [];
  const config = validateFlowSourceConfig({ schemaVersion: "v1", sources: [{
    id, mode, path, workspaceRoots, sync: { pull: "confirm", push: "manual" }
  }] });
  console.log(`Source: ${path}`);
  console.log(`Workspace: ${workspaceRoots[0] || "none"}`);
  if ((await ask("Save this source? (yes/no)", "no")) !== "yes") throw new Error("Source setup cancelled.");
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return config;
}

function startService() {
  const result = spawnSync(process.execPath, [join(packageRoot, "src/cli/flow-server.mjs"), "start", "--state-dir", stateDir, "--source-config", configPath, "--port", port], { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "flow-server failed to start").trim());
}

function items(value) {
  return Array.isArray(value) ? value : value.items || [];
}

async function main() {
  await sourceConfig();
  startService();
  const client = new LocalFlowClient({ stateDir });
  console.log("Flow Server is ready. The local MCP uses this same service.");
  while (true) {
    console.log("\n1 List flows  2 Start guided run  3 Inspect run  4 Audit run  5 Validate sources  6 Guide  q Quit");
    const command = await ask("Choose");
    if (command === "q") return;
    try {
      if (command === "1") {
        for (const flow of items(await client.list())) console.log(`${flow.profileId}/${flow.id}  ${flow.title}`);
      } else if (command === "2") {
        const workspace = await realpath(resolve(await ask("Workspace", process.cwd())));
        const task = await ask("Task");
        if (!task) throw new Error("A task is required.");
        const flowId = await ask("Flow ID (blank for routing)");
        const selection = await client.selectFlow({ workspace, task, ...(flowId ? { flowId } : {}) });
        if (selection.decision !== "ready") {
          console.log(JSON.stringify(selection, null, 2));
          continue;
        }
        const runtime = await ask("Agent runtime (codex/claude)", "codex");
        if (!["codex", "claude"].includes(runtime)) throw new Error("Runtime must be codex or claude.");
        const run = await client.startGuided({ flowId: selection.flowId, profileId: selection.profileId, workspace, runtime, task });
        console.log(JSON.stringify(run, null, 2));
        console.log("Ask your agent to continue this run through the flow-server MCP.");
      } else if (command === "5") {
        const sourceService = new FlowSourceService({ configPath });
        await sourceService.initialize();
        const flows = await sourceService.list();
        console.log(`${flows.length} flow(s) valid across ${sourceService.sources.length} source(s).`);
      } else if (command === "6") {
        console.log(await readFile(join(packageRoot, "docs", "guia-rapido.md"), "utf8"));
      } else if (command === "3" || command === "4") {
        const runId = await ask("Run ID");
        console.log(JSON.stringify(command === "3" ? await client.inspect(runId) : await client.audit(runId), null, 2));
      } else {
        console.log("Unknown choice.");
      }
    } catch (error) {
      console.error(error.message);
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => terminal.close());
