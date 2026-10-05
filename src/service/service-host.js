import { FileStateStore } from "../core/state-store.js";
import { LocalToken } from "../core/local-token.js";
import { ServiceLock } from "../core/service-lock.js";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHttpServer } from "./http-server.js";
import { RunService } from "./run-service.js";

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export class ServiceHost {
  constructor({ stateDir, port = 4729, version = "0.0.0-development", createServer = createHttpServer, createLock = (directory, options) => new ServiceLock(directory, options), createToken = (directory) => new LocalToken(directory), createRunService = (store) => new RunService({ stateStore: store }), fs = { readFile, rename, rm, writeFile } } = {}) {
    if (!stateDir) throw new TypeError("stateDir is required.");
    if (!validPort(port)) throw new TypeError("port must be an integer from 1 to 65535.");
    this.stateDir = stateDir;
    this.port = port;
    this.version = version;
    this.createServer = createServer;
    this.lock = createLock(stateDir);
    this.token = createToken(stateDir);
    this.runService = createRunService(new FileStateStore(stateDir));
    this.fs = fs;
    this.server = undefined;
    this.status = "stopped";
  }

  endpoint() {
    return `http://127.0.0.1:${this.port}`;
  }

  health() {
    return { version: this.version, pid: process.pid, bind: "127.0.0.1", status: this.status === "stopping" ? "stopping" : "ready" };
  }

  async start() {
    if (this.server) return this.health();
    await this.token.loadOrCreate();
    const owner = await this.lock.acquire({ endpoint: this.endpoint() });
    this.status = "starting";
    this.server = this.createServer({
      runService: this.runService,
      token: this.token,
      serviceInfo: () => this.health(),
      onShutdown: async () => { queueMicrotask(() => this.stop()); }
    });
    try {
      await new Promise((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(this.port, "127.0.0.1", () => {
          this.server.off("error", reject);
          resolve();
        });
      });
      this.status = "ready";
      await this.writeMetadata(owner);
      return this.health();
    } catch (error) {
      this.server = undefined;
      this.status = "stopped";
      await this.lock.release();
      throw error;
    }
  }

  async stop() {
    if (!this.server) return false;
    this.status = "stopping";
    const server = this.server;
    this.server = undefined;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await this.removeMetadata();
    await this.lock.release();
    this.status = "stopped";
    return true;
  }

  async writeMetadata(owner) {
    const target = join(this.stateDir, "service.json");
    const temporary = `${target}.${process.pid}.tmp`;
    const content = `${JSON.stringify({ pid: process.pid, instanceId: owner.instanceId, endpoint: this.endpoint(), version: this.version }, null, 2)}\n`;
    await this.fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await this.fs.rename(temporary, target);
  }

  async removeMetadata() {
    const target = join(this.stateDir, "service.json");
    try {
      const metadata = JSON.parse(await this.fs.readFile(target, "utf8"));
      if (metadata.instanceId === this.lock.owner?.instanceId) await this.fs.rm(target, { force: false });
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
}
