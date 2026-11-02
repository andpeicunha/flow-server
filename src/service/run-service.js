import { randomUUID } from "node:crypto";
import { FlowError } from "../core/errors.js";
import { transitionRun } from "../core/lifecycle.js";
import { isRfc3339DateTime } from "../core/date-time.js";
import { planFlowNext } from "./flow-scheduler.js";

const publicRun = ({ workspace, flowDefinition, retry, ...run }) => run;

function predecessorsOf(flow, nodeId) {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const found = new Set();
  const visit = (id) => {
    const node = byId.get(id);
    for (const parent of [...(node?.after ?? node?.dependsOn ?? []), ...(node?.when?.step ? [node.when.step] : [])]) {
      if (found.has(parent)) continue;
      found.add(parent);
      visit(parent);
    }
  };
  visit(nodeId);
  return [...found].sort();
}

export class RunService {
  constructor({ stateStore, flowResolver, now = () => new Date().toISOString(), createId = () => `run_${randomUUID()}` } = {}) {
    this.stateStore = stateStore;
    this.now = now;
    this.createId = createId;
    this.flowResolver = flowResolver;
    this.runLocks = new Map();
  }

  async lockRun(id, operation) {
    const previous = this.runLocks.get(id) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.runLocks.set(id, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.runLocks.get(id) === current) this.runLocks.delete(id);
    }
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

  async retryContext(id, nodeId) {
    const run = await this.stateStore.readRun(id).catch((error) => {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    });
    const node = run.flowDefinition?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new FlowError("NODE_NOT_FOUND", "The node is not in the pinned flow definition.");
    const receipts = await this.stateStore.listReceipts(id);
    const predecessors = predecessorsOf(run.flowDefinition, nodeId);
    return {
      runId: id, nodeId, runStatus: run.status, workspace: run.workspace,
      failedReceipt: receipts.find((item) => item.nodeId === nodeId),
      predecessors: predecessors.map((parent) => ({ nodeId: parent, receipt: receipts.find((item) => item.nodeId === parent) ?? null })),
      otherFailures: receipts.filter((item) => item.status === "failed" && item.nodeId !== nodeId).map((item) => item.nodeId),
      retryPending: run.retry?.nodeId === nodeId,
      history: (await this.stateStore.listArchivedReceipts(id)).filter((item) => item.nodeId === nodeId)
    };
  }

  retryNode(id, review) { return this.lockRun(id, () => this.retryNodeUnlocked(id, review ?? {})); }

  async retryNodeUnlocked(id, { nodeId, failedRecordedAt, workspace, reviewedNodeIds, worktreeReview, reason } = {}) {
    const run = await this.stateStore.readRun(id);
    if (run.status !== "running" && !(run.status === "blocked" && ["DEPENDENCY_FAILED", "NODE_FAILED"].includes(run.block?.reason))) throw new FlowError("RETRY_RUN_NOT_RUNNING", "Only a running run or one blocked by a failed node can retry. Resume a paused run first; terminal runs cannot retry.");
    if (run.retry) throw new FlowError("RETRY_ALREADY_PENDING", "Complete the pending node retry before requesting another.");
    const node = run.flowDefinition?.nodes?.find((item) => item.id === nodeId);
    if (!node) throw new FlowError("NODE_NOT_FOUND", "The node is not in the pinned flow definition.");
    const receipts = await this.stateStore.listReceipts(id);
    const failed = receipts.find((item) => item.nodeId === nodeId);
    if (failed?.status !== "failed") throw new FlowError("RETRY_NODE_NOT_FAILED", "Only a node with a failed receipt can be retried.");
    if (failedRecordedAt !== failed.recordedAt) throw new FlowError("RETRY_RECEIPT_CHANGED", "The failed receipt changed. Inspect it again before retrying.");
    if (workspace !== run.workspace || typeof workspace !== "string") throw new FlowError("RETRY_WORKSPACE_MISMATCH", "The retry must use the run's pinned workspace.");
    const predecessors = predecessorsOf(run.flowDefinition, nodeId);
    const expected = new Set(predecessors);
    const reviewed = Array.isArray(reviewedNodeIds) && reviewedNodeIds.every((item) => typeof item === "string") ? new Set(reviewedNodeIds) : undefined;
    if (!reviewed || reviewed.size !== reviewedNodeIds.length || reviewed.size !== expected.size || [...expected].some((item) => !reviewed.has(item))) {
      throw new FlowError("RETRY_REVIEW_INCOMPLETE", "Review every predecessor receipt before retrying the failed node.");
    }
    if (predecessors.some((parent) => !["completed", "skipped"].includes(receipts.find((item) => item.nodeId === parent)?.status)) ||
      receipts.some((item) => item.status === "failed" && item.nodeId !== nodeId)) {
      throw new FlowError("RETRY_PREDECESSOR_UNSAFE", "A predecessor or another node is failed or missing. Resolve the inconsistency before retrying.");
    }
    if (typeof worktreeReview !== "string" || !worktreeReview.trim() || worktreeReview.length > 2000 ||
      typeof reason !== "string" || !reason.trim() || reason.length > 2000) {
      throw new FlowError("RETRY_REVIEW_INCOMPLETE", "Describe the current worktree evidence and why this node needs a retry.");
    }
    const attempt = failed.attempt ?? 1;
    if (attempt > (node.retry ?? 3)) throw new FlowError("RETRY_LIMIT_REACHED", "This node has reached its configured retry limit.");
    const retryDecision = { reason, worktreeReview, reviewedNodeIds: predecessors, requestedAt: this.now() };
    const archivedDecision = await this.stateStore.archiveFailedReceipt(failed, retryDecision);
    run.retry = { nodeId, attempt: attempt + 1, ...archivedDecision };
    if (run.status === "blocked") {
      run.blockHistory = [...(run.blockHistory ?? []), { ...run.block, resolution: reason, resolvedAt: this.now() }];
      delete run.block;
      run.status = transitionRun(run.status, "continue");
    }
    await this.stateStore.writeRun(run);
    return { runId: id, nodeId, attempt: run.retry.attempt, status: "ready_for_retry" };
  }

  async create({ flowId, profileId, workspace, runtime, executionMode, task, flowSourceId, flowContentHash, flowGitCommit }) {
    const resolved = this.flowResolver ? await this.flowResolver({ flowId, profileId, workspace, runtime }) : {};
    const selectedRuntime = resolved.runtime ?? runtime;
    if (!["codex", "claude"].includes(selectedRuntime)) throw new FlowError("INVALID_RUN_REQUEST", "A configured or requested runtime is required.");
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
      runtime: selectedRuntime,
      executionMode,
      status: "created",
      createdAt: this.now()
    };
    await this.stateStore.writeRun(run);
    return publicRun(run);
  }

  transition(id, action) { return this.lockRun(id, () => this.transitionUnlocked(id, action)); }

  block(id, details) { return this.lockRun(id, () => this.blockUnlocked(id, details)); }

  async blockUnlocked(id, { nodeId, reason } = {}) {
    const run = await this.stateStore.readRun(id);
    if (run.status !== "running") throw new FlowError("RUN_NOT_RUNNING", "Only a running run can be blocked.");
    if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) throw new FlowError("INVALID_BLOCK", "Give a short reason for the block.");
    if (typeof nodeId !== "string" || !run.flowDefinition?.nodes?.some((node) => node.id === nodeId)) throw new FlowError("INVALID_BLOCK", "Name the pending node in this run.");
    const receipts = await this.stateStore.listReceipts(id);
    if (receipts.some((receipt) => receipt.nodeId === nodeId)) throw new FlowError("INVALID_BLOCK", "The pending node already has a receipt. Use the failed-node retry path if it failed.");
    const planned = planFlowNext(run.flowDefinition, run, receipts);
    if (planned.status !== "ready" || !planned.nodes.some((node) => node.id === nodeId)) throw new FlowError("BLOCK_NODE_NOT_READY", "Only a ready pending node can be blocked.");
    run.status = transitionRun(run.status, "block");
    run.block = { nodeId, reason: reason.trim(), recordedAt: this.now() };
    await this.stateStore.writeRun(run);
    return publicRun(run);
  }

  continueRun(id, resolution) { return this.lockRun(id, () => this.continueRunUnlocked(id, resolution)); }

  async continueRunUnlocked(id, { reason, workspace, worktreeReview, reviewedPredecessors } = {}) {
    const run = await this.stateStore.readRun(id);
    if (run.status !== "blocked" || !run.block) throw new FlowError("RUN_NOT_BLOCKED", "This run has no open block.");
    if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) throw new FlowError("INVALID_RESOLUTION", "Describe what fixed the block before continuing.");
    const receipts = await this.stateStore.listReceipts(id);
    const failures = receipts.filter((receipt) => receipt.status === "failed");
    if (failures.length) {
      if (reviewedPredecessors !== true || typeof worktreeReview !== "string" || !worktreeReview.trim() || worktreeReview.length > 2000) {
        throw new FlowError("CONTINUE_REVIEW_REQUIRED", "Review the pinned worktree and completed predecessors before continuing a failed node.");
      }
      const failed = failures[0];
      await this.retryNodeUnlocked(id, {
        nodeId: failed.nodeId, failedRecordedAt: failed.recordedAt, workspace,
        reviewedNodeIds: predecessorsOf(run.flowDefinition, failed.nodeId),
        worktreeReview, reason: reason.trim()
      });
      const resumed = await this.stateStore.readRun(id);
      const plannedRetry = planFlowNext(resumed.flowDefinition, resumed, receipts.filter((receipt) => receipt.nodeId !== failed.nodeId));
      if (plannedRetry.status !== "ready") throw new FlowError("BLOCK_NOT_RESOLVED", "The failed node is still not ready after the retry review.");
      return { ...publicRun(resumed), next: this.readyNodesWithAttempt(plannedRetry.nodes, resumed) };
    }
    const planned = planFlowNext(run.flowDefinition, run, receipts);
    if (planned.status === "blocked") throw new FlowError("BLOCK_NOT_RESOLVED", `The flow is still blocked: ${planned.reason}.`);
    if (planned.status === "stopped") throw new FlowError("RUN_STOP_RULE", "A stop rule applies. Inspect the run before continuing.");
    if (run.block.nodeId && planned.status === "ready" && !planned.nodes.some((node) => node.id === run.block.nodeId)) {
      throw new FlowError("BLOCK_NODE_NOT_READY", "The pending node is not ready. Inspect its dependencies before continuing.");
    }
    run.blockHistory = [...(run.blockHistory ?? []), { ...run.block, resolution: reason.trim(), resolvedAt: this.now() }];
    delete run.block;
    run.status = transitionRun(run.status, "continue");
    await this.stateStore.writeRun(run);
    return { ...publicRun(run), next: planned.status === "ready" ? planned.nodes : [] };
  }

  readyNodesWithAttempt(nodes, run) {
    return nodes.map((node) => run.retry?.nodeId === node.id ? { ...node, attempt: run.retry.attempt } : node);
  }

  async transitionUnlocked(id, action) {
    if (["block", "continue"].includes(action)) throw new FlowError("INVALID_LIFECYCLE_TRANSITION", "Use flow_block or flow_continue with a reason.");
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

  checkpoint(id, receipt) { return this.lockRun(id, () => this.checkpointUnlocked(id, receipt)); }

  async checkpointUnlocked(id, receipt) {
    const run = await this.stateStore.readRun(id).catch((error) => {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    });
    if (["stopped", "completed", "failed"].includes(run.status)) {
      throw new FlowError("RUN_NOT_ACTIVE", "Cannot checkpoint a terminal run.");
    }
    if (run.status === "paused") throw new FlowError("RUN_PAUSED", "Resume the run before checkpointing a node.");
    if (run.status === "blocked") throw new FlowError("RUN_BLOCKED", `Resolve the block before checkpointing: ${run.block?.reason ?? "unknown reason"}`);
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new FlowError("INVALID_RECEIPT", "Receipt must be a JSON object.");
    if (receipt.runId !== id) throw new FlowError("INVALID_RECEIPT", "Receipt runId does not match the target run.");
    if (run.retry && (receipt.nodeId !== run.retry.nodeId || receipt.attempt !== run.retry.attempt)) {
      throw new FlowError("RETRY_ATTEMPT_REQUIRED", "Checkpoint the pending retry node with its required attempt number first.");
    }
    if (run.flowDefinition?.nodes) {
      if (receipt.status === "skipped") throw new FlowError("SCHEDULER_OWNS_SKIPS", "Conditional skips are recorded by flow_next, not by node agents.");
      const planned = await this.planNextForRun(run);
      if (planned.result.status !== "ready" || !planned.result.nodes.some((node) => node.id === receipt.nodeId)) {
        throw new FlowError("NODE_NOT_READY", "The node is not ready under the pinned flow dependencies, conditions, and stop rules.");
      }
      const node = run.flowDefinition.nodes.find((item) => item.id === receipt.nodeId);
      if (receipt.status === "completed" && node?.model) {
        const expectedModel = node.model;
        const actualModel = receipt.model;
        const modelMatches = actualModel === expectedModel || actualModel === expectedModel.split("/").at(-1);
        if (!modelMatches) throw new FlowError("NODE_MODEL_MISMATCH", "A completed node must record its configured model in the receipt.");
        const expectedEffort = node.effort ?? node.variant;
        if (expectedEffort && receipt.effort !== expectedEffort) throw new FlowError("NODE_EFFORT_MISMATCH", "A completed node must record its configured effort in the receipt.");
      }
    }
    this.validateReceiptEvidence(receipt);
    await this.stateStore.writeReceipt(receipt);
    const hadRetry = Boolean(run.retry);
    if (hadRetry) {
      delete run.retry;
    }
    if (receipt.status === "failed") {
      run.status = transitionRun(run.status, "block");
      const details = typeof receipt.summary === "string" && receipt.summary.trim() ? receipt.summary.trim()
        : typeof receipt.output?.reason === "string" && receipt.output.reason.trim() ? receipt.output.reason.trim() : undefined;
      run.block = { reason: "NODE_FAILED", nodeId: receipt.nodeId, recordedAt: this.now(), ...(details ? { details: details.slice(0, 2000) } : {}) };
    }
    if (receipt.status === "failed" || hadRetry) await this.stateStore.writeRun(run);
    return publicRun(run);
  }

  validateReceiptEvidence(receipt) {
    const allowed = new Set(["schemaVersion", "runId", "nodeId", "status", "recordedAt", "summary", "output", "redactions", "attempt", "durationMs", "agent", "model", "effort", "tokenUsage", "skills", "validation", "signals"]);
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
    if (receipt.tokenUsage !== undefined) {
      const usage = receipt.tokenUsage;
      const valid = usage && typeof usage === "object" && !Array.isArray(usage)
        && Object.keys(usage).length === 2
        && Object.keys(usage).every((key) => ["inputTokens", "outputTokens"].includes(key))
        && [usage.inputTokens, usage.outputTokens].every((value) => Number.isInteger(value) && value >= 0 && value <= 1_000_000_000);
      if (!valid) throw new FlowError("INVALID_RECEIPT", "Receipt tokenUsage is invalid.");
    }
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

  next(id) { return this.lockRun(id, () => this.nextUnlocked(id)); }

  async nextUnlocked(id) {
    let run = await this.stateStore.readRun(id).catch((error) => {
      if (error.code === "ENOENT") throw new FlowError("RUN_NOT_FOUND", "The requested run does not exist.");
      throw error;
    });
    if (run.status === "completed") return { status: "done", nodes: [] };
    if (["stopped", "failed"].includes(run.status)) return { status: "blocked", reason: "RUN_TERMINAL", runStatus: run.status, ...(run.stop ? { stop: run.stop } : {}) };
    if (run.status === "paused") return { status: "blocked", reason: "RUN_PAUSED", runStatus: run.status };
    if (run.status === "blocked") return { status: "blocked", reason: run.block?.reason ?? "RUN_BLOCKED", nodeId: run.block?.nodeId, ...(run.block?.details ? { details: run.block.details } : {}), runStatus: run.status, action: "Resolve the issue, then call flow_continue." };
    if (run.status === "created") {
      run = { ...run, status: transitionRun(run.status, "start") };
      await this.stateStore.writeRun(run);
    }
    if (run.retry) {
      const current = (await this.stateStore.listReceipts(id)).find((item) => item.nodeId === run.retry.nodeId);
      if (current && current.status !== "failed" && current.attempt === run.retry.attempt) {
        delete run.retry;
        await this.stateStore.writeRun(run);
      }
    }
    if (!run.flowDefinition?.nodes) throw new FlowError("FLOW_DEFINITION_NOT_FOUND", "This run has no pinned flow definition.");
    const { result, skippedNodeIds } = await this.planNextForRun(run);
    if (result.status === "stopped") {
      run = { ...run, status: transitionRun(run.status, "stop") };
      run.stop = result.stop;
      await this.stateStore.writeRun(run);
    } else if (result.status === "blocked") {
      run = { ...run, status: transitionRun(run.status, "block"), block: { reason: result.reason, ...(result.nodeId ? { nodeId: result.nodeId } : {}), recordedAt: this.now() } };
      await this.stateStore.writeRun(run);
    } else if (result.status === "done") {
      run = { ...run, status: transitionRun(run.status, "complete") };
      await this.stateStore.writeRun(run);
    }
    return { ...result, ...(result.status === "ready" ? { nodes: this.readyNodesWithAttempt(result.nodes, run) } : {}), ...(skippedNodeIds.length ? { skipped: skippedNodeIds } : {}) };
  }

  async planNextForRun(run) {
    const stored = await this.stateStore.listReceipts(run.id);
    const receipts = run.retry && stored.some((item) => item.nodeId === run.retry.nodeId && item.status === "failed")
      ? stored.filter((item) => item.nodeId !== run.retry.nodeId) : stored;
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
    const allStored = skippedNodeIds.length ? await this.stateStore.listReceipts(run.id) : receipts;
    const allReceipts = run.retry && allStored.some((item) => item.nodeId === run.retry.nodeId && item.status === "failed")
      ? allStored.filter((item) => item.nodeId !== run.retry.nodeId) : allStored;
    const result = skippedNodeIds.length ? planFlowNext(run.flowDefinition, run, allReceipts) : planned;
    return { result, skippedNodeIds };
  }

  async audit(id) {
    await this.get(id);
    const run = await this.stateStore.readRun(id);
    const receipts = await this.stateStore.listReceipts(id);
    const retryHistory = this.stateStore.listArchivedReceipts ? await this.stateStore.listArchivedReceipts(id) : [];
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
    if (run.status === "blocked") findings.push({ code: "RUN_BLOCKED", ...(run.block?.nodeId ? { nodeId: run.block.nodeId } : {}), reason: run.block?.reason });
    if (!["completed", "failed", "stopped"].includes(run.status)) findings.push({ code: "RUN_INCOMPLETE" });
    const result = run.status === "failed" || receipts.some((receipt) => receipt.status === "failed") ? "failed"
      : run.status === "completed" && run.flowDefinition?.nodes && findings.length === 0 ? "passed" : "incomplete";
    return { schemaVersion: "v1", runId: id, result, findings,
      ...(run.blockHistory?.length ? { blockHistory: run.blockHistory } : {}),
      ...(retryHistory.length ? { retryHistory: retryHistory.map((receipt) => ({ nodeId: receipt.nodeId, attempt: receipt.attempt ?? 1, status: receipt.status, recordedAt: receipt.recordedAt, reason: receipt.retryDecision?.reason, reviewedNodeIds: receipt.retryDecision?.reviewedNodeIds })) } : {}) };
  }
}
