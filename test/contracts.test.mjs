import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseFlowDocument } from "../src/core/flow-document.js";

const json = (path) => readFile(new URL(path, import.meta.url), "utf8").then(JSON.parse);

test("every v1 JSON Schema contract has a stable identifier", async () => {
  for (const file of ["flow-document.schema.json", "flow-source-config.schema.json", "flow-review.schema.json", "run.schema.json", "receipt.schema.json", "http-error.schema.json", "run-state-machine.json"]) {
    const schema = await json(`../contracts/v1/${file}`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(schema.$id, /^https:\/\/flow-server\.dev\/contracts\/v1\//);
    assert.ok(schema.additionalProperties === false || schema.oneOf?.every((variant) => variant.additionalProperties === false));
  }
});

test("every directly imported runtime package is declared", async () => {
  const packageFile = await json("../package.json");
  assert.equal(packageFile.dependencies["ajv-formats"], "^3.0.1");
});

test("the v2 flow contract validates normalized agent workflow YAML", async () => {
  const schema = await json("../contracts/v2/flow-document.schema.json");
  assert.equal(schema.$id, "https://flow-server.dev/contracts/v2/flow-document.schema.json");
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const flow = parseFlowDocument(`name: sample-workflow\nroute: { when: [feature], priority: 10 }\nstopWhen: { step: intake, jsonPath: decision, notEquals: ready, status: needs_confirmation, next: ask }\nnodes:\n  - id: intake\n    agent: explorer\n    model: provider/model\n    variant: low\n    executor: cli-session\n    skills: [sample-skill]\n    prompt: 'Task: {{task}}'\n    output: Return a decision\n  - id: feature_work\n    after: [intake]\n    when: { step: intake, jsonPath: decision, in: [ready] }\n    agent: builder\n    model: provider/model\n    effort: medium\n`, { format: "yaml" });
  assert.equal(validate(flow), true, JSON.stringify(validate.errors));
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

test("source and flow schemas accept policy and node MCPs and reject malformed rules", async () => {
  const sourceSchema = new Ajv2020({ strict: true }).compile(await json("../contracts/v1/flow-source-config.schema.json"));
  const source = { id: "sample", mode: "local", path: "/flows", sync: { pull: "confirm", push: "manual" }, policy: { skills: ["*", "!other*"], mcps: [], mcpRegistrations: { tools: { codex: "tools-local" } } } };
  assert.equal(sourceSchema({ schemaVersion: "v1", sources: [source] }), true, JSON.stringify(sourceSchema.errors));
  source.policy.skills = ["!other*"];
  assert.equal(sourceSchema({ schemaVersion: "v1", sources: [source] }), false);
  for (const version of ["v1", "v2"]) {
    const validate = new Ajv2020({ strict: true }).compile(await json(`../contracts/${version}/flow-document.schema.json`));
    const flow = { schemaVersion: version, id: "sample", nodes: [{ id: "work", mcps: ["tools"] }] };
    assert.equal(validate(flow), true, JSON.stringify(validate.errors));
    flow.nodes[0].mcps = ["bad?name"];
    assert.equal(validate(flow), false);
  }
});
