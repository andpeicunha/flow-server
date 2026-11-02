import assert from "node:assert/strict";
import test from "node:test";
import { checkBeforeStart } from "../src/service/startup-check.js";

const refused = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
const blocked = Object.assign(new Error("fetch failed"), { cause: { code: "EPERM" } });
const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
const base = { stateDir: "/state", port: 4741, sourceConfig: "/flows.json" };

test("healthy service is reused without checking or changing the lock", async () => {
  const running = { status: "ready", sourceConfig: "/flows.json" };
  const result = await checkBeforeStart({ ...base,
    fetchImpl: async () => ({ ok: true, json: async () => running }),
    readFileImpl: async () => { throw new Error("lock must not be read"); }
  });
  assert.deepEqual(result, { action: "ready", running });
});

test("a stopped service without a lock may start", async () => {
  const result = await checkBeforeStart({ ...base,
    fetchImpl: async () => { throw refused; },
    readFileImpl: async () => { throw missing; },
    accessImpl: async () => { throw missing; }
  });
  assert.deepEqual(result, { action: "start" });
});

test("blocked loopback never triggers another start, even when the lock cannot be read", async () => {
  await assert.rejects(checkBeforeStart({ ...base,
    fetchImpl: async () => { throw blocked; },
    readFileImpl: async () => { throw new Error("should not inspect lock"); }
  }), /loopback blocked/);
});

test("an uncertain connection failure does not start a second service", async () => {
  await assert.rejects(checkBeforeStart({ ...base,
    fetchImpl: async () => { throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }); },
    readFileImpl: async () => { throw new Error("should not inspect lock"); }
  }), /Cannot confirm that the flow-service is stopped/);
});

test("a live lock owner blocks a second start and reports the port", async () => {
  await assert.rejects(checkBeforeStart({ ...base,
    fetchImpl: async () => { throw refused; },
    readFileImpl: async () => JSON.stringify({ pid: 123 }),
    isProcessAlive: (pid) => pid === 123
  }), /active process 123.*port 4741/);
});

test("a lock without owner metadata is preserved", async () => {
  await assert.rejects(checkBeforeStart({ ...base,
    fetchImpl: async () => { throw refused; },
    readFileImpl: async () => { throw missing; },
    accessImpl: async () => {}
  }), /lock exists without readable owner metadata/);
});

test("a healthy service with another source is not reused", async () => {
  await assert.rejects(checkBeforeStart({ ...base,
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ready", sourceConfig: "/other.json" }) })
  }), /different source configuration/);
});
