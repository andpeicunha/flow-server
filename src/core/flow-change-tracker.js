import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { FlowError } from "./errors.js";
import { identifyFlowDocument, parseFlowDocument } from "./flow-document.js";

function isWithin(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !path.includes("../"));
}

export class FlowChangeTracker {
  constructor({ stateDir, now = () => new Date().toISOString(), fs = { mkdir, readFile, realpath, rename, writeFile } } = {}) {
    if (!stateDir) throw new TypeError("stateDir is required.");
    this.stateDir = stateDir;
    this.now = now;
    this.fs = fs;
  }

  async mark(source, filePath) {
    const [root, file] = await Promise.all([this.fs.realpath(source.path), this.fs.realpath(filePath)]);
    if (!isWithin(root, file)) throw new FlowError("FLOW_SOURCE_ESCAPE", "Changed flow resolves outside its configured source root.");
    const extension = extname(file);
    if (![".json", ".yaml", ".yml"].includes(extension)) throw new FlowError("UNSUPPORTED_FLOW_FORMAT", "Changed flow must be YAML or JSON.");
    const content = await this.fs.readFile(file, "utf8");
    const flow = parseFlowDocument(content, { format: extension === ".json" ? "json" : "yaml", source: relative(root, file) });
    const { contentHash } = identifyFlowDocument(flow);
    const record = { schemaVersion: "v1", sourceId: source.id, flowId: flow.id, path: relative(root, file), contentHash, validatedAt: this.now(), status: "pending" };
    await this.writeJson(join(this.stateDir, "sources", source.id, "pending", `${flow.id}.json`), record);
    if (source.mode === "local") {
      const backup = join(this.stateDir, "sources", source.id, "backups", flow.id, `${contentHash}${extension === ".json" ? ".json" : ".yaml"}`);
      await this.writeOnce(backup, content);
    }
    return record;
  }

  async writeJson(path, value) {
    return this.write(path, `${JSON.stringify(value, null, 2)}\n`, false);
  }

  async writeOnce(path, content) {
    return this.write(path, content, true);
  }

  async write(path, content, keepExisting) {
    await this.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (keepExisting) {
      try {
        await this.fs.writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      return;
    }
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await this.fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await this.fs.rename(temporary, path);
  }
}
