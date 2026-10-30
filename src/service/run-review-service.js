import { FlowError } from "../core/errors.js";
import { isRfc3339DateTime, rfc3339TimeValue } from "../core/date-time.js";

const flowIdPattern = /^[a-z][a-z0-9-]{0,62}$/;
const profileIdPattern = /^[a-z][a-z0-9-]{0,62}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxReviewNodes = 256;
const maxReviewFindings = 8192;

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function nodeSummary(receipts) {
  const byNode = new Map();
  for (const receipt of receipts) {
    const current = byNode.get(receipt.nodeId) ?? { nodeId: receipt.nodeId, receipts: 0, completed: 0, failed: 0, skipped: 0, retries: 0, durations: [], validationFailures: 0, signals: 0, missingMetrics: 0 };
    current.receipts += 1;
    current[receipt.status] += 1;
    current.retries += Math.max(0, (receipt.attempt ?? 1) - 1);
    if (Number.isInteger(receipt.durationMs)) current.durations.push(receipt.durationMs);
    else current.missingMetrics += 1;
    if (receipt.validation?.result === "failed") current.validationFailures += 1;
    current.signals += receipt.signals?.length ?? 0;
    byNode.set(receipt.nodeId, current);
  }
  return [...byNode.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)).map(({ durations, ...node }) => ({
    ...node,
    successRate: node.receipts ? round(node.completed / node.receipts) : 0,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null
  }));
}

export class RunReviewService {
  constructor({ stateStore, now = () => new Date().toISOString() } = {}) {
    if (!stateStore) throw new TypeError("stateStore is required.");
    this.stateStore = stateStore;
    this.now = now;
  }

  async review(request = {}) {
    const allowed = new Set(["flowId", "profileId", "last", "since", "contentHash", "compareVersions"]);
    if (!request || typeof request !== "object" || Array.isArray(request) || !Object.keys(request).every((key) => allowed.has(key))) throw new FlowError("INVALID_FLOW_REVIEW", "Flow review request contains unsupported fields.");
    const { flowId, profileId, last = 20, since, contentHash, compareVersions = false } = request;
    if (!flowIdPattern.test(flowId ?? "")) throw new FlowError("INVALID_FLOW_REVIEW", "A valid flowId is required.");
    if (profileId !== undefined && !profileIdPattern.test(profileId)) throw new FlowError("INVALID_FLOW_REVIEW", "profileId must be a valid local profile identifier.");
    if (!Number.isInteger(last) || last < 1 || last > 100) throw new FlowError("INVALID_FLOW_REVIEW", "last must be an integer from 1 to 100.");
    if (contentHash !== undefined && !hashPattern.test(contentHash)) throw new FlowError("INVALID_FLOW_REVIEW", "contentHash must be a SHA-256 hash.");
    if (compareVersions !== undefined && typeof compareVersions !== "boolean") throw new FlowError("INVALID_FLOW_REVIEW", "compareVersions must be a boolean.");
    if (since !== undefined && !isRfc3339DateTime(since)) throw new FlowError("INVALID_FLOW_REVIEW", "since must be an RFC 3339 date-time.");
    const sinceTime = since === undefined ? undefined : rfc3339TimeValue(since);

    const matchingRuns = (await this.stateStore.listRuns())
      .filter((run) => run.flowId === flowId)
      .filter((run) => ["stopped", "completed", "failed"].includes(run.status))
      .filter((run) => sinceTime === undefined || rfc3339TimeValue(run.createdAt) >= sinceTime)
      .filter((run) => contentHash === undefined || run.flowContentHash === contentHash);
    const profileIds = [...new Set(matchingRuns.map((run) => run.profileId ?? "core"))];
    if (!profileId && profileIds.length > 1) throw new FlowError("FLOW_PROFILE_REQUIRED", "The flow ID exists in multiple local profiles. Specify profileId to review only one.");
    const resolvedProfileId = profileId ?? profileIds[0];
    let selected = matchingRuns
      .filter((run) => (run.profileId ?? "core") === resolvedProfileId)
      .slice(0, last);
    if (!selected.length) throw new FlowError("FLOW_REVIEW_EVIDENCE_NOT_FOUND", "No matching run evidence was found.");
    if (!compareVersions && contentHash === undefined) {
      const latestHash = selected[0].flowContentHash;
      selected = selected.filter((run) => run.flowContentHash === latestHash);
    }

    const runsWithReceipts = await Promise.all(selected.map(async (run) => {
      const receipts = await this.stateStore.listReceipts(run.id);
      const expected = Array.isArray(run.flowDefinition?.nodes) ? new Set(run.flowDefinition.nodes.map((node) => node.id)) : undefined;
      if (expected?.size > maxReviewNodes) throw new FlowError("FLOW_REVIEW_EVIDENCE_LIMIT", `Flow review supports at most ${maxReviewNodes} expected nodes.`);
      const actual = new Set(receipts.map((receipt) => receipt.nodeId));
      const missingNodeIds = expected ? [...expected].filter((nodeId) => !actual.has(nodeId)).sort() : [];
      const unexpectedNodeIds = expected ? [...actual].filter((nodeId) => !expected.has(nodeId)).sort() : [];
      return { run, receipts, evidence: { runId: run.id, completeness: expected ? (missingNodeIds.length || unexpectedNodeIds.length ? "incomplete" : "complete") : "unknown", missingNodeIds, unexpectedNodeIds } };
    }));
    const groups = new Map();
    for (const item of runsWithReceipts) {
      const key = item.run.flowContentHash ?? "unversioned";
      const group = groups.get(key) ?? { flowContentHash: key, runs: [], receipts: [] };
      group.runs.push(item.run);
      group.receipts.push(...item.receipts);
      groups.set(key, group);
    }
    const versions = [...groups.values()].map((group) => {
      const successfulRuns = group.runs.filter((run) => run.status === "completed").length;
      const runIds = new Set(group.runs.map((run) => run.id));
      const runEvidence = runsWithReceipts.filter((item) => runIds.has(item.run.id)).map((item) => item.evidence);
      const metrics = nodeSummary(group.receipts);
      if (metrics.length > maxReviewNodes) throw new FlowError("FLOW_REVIEW_EVIDENCE_LIMIT", `Flow review supports at most ${maxReviewNodes} distinct nodes.`);
      return {
        flowContentHash: group.flowContentHash,
        runsAnalyzed: group.runs.length,
        runIds: group.runs.map((run) => run.id),
        successRate: round(successfulRuns / group.runs.length),
        receiptsAnalyzed: group.receipts.length,
        missingReceiptRuns: runEvidence.filter((evidence) => evidence.completeness === "incomplete" && evidence.missingNodeIds.length).map((evidence) => evidence.runId),
        runEvidence,
        nodeMetrics: metrics
      };
    });
    const reportedVersions = compareVersions ? versions : versions.slice(0, 1);
    const findings = reportedVersions.flatMap((version) => [
      ...version.nodeMetrics.flatMap((node) => [
        ...(node.failed ? [{ code: "NODE_FAILURES_RECORDED", flowContentHash: version.flowContentHash, nodeId: node.nodeId, count: node.failed }] : []),
        ...(node.retries ? [{ code: "NODE_RETRIES_RECORDED", flowContentHash: version.flowContentHash, nodeId: node.nodeId, count: node.retries }] : []),
        ...(node.signals ? [{ code: "NODE_REVIEW_SIGNALS_RECORDED", flowContentHash: version.flowContentHash, nodeId: node.nodeId, count: node.signals }] : []),
        ...(node.missingMetrics ? [{ code: "NODE_METRICS_MISSING", flowContentHash: version.flowContentHash, nodeId: node.nodeId, count: node.missingMetrics }] : [])
      ]),
      ...version.runEvidence.flatMap((evidence) => [
        ...evidence.missingNodeIds.map((nodeId) => ({ code: "NODE_RECEIPT_MISSING", flowContentHash: version.flowContentHash, nodeId, count: 1 })),
        ...evidence.unexpectedNodeIds.map((nodeId) => ({ code: "UNEXPECTED_NODE_RECEIPT", flowContentHash: version.flowContentHash, nodeId, count: 1 }))
      ])
    ]);
    if (findings.length > maxReviewFindings) throw new FlowError("FLOW_REVIEW_EVIDENCE_LIMIT", `Flow review supports at most ${maxReviewFindings} findings.`);
    const report = {
      schemaVersion: "v1",
      flowId,
      ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
      generatedAt: this.now(),
      anchorRunId: selected[0].id,
      compareVersions: Boolean(compareVersions),
      runsAnalyzed: selected.length,
      runIds: selected.map((run) => run.id),
      versions: reportedVersions,
      findings,
      advisoryOnly: true
    };
    await this.stateStore.writeReview(report.anchorRunId, report);
    return report;
  }
}
