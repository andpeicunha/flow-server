import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const json = (path) => readFile(new URL(path, import.meta.url), "utf8").then(JSON.parse);

test("every v1 JSON Schema contract has a stable identifier", async () => {
  for (const file of ["flow-document.schema.json", "run.schema.json", "receipt.schema.json", "http-error.schema.json", "run-state-machine.json"]) {
    const schema = await json(`../contracts/v1/${file}`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(schema.$id, /^https:\/\/flow-server\.dev\/contracts\/v1\//);
    assert.equal(schema.additionalProperties, false);
  }
});

test("the HTTP contract is loopback-only and protects every mutable operation", async () => {
  const api = await json("../contracts/v1/openapi.json");
  assert.equal(api.openapi, "3.1.0");
  assert.match(api.servers[0].url, /^http:\/\/127\.0\.0\.1/);

  for (const [path, item] of Object.entries(api.paths)) {
    if (!item.post) continue;
    const parameters = item.post.parameters ?? [];
    const references = parameters.map((parameter) => parameter.$ref);
    assert.ok(references.includes("#/components/parameters/LocalToken"), `${path} has local token`);
    assert.ok(references.includes("#/components/parameters/IdempotencyKey"), `${path} has idempotency key`);
  }
});

test("the lifecycle contract permits no transitions from terminal states", async () => {
  const stateMachine = await json("../contracts/v1/run-state-machine.json");
  const transitions = stateMachine.examples[0].transitions;
  assert.ok(transitions.every((transition) => !["stopped", "completed", "failed"].includes(transition.from)));
});

test("the public example is synthetic and uses v1 run and receipt contracts", async () => {
  const [run, receipt, audit] = await Promise.all([
    json("../examples/hello-flow/run.json"),
    json("../examples/hello-flow/receipt.json"),
    json("../examples/hello-flow/audit.json")
  ]);
  assert.equal(run.schemaVersion, "v1");
  assert.equal(receipt.schemaVersion, "v1");
  assert.equal(receipt.runId, run.id);
  assert.equal(audit.synthetic, true);
  assert.deepEqual(audit.findings, []);
});
