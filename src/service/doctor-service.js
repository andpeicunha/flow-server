import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LocalFlowClient } from "../mcp/local-client.js";
import { FlowSourceService } from "./flow-source-service.js";

const execFile = promisify(execFileCallback);

export async function diagnoseFlowSetup({ stateDir, sourceConfig, profileId, flowId, homeDir = homedir(),
  sourceService = new FlowSourceService({ configPath: sourceConfig }),
  client = new LocalFlowClient({ stateDir }),
  runCommand = execFile, fileAccess = access } = {}) {
  const checks = [];
  const check = async (name, operation) => {
    try { checks.push({ name, status: "passed", ...(await operation()) }); }
    catch (error) { checks.push({ name, status: "failed", reason: error.code || error.message || "unavailable" }); }
  };

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", status: nodeMajor >= 22 ? "passed" : "failed", version: process.version });

  let entries = [];
  await check("source", async () => {
    await sourceService.initialize();
    entries = (await sourceService.catalog.listEntries()).filter((entry) =>
      (!profileId || entry.sourceId === profileId) && (!flowId || entry.flow.id === flowId));
    if (!entries.length) throw new Error("NO_FLOWS_CONFIGURED");
    return { profiles: sourceService.sources.filter(({ id }) => !profileId || id === profileId).map(({ id, mode, currentBranch }) => ({ id, mode, ...(currentBranch ? { branch: currentBranch } : {}) })), flowCount: entries.length };
  });

  await check("serviceAndMcpBridge", async () => {
    const response = await client.list();
    return { reachableFlows: response.items?.length ?? 0 };
  });

  const effective = [];
  await check("execution", async () => {
    for (const entry of entries) {
      const resolved = sourceService.resolve
        ? await sourceService.resolve({ flowId: entry.flow.id, profileId: entry.sourceId })
        : { flowDefinition: entry.flow, runtime: sourceService.sources.find((source) => source.id === entry.sourceId)?.execution?.runtime };
      effective.push({ flow: resolved.flowDefinition, runtime: resolved.runtime ?? "codex" });
    }
    return { runtimes: [...new Set(effective.map((item) => item.runtime))].sort() };
  });

  const runtimes = [...new Set(effective.map((item) => item.runtime))];
  for (const runtime of runtimes) {
    await check(`${runtime}McpRegistration`, async () => {
      if (runtime === "claude") {
        const { stdout } = await runCommand("claude", ["mcp", "get", "flow-server"], { timeout: 5_000 });
        if (!/Type:\s*stdio/i.test(stdout) || !/(^|[ /])flow-mcp(?:\.mjs)?(?:\s|$)/m.test(stdout) || !/Connected/i.test(stdout)) throw new Error("FLOW_MCP_NOT_CONFIGURED");
      } else {
        const { stdout } = await runCommand("codex", ["mcp", "get", "flow-server", "--json"], { timeout: 5_000 });
        const config = JSON.parse(stdout);
        const command = `${config.transport?.command || ""} ${(config.transport?.args || []).join(" ")}`;
        if (!config.enabled || config.transport?.type !== "stdio" || !/(^|[ /])flow-mcp(?:\.mjs)?(?:\s|$)/.test(command)) throw new Error("FLOW_MCP_NOT_CONFIGURED");
      }
      return { transport: "stdio" };
    });
  }

  const skills = [...new Set(effective.flatMap(({ flow }) => flow.nodes?.flatMap((node) => node.skills ?? []) ?? []))].sort();
  const missing = [];
  for (const { flow, runtime } of effective) for (const skill of new Set(flow.nodes?.flatMap((node) => node.skills ?? []) ?? [])) {
    if (!/^[a-z][a-z0-9-]{0,127}$/.test(skill)) { missing.push(skill); continue; }
    const roots = runtime === "claude" ? [join(homeDir, ".claude", "skills")]
      : [join(homeDir, ".agents", "skills"), join(homeDir, ".codex", "skills")];
    let found = false;
    for (const root of roots) {
      try { await fileAccess(join(root, skill, "SKILL.md")); found = true; break; }
      catch { /* Try the next installed Skill directory. */ }
    }
    if (!found) missing.push(`${runtime}:${skill}`);
  }
  checks.push({ name: "skills", status: entries.length && effective.length && !missing.length ? "passed" : "failed", declared: skills.length, missing: [...new Set(missing)].sort() });

  const models = [...new Set(effective.flatMap(({ flow }) => flow.nodes?.map((node) => node.model).filter(Boolean) ?? []))].sort();
  checks.push({ name: "modelAccess", status: "not_tested", declared: models });
  return { status: checks.some((item) => item.status === "failed") ? "not_ready" : "ready_for_run_test", checks };
}
