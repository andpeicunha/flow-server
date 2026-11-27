import assert from "node:assert/strict";
import test from "node:test";
import { resolveFlowSourceConfigPath } from "../src/core/flow-source-config.js";

test("source config path uses explicit, environment, then per-machine default", () => {
  const homeDir = "/home/developer";
  assert.equal(resolveFlowSourceConfigPath({ explicit: "/flows/explicit.json", env: { FLOW_SOURCE_CONFIG: "/flows/env.json" }, homeDir }), "/flows/explicit.json");
  assert.equal(resolveFlowSourceConfigPath({ env: { FLOW_SOURCE_CONFIG: "/flows/env.json" }, homeDir }), "/flows/env.json");
  assert.equal(resolveFlowSourceConfigPath({ env: {}, homeDir }), "/home/developer/.config/flow-server/sources.json");
});
