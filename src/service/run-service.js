import { randomUUID } from "node:crypto";
import { FlowError } from "../core/errors.js";
import { transitionRun } from "../core/lifecycle.js";
import { isRfc3339DateTime } from "../core/date-time.js";

const publicRun = ({ workspace, flowDefinition, ...run }) => run;

export class RunService {
  constructor({ stateStore, flowResolver, now = () => new Date().toISOString(), createId = () => `run_${randomUUID()}` } = {}) {
    this.stateStore = stateStore;
    this.now = now;
    this.createId = createId;
    this.flowResolver = flowResolver;
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

  async create({ flowId, workspace, runtime, executionMode, flowSourceId, flowContentHash, flowGitCommit }) {
    const resolved = this.flowResolver ? await this.flowResolver(flowId) : {};
    const run = {
      schemaVersion: "v1",
      id: this.createId(),
      flowId,
      ...(resolved.flowSourceId || flowSourceId ? { flowSourceId: resolved.flowSourceId ?? flowSourceId } : {}),
      ...(resolved.flowContentHash || flowContentHash ? { flowContentHash: resolved.flowContentHash ?? flowContentHash } : {}),
      ...(resolved.flowGitCommit || flowGitCommit ? { flowGitCommit: resolved.flowGitCommit ?? flowGitCommit } : {}),
      ...(resolved.flowDefinition ? { flowDefinition: resolved.flowDefinition } : {}),
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
    this.validateReceiptEvidence(receipt);
    await this.stateStore.writeReceipt(receipt);
    return run;
  }

  validateReceiptEvidence(receipt) {
    const allowed = new Set(["schemaVersion", "runId", "nodeId", "status", "recordedAt", "summary", "redactions", "attempt", "durationMs", "agent", "model", "effort", "skills", "validation", "signals"]);
    const validBase = receipt && typeof receipt === "object" && !Array.isArray(receipt)
      && Object.keys(receipt).every((key) => allowed.has(key))
      && receipt.schemaVersion === "v1"
      && typeof receipt.runId === "string" && /^run_[a-z0-9-]{1,63}$/.test(receipt.runId)
      && typeof receipt.nodeId === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(receipt.nodeId)
      && ["completed", "failed", "skipped"].includes(receipt.status)
      && isRfc3339DateTime(receipt.recordedAt);
    if (!validBase) throw new FlowError("INVALID_RECEIPT", "Receipt does not match the v1 contract.");
    if (receipt.summary !== undefined && (typeof receipt.summary !== "string" || receipt.summary.length > 4000)) throw new FlowError("INVALID_RECEIPT", "Receipt summary is invalid.");
    if (receipt.redactions !== undefined && (!Number.isInteger(receipt.redactions) || receipt.redactions < 0)) throw new FlowError("INVALID_RECEIPT", "Receipt redactions is invalid.");
    if (receipt.attempt !== undefined && (!Number.isInteger(receipt.attempt) || receipt.attempt < 1 || receipt.attempt > 100)) throw new FlowError("INVALID_RECEIPT", "Receipt attempt must be from 1 to 100.");
    if (receipt.durationMs !== undefined && (!Number.isInteger(receipt.durationMs) || receipt.durationMs < 0 || receipt.durationMs > 604800000)) throw new FlowError("INVALID_RECEIPT", "Receipt durationMs is invalid.");
    if (receipt.agent !== undefined && (typeof receipt.agent !== "string" || receipt.agent.length > 128)) throw new FlowError("INVALID_RECEIPT", "Receipt agent is invalid.");
    if (receipt.model !== undefined && (typeof receipt.model !== "string" || receipt.model.length > 256)) throw new FlowError("INVALID_RECEIPT", "Receipt model is invalid.");
    if (receipt.effort !== undefined && !["low", "medium", "high", "xhigh", "max", "ultra"].includes(receipt.effort)) throw new FlowError("INVALID_RECEIPT", "Receipt effort is invalid.");
    if (receipt.skills !== undefined && (!Array.isArray(receipt.skills) || receipt.skills.length > 32 || receipt.skills.some((skill) => typeof skill !== "string" || skill.length > 128))) throw new FlowError("INVALID_RECEIPT", "Receipt skills are invalid.");
    if (receipt.validation !== undefined) {
      const valid = receipt.validation && typeof receipt.validation === "object" && !Array.isArray(receipt.validation)
        && Object.keys(receipt.validation).every((key) => ["mode", "result"].includes(key))
        && receipt.validation.mode === "deterministic" && ["passed", "failed", "not-run"].includes(receipt.validation.result);
      if (!valid) throw new FlowError("INVALID_RECEIPT", "Receipt validation is invalid.");
    }
    if (receipt.signals !== undefined) {
      if (!Array.isArray(receipt.signals) || receipt.signals.length > 32) throw new FlowError("INVALID_RECEIPT", "Receipt signals are invalid.");
      for (const signal of receipt.signals) {
        const valid = signal && typeof signal === "object" && !Array.isArray(signal)
          && Object.keys(signal).every((key) => ["severity", "code", "reason", "affectsRun"].includes(key))
          && ["info", "warning", "critical"].includes(signal.severity)
          && typeof signal.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(signal.code)
          && typeof signal.reason === "string" && signal.reason.length >= 1 && signal.reason.length <= 1000
          && signal.affectsRun === false;
        if (!valid) throw new FlowError("INVALID_RECEIPT", "Review signals must be bounded, advisory, and unable to affect the run.");
      }
    }
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
