import { randomUUID } from "node:crypto";
import { FlowError } from "../core/errors.js";
import { transitionRun } from "../core/lifecycle.js";

const publicRun = ({ workspace, ...run }) => run;

export class RunService {
  constructor({ stateStore, now = () => new Date().toISOString(), createId = () => `run_${randomUUID()}` } = {}) {
    this.stateStore = stateStore;
    this.now = now;
    this.createId = createId;
  }

  async list({ flowId, runId } = {}) {
    const runs = await this.stateStore.listRuns();
    return runs.filter((run) => (!flowId || run.flowId === flowId) && (!runId || run.id === runId)).map(publicRun);
  }

  async get(id) {
    try {
      return publicRun(await this.stateStore.readRun(id));
    } catch (error) {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    }
  }

  async create({ flowId, workspace, runtime, executionMode }) {
    const run = {
      schemaVersion: "v1",
      id: this.createId(),
      flowId,
      workspace,
      runtime,
      executionMode,
      status: "created",
      createdAt: this.now()
    };
    await this.stateStore.writeRun(run);
    return publicRun(run);
  }

  async transition(id, action) {
    const existing = await this.stateStore.readRun(id).catch((error) => {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    });
    const run = { ...existing, status: transitionRun(existing.status, action) };
    await this.stateStore.writeRun(run);
    return publicRun(run);
  }

  async checkpoint(id, receipt) {
    const run = await this.get(id);
    if (["stopped", "completed", "failed"].includes(run.status)) {
      throw new FlowError("RUN_NOT_ACTIVE", "Cannot checkpoint a terminal run.");
    }
    if (receipt.runId !== id) throw new FlowError("INVALID_RECEIPT", "Receipt runId does not match the target run.");
    await this.stateStore.writeReceipt(receipt);
    return run;
  }

  async audit(id) {
    await this.get(id);
    const receipts = await this.stateStore.listReceipts(id);
    const findings = receipts
      .filter((receipt) => receipt.status === "failed")
      .map((receipt) => ({ code: "NODE_FAILED", nodeId: receipt.nodeId }));
    return { schemaVersion: "v1", runId: id, result: findings.length ? "failed" : "passed", findings };
  }
}
