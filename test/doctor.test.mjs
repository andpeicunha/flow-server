import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseFlowSetup } from "../src/service/doctor-service.js";

const sourceService = () => ({
  sources: [{ id: "personal", mode: "git", currentBranch: "main" }],
  catalog: { listEntries: async () => [{ sourceId: "personal", flow: { nodes: [
    { model: "provider/model-a", skills: ["test-evidence-audit"] },
    { model: "provider/model-a", skills: ["test-evidence-audit"] }
  ] } }] },
  initialize: async () => {}
});

test("doctor checks the local harness without running a flow or model", async () => {
  const commands = [];
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: sourceService(), client: { list: async () => ({ items: [{ id: "sample" }] }) },
    runCommand: async (...args) => { commands.push(args); return { stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) }; },
    fileAccess: async (path) => { assert.match(path, /test-evidence-audit\/SKILL\.md$/); }
  });
  assert.equal(result.status, "ready_for_run_test", JSON.stringify(result.checks));
  assert.deepEqual(result.checks.find((item) => item.name === "skills").missing, []);
  assert.deepEqual(result.checks.find((item) => item.name === "modelAccess"), { name: "modelAccess", status: "not_tested", declared: ["provider/model-a"] });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0][1], ["mcp", "get", "flow-server", "--json"]);
});

test("doctor reports a missing Skill and MCP registration as failures", async () => {
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: sourceService(), client: { list: async () => ({ items: [] }) },
    runCommand: async () => ({ stdout: JSON.stringify({ enabled: false, transport: { type: "stdio", command: "flow-mcp", args: [] } }) }),
    fileAccess: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
  });
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.find((item) => item.name === "codexMcpRegistration").status, "failed");
  assert.deepEqual(result.checks.find((item) => item.name === "skills").missing, ["codex:test-evidence-audit"]);
});

test("doctor checks Claude MCP and Claude Skills for a Claude machine", async () => {
  const source = sourceService();
  source.sources[0].execution = { runtime: "claude" };
  const commands = [];
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: source, client: { list: async () => ({ items: [] }) },
    runCommand: async (...args) => { commands.push(args); return { stdout: "flow-server:\n  Status: ✔ Connected\n  Type: stdio\n  Command: /bin/flow-mcp\n" }; },
    fileAccess: async (path) => { assert.match(path, /\.claude\/skills\/test-evidence-audit\/SKILL\.md$/); }
  });
  assert.equal(result.status, "ready_for_run_test", JSON.stringify(result.checks));
  assert.equal(result.checks.find((item) => item.name === "claudeMcpRegistration").status, "passed");
  assert.deepEqual(commands[0][1], ["mcp", "get", "flow-server"]);
});
