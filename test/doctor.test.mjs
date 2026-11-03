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
  assert.equal(result.checks.find((item) => item.name === "serviceAndMcpBridge").status, "failed");
  assert.deepEqual(result.checks.find((item) => item.name === "skills").missing, ["codex:test-evidence-audit"]);
});

test("doctor checks Claude MCP and Claude Skills for a Claude machine", async () => {
  const source = sourceService();
  source.sources[0].execution = { runtime: "claude" };
  const commands = [];
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: source, client: { list: async () => ({ items: [{ id: "sample" }] }) },
    runCommand: async (...args) => { commands.push(args); return { stdout: "flow-server:\n  Status: ✔ Connected\n  Type: stdio\n  Command: /bin/flow-mcp\n" }; },
    fileAccess: async (path) => { assert.match(path, /\.claude\/skills\/test-evidence-audit\/SKILL\.md$/); }
  });
  assert.equal(result.status, "ready_for_run_test", JSON.stringify(result.checks));
  assert.equal(result.checks.find((item) => item.name === "claudeMcpRegistration").status, "passed");
  assert.deepEqual(commands[0][1], ["mcp", "get", "flow-server"]);
});

test("doctor checks both runtimes and skills when a source allows Codex fallback", async () => {
  const source = sourceService();
  source.sources[0].execution = { runtime: "claude", fallback: { runtime: "codex" } };
  source.resolve = async () => ({ runtime: "claude", flowDefinition: { nodes: [{ id: "verify", model: "anthropic/claude-test", skills: ["test-evidence-audit"] }] },
    fallbackExecutions: { verify: { runtime: "codex", model: "openai/gpt-6.1-sol", effort: "medium" } } });
  const commands = [];
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: source, client: { list: async () => ({ items: [{ id: "sample" }] }) },
    runCommand: async (command, args) => { commands.push(command); return command === "claude"
      ? { stdout: "flow-server:\n  Status: ✔ Connected\n  Type: stdio\n  Command: /bin/flow-mcp\n" }
      : { stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) }; },
    fileAccess: async (path) => { assert.match(path, /test-evidence-audit\/SKILL\.md$/); }
  });
  assert.equal(result.status, "ready_for_run_test", JSON.stringify(result.checks));
  assert.deepEqual(commands.sort(), ["claude", "codex"]);
  assert.deepEqual(result.checks.find((item) => item.name === "modelAccess").declared, ["anthropic/claude-test", "openai/gpt-6.1-sol"]);
});

test("doctor reports missing Design System MCP for Codex fallback", async () => {
  const source = sourceService();
  source.resolve = async () => ({ runtime: "claude", flowDefinition: { nodes: [{ id: "verify", model: "anthropic/claude-test", skills: ["prv-ds-compliance"] }] },
    fallbackExecutions: { verify: { runtime: "codex", model: "openai/gpt-6.1-sol", effort: "medium" } } });
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: source, client: { list: async () => ({ items: [{ id: "sample" }] }) },
    runCommand: async (command, args) => args[2] === "pravaler-ds"
      ? { stdout: JSON.stringify({ enabled: false, transport: { type: "streamable_http" } }) }
      : command === "claude" ? { stdout: "flow-server:\n  Status: ✔ Connected\n  Type: stdio\n  Command: /bin/flow-mcp\n" }
        : { stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) },
    fileAccess: async () => {}
  });
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.find((item) => item.name === "codexDesignSystemMcpRegistration").status, "failed");
});

test("doctor reports unreachable Design System MCP DNS for Codex fallback", async () => {
  const source = sourceService();
  source.resolve = async () => ({ runtime: "claude", flowDefinition: { nodes: [{ id: "verify", model: "anthropic/claude-test", skills: ["prv-ds-compliance"] }] },
    fallbackExecutions: { verify: { runtime: "codex", model: "openai/gpt-6.1-sol", effort: "medium" } } });
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: source, client: { list: async () => ({ items: [{ id: "sample" }] }) },
    runCommand: async (command, args) => args[2] === "pravaler-ds"
      ? { stdout: JSON.stringify({ enabled: true, transport: { type: "streamable_http", url: "https://example.test/ds" } }) }
      : command === "claude" ? { stdout: "flow-server:\n  Status: ✔ Connected\n  Type: stdio\n  Command: /bin/flow-mcp\n" }
        : { stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) },
    fileAccess: async () => {}, resolveHost: async () => { throw Object.assign(new Error("DNS unavailable"), { code: "ENOTFOUND" }); }
  });
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.find((item) => item.name === "codexDesignSystemMcpDns").reason, "ENOTFOUND");
});

test("doctor rejects a healthy service with no loaded flows", async () => {
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    sourceService: sourceService(), client: { list: async () => ({ items: [] }) },
    runCommand: async () => ({ stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) }),
    fileAccess: async () => {}
  });
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.find((item) => item.name === "serviceAndMcpBridge").reason, "NO_FLOWS_IN_RUNNING_SERVICE");
});

test("doctor rejects a requested flow missing from the running service", async () => {
  const result = await diagnoseFlowSetup({ stateDir: "/unused", sourceConfig: "/unused", homeDir: "/home/test",
    profileId: "personal", flowId: "wanted",
    sourceService: { ...sourceService(), catalog: { listEntries: async () => [{ sourceId: "personal", flow: { id: "wanted", nodes: [] } }] } },
    client: { list: async (profileId) => { assert.equal(profileId, "personal"); return { items: [{ id: "other" }] }; } },
    runCommand: async () => ({ stdout: JSON.stringify({ enabled: true, transport: { type: "stdio", command: "flow-mcp", args: [] } }) }),
    fileAccess: async () => {}
  });
  assert.equal(result.status, "not_ready");
  assert.equal(result.checks.find((item) => item.name === "serviceAndMcpBridge").reason, "NO_FLOWS_IN_RUNNING_SERVICE");
});
