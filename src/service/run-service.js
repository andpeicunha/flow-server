import { randomUUID } from "node:crypto";
import { FlowError } from "../core/errors.js";
import { transitionRun } from "../core/lifecycle.js";
import { isRfc3339DateTime } from "../core/date-time.js";
import { planFlowNext } from "./flow-scheduler.js";

const publicRun = ({ workspace, flowDefinition, ...run }) => run;

export class RunService {
  constructor({ stateStore, flowResolver, now = () => new Date().toISOString(), createId = () => `run_${randomUUID()}` } = {}) {
    this.stateStore = stateStore;
    this.now = now;
    this.createId = createId;
    this.flowResolver = flowResolver;
  }

  async list({ flowId, profileId, runId } = {}) {
    const runs = await this.stateStore.listRuns();
    return runs.filter((run) => (!flowId || run.flowId === flowId) && (!profileId || run.profileId === profileId) && (!runId || run.id === runId)).map(publicRun);
  }

  async get(id) {
    try {
      return publicRun(await this.stateStore.readRun(id));
    } catch (error) {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    }
  }

  async create({ flowId, profileId, workspace, runtime, executionMode, task, flowSourceId, flowContentHash, flowGitCommit }) {
    const resolved = this.flowResolver ? await this.flowResolver({ flowId, profileId, workspace }) : {};
    const run = {
      schemaVersion: "v1",
      id: this.createId(),
      flowId,
      ...(resolved.profileId || profileId ? { profileId: resolved.profileId ?? profileId } : {}),
      ...(resolved.flowSourceId || flowSourceId ? { flowSourceId: resolved.flowSourceId ?? flowSourceId } : {}),
      ...(resolved.flowContentHash || flowContentHash ? { flowContentHash: resolved.flowContentHash ?? flowContentHash } : {}),
      ...(resolved.flowGitCommit || flowGitCommit ? { flowGitCommit: resolved.flowGitCommit ?? flowGitCommit } : {}),
      ...(resolved.flowDefinition ? { flowDefinition: resolved.flowDefinition } : {}),
      ...(task !== undefined ? { task } : {}),
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
    if (action === "complete" && existing.flowDefinition?.nodes) {
      const planned = await this.planNextForRun(existing);
      if (planned.result.status !== "done") throw new FlowError("RUN_NOT_COMPLETE", "A flow run can complete only after every required node is completed or skipped.");
    }
    const run = { ...existing, status: transitionRun(existing.status, action) };
    await this.stateStore.writeRun(run);
    return publicRun(run);
  }

  async checkpoint(id, receipt) {
    const run = await this.stateStore.readRun(id).catch((error) => {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    });
    if (["stopped", "completed", "failed"].includes(run.status)) {
      throw new FlowError("RUN_NOT_ACTIVE", "Cannot checkpoint a terminal run.");
    }
    if (run.status === "paused") throw new FlowError("RUN_PAUSED", "Resume the run before checkpointing a node.");
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new FlowError("INVALID_RECEIPT", "Receipt must be a JSON object.");
    if (receipt.runId !== id) throw new FlowError("INVALID_RECEIPT", "Receipt runId does not match the target run.");
    if (run.flowDefinition?.nodes) {
      if (receipt.status === "skipped") throw new FlowError("SCHEDULER_OWNS_SKIPS", "Conditional skips are recorded by flow_next, not by node agents.");
      const planned = await this.planNextForRun(run);
      if (planned.result.status !== "ready" || !planned.result.nodes.some((node) => node.id === receipt.nodeId)) {
        throw new FlowError("NODE_NOT_READY", "The node is not ready under the pinned flow dependencies, conditions, and stop rules.");
      }
    }
    this.validateReceiptEvidence(receipt);
    await this.stateStore.writeReceipt(receipt);
    return publicRun(run);
  }

  validateReceiptEvidence(receipt) {
    const allowed = new Set(["schemaVersion", "runId", "nodeId", "status", "recordedAt", "summary", "output", "redactions", "attempt", "durationMs", "agent", "model", "effort", "skills", "validation", "signals"]);
    const validBase = receipt && typeof receipt === "object" && !Array.isArray(receipt)
      && Object.keys(receipt).every((key) => allowed.has(key))
      && receipt.schemaVersion === "v1"
      && typeof receipt.runId === "string" && /^run_[a-z0-9-]{1,63}$/.test(receipt.runId)
      && typeof receipt.nodeId === "string" && /^[a-z][a-z0-9_-]{0,62}$/.test(receipt.nodeId)
      && ["completed", "failed", "skipped"].includes(receipt.status)
      && isRfc3339DateTime(receipt.recordedAt);
    if (!validBase) throw new FlowError("INVALID_RECEIPT", "Receipt does not match the v1 contract.");
    if (receipt.summary !== undefined && (typeof receipt.summary !== "string" || receipt.summary.length > 4000)) throw new FlowError("INVALID_RECEIPT", "Receipt summary is invalid.");
    if (receipt.output !== undefined) {
      let serialized;
      try { serialized = JSON.stringify(receipt.output); } catch { throw new FlowError("INVALID_RECEIPT", "Receipt output must be JSON-safe."); }
      if (serialized === undefined || Buffer.byteLength(serialized) > 64 * 1024) throw new FlowError("INVALID_RECEIPT", "Receipt output must be valid JSON up to 64 KiB.");
    }
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

  async next(id) {
    let run = await this.stateStore.readRun(id).catch((error) => {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    });
    if (run.status === "completed") return { status: "done", nodes: [] };
    if (["stopped", "failed"].includes(run.status)) return { status: "blocked", reason: "RUN_TERMINAL", runStatus: run.status };
    if (run.status === "paused") return { status: "blocked", reason: "RUN_PAUSED", runStatus: run.status };
    if (run.status === "created") {
      run = { ...run, status: transitionRun(run.status, "start") };
      await this.stateStore.writeRun(run);
    }
    if (!run.flowDefinition?.nodes) throw new FlowError("FLOW_DEFINITION_NOT_FOUND", "This run has no pinned flow definition.");
    const { result, skippedNodeIds } = await this.planNextForRun(run);
    if (result.status === "stopped") {
      run = { ...run, status: transitionRun(run.status, "stop") };
      await this.stateStore.writeRun(run);
    } else if (result.status === "done") {
      run = { ...run, status: transitionRun(run.status, "complete") };
      await this.stateStore.writeRun(run);
    }
    return { ...result, ...(skippedNodeIds.length ? { skipped: skippedNodeIds } : {}) };
  }

  async planNextForRun(run) {
    const receipts = await this.stateStore.listReceipts(run.id);
    const planned = planFlowNext(run.flowDefinition, run, receipts);
    const skippedNodeIds = [];
    for (const skipped of planned.skipped ?? []) {
      const node = run.flowDefinition.nodes.find((item) => item.id === skipped.nodeId);
      const receipt = {
        schemaVersion: "v1", runId: run.id, nodeId: skipped.nodeId, status: "skipped", recordedAt: this.now(),
        summary: skipped.summary
      };
      this.validateReceiptEvidence(receipt);
      await this.stateStore.writeReceipt(receipt);
      skippedNodeIds.push(skipped.nodeId);
    }
    const allReceipts = skippedNodeIds.length ? await this.stateStore.listReceipts(run.id) : receipts;
    const result = skippedNodeIds.length ? planFlowNext(run.flowDefinition, run, allReceipts) : planned;
    return { result, skippedNodeIds };
  }

  async audit(id) {
    await this.get(id);
    const run = await this.stateStore.readRun(id);
    const receipts = await this.stateStore.listReceipts(id);
    const findings = receipts
      .filter((receipt) => receipt.status === "failed")
      .map((receipt) => ({ code: "NODE_FAILED", nodeId: receipt.nodeId }));
    if (!run.flowDefinition?.nodes) findings.push({ code: "FLOW_DEFINITION_MISSING" });
    else {
      const recorded = new Set(receipts.map((receipt) => receipt.nodeId));
      for (const node of run.flowDefinition.nodes) {
        if (!recorded.has(node.id)) findings.push({ code: "NODE_EVIDENCE_MISSING", nodeId: node.id });
      }
    }
    if (run.status === "failed") findings.push({ code: "RUN_FAILED" });
    if (run.status === "stopped") findings.push({ code: "RUN_STOPPED" });
    if (!["completed", "failed", "stopped"].includes(run.status)) findings.push({ code: "RUN_INCOMPLETE" });
    const result = run.status === "failed" || receipts.some((receipt) => receipt.status === "failed") ? "failed"
      : run.status === "completed" && run.flowDefinition?.nodes && findings.length === 0 ? "passed" : "incomplete";
    return { schemaVersion: "v1", runId: id, result, findings };
  }
}
