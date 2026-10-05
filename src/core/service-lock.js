import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FlowError } from "./errors.js";

const lockName = "service.lock";
const ownerName = "owner.json";

function ownerPath(stateDir) {
  return join(stateDir, lockName, ownerName);
}

function lockPath(stateDir) {
  return join(stateDir, lockName);
}

export class ServiceLock {
  constructor(stateDir, {
    fs = { mkdir, readFile, rename, rm, writeFile },
    now = () => new Date().toISOString(),
    processId = process.pid,
    instanceId = () => randomUUID(),
    isProcessAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error.code === "EPERM";
      }
    },
    isServiceHealthy = async () => false
  } = {}) {
    this.stateDir = stateDir;
    this.fs = fs;
    this.now = now;
    this.processId = processId;
    this.instanceId = instanceId;
    this.isProcessAlive = isProcessAlive;
    this.isServiceHealthy = isServiceHealthy;
    this.owner = undefined;
  }

  async acquire({ endpoint } = {}) {
    const directory = lockPath(this.stateDir);
    const owner = {
      pid: this.processId,
      instanceId: this.instanceId(),
      startedAt: this.now(),
      endpoint
    };

    try {
      await this.create(directory, owner);
      this.owner = owner;
      return owner;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    const existing = await this.readOwner();
    if (await this.belongsToHealthyService(existing)) {
      throw new FlowError("SERVICE_ALREADY_RUNNING", "A healthy flow-service already owns the state directory.");
    }
    if (existing?.pid && this.isProcessAlive(existing.pid)) {
      throw new FlowError("SERVICE_LOCK_BUSY", "The existing service lock belongs to a live process and will not be removed automatically.");
    }

    await this.quarantineStale(directory);
    await this.create(directory, owner);
    this.owner = owner;
    return owner;
  }

  async release() {
    if (!this.owner) return false;
    const existing = await this.readOwner();
    if (!existing || existing.instanceId !== this.owner.instanceId) {
      this.owner = undefined;
      return false;
    }
    await this.fs.rm(lockPath(this.stateDir), { recursive: true, force: false });
    this.owner = undefined;
    return true;
  }

  async create(directory, owner) {
    await this.fs.mkdir(directory, { recursive: false, mode: 0o700 });
    try {
      await this.fs.writeFile(join(directory, ownerName), `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      await this.fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async readOwner() {
    try {
      const content = await this.fs.readFile(ownerPath(this.stateDir), "utf8");
      const owner = JSON.parse(content);
      return Number.isInteger(owner.pid) && typeof owner.instanceId === "string" ? owner : undefined;
    } catch (error) {
      if (["ENOENT", "EISDIR"].includes(error.code) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async belongsToHealthyService(owner) {
    if (!owner?.endpoint) return false;
    try {
      return await this.isServiceHealthy(owner.endpoint, owner);
    } catch {
      return false;
    }
  }

  async quarantineStale(directory) {
    const stalePath = `${directory}.stale-${this.instanceId()}`;
    try {
      await this.fs.rename(directory, stalePath);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await this.fs.rm(stalePath, { recursive: true, force: true });
  }
}
