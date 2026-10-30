#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { FlowChangeTracker } from "../core/flow-change-tracker.js";
import { identifyFlowDocument, parseFlowDocument } from "../core/flow-document.js";
import { loadFlowSourceConfig } from "../core/flow-source-config.js";
import { resolveStateDir } from "../core/state-dir.js";

function parse(argumentsList) {
  const values = {};
  const positional = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const item = argumentsList[index];
    if (!item.startsWith("--")) { positional.push(item); continue; }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--") || values[item]) throw new Error(`Invalid option: ${item}`);
    values[item] = value;
    index += 1;
  }
  return { positional, values };
}

async function validate(filePath) {
  const path = resolve(filePath);
  const extension = extname(path);
  const flow = parseFlowDocument(await readFile(path, "utf8"), { format: extension === ".json" ? "json" : "yaml", source: path });
  const { contentHash } = identifyFlowDocument(flow);
  return { status: "valid", flowId: flow.id, contentHash };
}

async function mark(values) {
  const configPath = values["--config"];
  const sourceId = values["--source"];
  const filePath = values["--file"];
  if (!configPath || !sourceId || !filePath) throw new Error("mark requires --config, --source, and --file.");
  const config = await loadFlowSourceConfig(resolve(configPath));
  const source = config.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Unknown flow source: ${sourceId}`);
  const stateDir = values["--state-dir"] ? resolve(values["--state-dir"]) : resolveStateDir({ homeDir: homedir() });
  return new FlowChangeTracker({ stateDir }).mark(source, resolve(filePath));
}

const [command, ...argumentsList] = process.argv.slice(2);
const { positional, values } = parse(argumentsList);
try {
  let result;
  if (command === "validate" && positional.length === 1) result = await validate(positional[0]);
  else if (command === "mark" && positional.length === 0) result = await mark(values);
  else throw new Error("Usage: flow-source <validate FILE|mark --config FILE --source ID --file FILE [--state-dir DIR]>");
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exitCode = 1;
}
