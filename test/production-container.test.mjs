import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { assertHealthyMcp, mcpRequest, rpc, token, waitForHealth } from "./production-server-helpers.mjs";

const execFile = promisify(execFileCallback);
const enabled = process.env.FLOW_MCP_TEST_CONTAINER === "1";

test("production Docker image starts with the safe fixture catalog", { skip: !enabled }, async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const image = `flow-mcp-test:${suffix}`;
  const container = `flow-mcp-test-${suffix}`;
  const catalog = new URL("./fixtures/remote-approved-releases.json", import.meta.url).pathname;
  t.after(async () => {
    await execFile("docker", ["rm", "--force", container]).catch(() => {});
    await execFile("docker", ["image", "rm", image]).catch(() => {});
  });

  await execFile("docker", ["build", "--tag", image, "--file", "deploy/mcp/Dockerfile", "."]);
  await execFile("docker", ["run", "--detach", "--name", container, "--publish", "127.0.0.1::3422", "--env", `MCP_ACCESS_TOKEN=${token}`, "--env", "MCP_CATALOG_FILE=/app/config/approved-releases.json", "--volume", `${catalog}:/app/config/approved-releases.json:ro`, image]);
  const { stdout } = await execFile("docker", ["port", container, "3422/tcp"]);
  const address = stdout.trim().split("\n")[0];
  const endpoint = `http://${address}`;
  await waitForHealth(endpoint);
  await assertHealthyMcp(endpoint);
  const recommendation = await mcpRequest(endpoint, rpc("tools/call", { name: "flow_recommend", arguments: { taskSummary: "validate SDD", tags: ["sdd"] } }));
  assert.equal(recommendation.body.result.structuredContent.items[0].flowId, "sdd");
});
