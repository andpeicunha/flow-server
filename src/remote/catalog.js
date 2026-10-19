import { createHash, randomUUID } from "node:crypto";
import { FlowError } from "../core/errors.js";

const flowIdPattern = /^[a-z][a-z0-9-]{0,62}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const identifierPattern = /^[a-z][a-z0-9-]{0,127}$/;
const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const statuses = new Set(["completed", "failed", "blocked", "skipped"]);
const proposalKinds = new Set(["flow-gap", "node-reliability", "validation-gap"]);
const prohibitedKeys = new Set(["prompt", "workspace", "path", "file", "body", "token", "secret", "output"]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(definition) {
  return createHash("sha256").update(stableJson(definition)).digest("hex");
}

function fail(code, message) {
  throw new FlowError(code, message);
}

function assertObject(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, message);
}

function assertAllowedKeys(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || prohibitedKeys.has(key.toLowerCase())) fail(code, "The request includes an unsupported field.");
  }
}

function assertIdentifier(value, code, field) {
  if (typeof value !== "string" || !identifierPattern.test(value)) fail(code, `${field} is invalid.`);
}

function safeCounterMap(value) {
  assertObject(value, "REMOTE_EVIDENCE_INVALID", "Counters must be an object.");
  if (Object.keys(value).length > 20) fail("REMOTE_EVIDENCE_TOO_LARGE", "Too many counters.");
  for (const [key, count] of Object.entries(value)) {
    assertIdentifier(key, "REMOTE_EVIDENCE_INVALID", "Counter name");
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) fail("REMOTE_EVIDENCE_INVALID", "Counter value is invalid.");
  }
  return Object.freeze({ ...value });
}

function releaseKey(flowId, version) {
  return `${flowId}@${version}`;
}

function publicRelease(release) {
  return Object.freeze({ flowId: release.flowId, version: release.version, title: release.title, summary: release.summary, tags: release.tags, contentHash: release.contentHash });
}

export class RemoteFlowCatalog {
  constructor({ releases = [], createId = () => randomUUID(), now = () => new Date().toISOString(), minimumEvidence = 2 } = {}) {
    this.createId = createId;
    this.now = now;
    this.minimumEvidence = minimumEvidence;
    this.releases = new Map();
    this.evidence = new Map();
    this.evidenceByRelease = new Map();
    this.eventIds = new Set();
    this.nodeStatuses = new Map();
    this.analyses = new Map();
    this.proposals = new Map();
    for (const release of releases) this.addRelease(release);
  }

  addRelease(value) {
    assertObject(value, "REMOTE_RELEASE_INVALID", "A release must be an object.");
    const { flowId, version, title, summary, tags = [], definition, approved } = value;
    if (!flowIdPattern.test(flowId) || !versionPattern.test(version) || typeof title !== "string" || typeof summary !== "string" || !Array.isArray(tags) || approved !== true) {
      fail("REMOTE_RELEASE_INVALID", "The release is invalid or unapproved.");
    }
    if (title.length > 160 || summary.length > 500 || tags.some((tag) => typeof tag !== "string" || !identifierPattern.test(tag))) fail("REMOTE_RELEASE_INVALID", "The release metadata is invalid.");
    assertObject(definition, "REMOTE_RELEASE_INVALID", "The flow definition is invalid.");
    const key = releaseKey(flowId, version);
    if (this.releases.has(key)) fail("REMOTE_RELEASE_EXISTS", "This release already exists.");
    const item = Object.freeze({ flowId, version, title, summary, tags: Object.freeze([...tags]), definition: Object.freeze(structuredClone(definition)), contentHash: contentHash(definition) });
    this.releases.set(key, item);
    return publicRelease(item);
  }

  recommend({ taskSummary, tags = [] } = {}) {
    if (typeof taskSummary !== "string" || !taskSummary.trim() || taskSummary.length > 500 || !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !identifierPattern.test(tag))) {
      fail("REMOTE_RECOMMENDATION_INVALID", "The task summary or tags are invalid.");
    }
    const words = new Set(taskSummary.toLowerCase().match(/[a-z0-9-]+/g) || []);
    return [...this.releases.values()]
      .map((release) => ({ release, score: release.tags.filter((tag) => tags.includes(tag) || words.has(tag)).length }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.release.flowId.localeCompare(right.release.flowId))
      .map(({ release }) => ({ flowId: release.flowId, version: release.version, title: release.title, summary: release.summary, reason: "Matched approved task tags." }));
  }

  getDefinition(flowId, version) {
    const release = this.releases.get(releaseKey(flowId, version));
    if (!release) fail("REMOTE_RELEASE_NOT_FOUND", "The approved flow release was not found.");
    return Object.freeze({ ...publicRelease(release), definition: structuredClone(release.definition) });
  }

  recordEvidence(value) {
    assertObject(value, "REMOTE_EVIDENCE_INVALID", "Evidence must be an object.");
    assertAllowedKeys(value, new Set(["flowId", "version", "eventId", "runId", "nodeId", "status", "durationMs", "errorCode", "counters"]), "REMOTE_EVIDENCE_INVALID");
    const { flowId, version, eventId, runId, nodeId, status, durationMs, errorCode, counters = {} } = value;
    if (!this.releases.has(releaseKey(flowId, version))) fail("REMOTE_RELEASE_NOT_FOUND", "The approved flow release was not found.");
    assertIdentifier(eventId, "REMOTE_EVIDENCE_INVALID", "Event ID");
    assertIdentifier(runId, "REMOTE_EVIDENCE_INVALID", "Run ID");
    assertIdentifier(nodeId, "REMOTE_EVIDENCE_INVALID", "Node ID");
    if (!statuses.has(status) || !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 86_400_000) fail("REMOTE_EVIDENCE_INVALID", "Evidence status or duration is invalid.");
    if (errorCode !== undefined && (typeof errorCode !== "string" || !safeErrorCodePattern.test(errorCode))) fail("REMOTE_EVIDENCE_INVALID", "The error code is invalid.");
    if (this.eventIds.has(eventId)) fail("REMOTE_EVIDENCE_DUPLICATE", "This event was already recorded.");
    const nodeKey = `${releaseKey(flowId, version)}/${runId}/${nodeId}`;
    if (this.nodeStatuses.has(nodeKey)) fail("REMOTE_EVIDENCE_INVALID", "The node already has a terminal status.");
    const item = Object.freeze({ id: `evidence_${this.createId()}`, flowId, version, eventId, runId, nodeId, status, durationMs, ...(errorCode ? { errorCode } : {}), counters: safeCounterMap(counters), recordedAt: this.now() });
    this.eventIds.add(eventId);
    this.nodeStatuses.set(nodeKey, status);
    this.evidence.set(item.id, item);
    const key = releaseKey(flowId, version);
    this.evidenceByRelease.set(key, [...(this.evidenceByRelease.get(key) || []), item.id]);
    return { id: item.id, recordedAt: item.recordedAt };
  }

  listRuns(flowId, version) {
    if (!this.releases.has(releaseKey(flowId, version))) fail("REMOTE_RELEASE_NOT_FOUND", "The approved flow release was not found.");
    const records = (this.evidenceByRelease.get(releaseKey(flowId, version)) || []).map((id) => this.evidence.get(id));
    return [...new Map(records.map((record) => [record.runId, record])).values()].map(({ runId, status, durationMs }) => ({ runId, status, durationMs }));
  }

  getEvidence(flowId, version, runId) {
    if (!this.releases.has(releaseKey(flowId, version))) fail("REMOTE_RELEASE_NOT_FOUND", "The approved flow release was not found.");
    assertIdentifier(runId, "REMOTE_EVIDENCE_INVALID", "Run ID");
    return (this.evidenceByRelease.get(releaseKey(flowId, version)) || []).map((id) => this.evidence.get(id)).filter((item) => item.runId === runId);
  }

  analyze(flowId, version) {
    if (!this.releases.has(releaseKey(flowId, version))) fail("REMOTE_RELEASE_NOT_FOUND", "The approved flow release was not found.");
    const all = (this.evidenceByRelease.get(releaseKey(flowId, version)) || []).map((id) => this.evidence.get(id));
    if (all.length < this.minimumEvidence) return { findings: [], evidenceIds: [] };
    const failed = all.filter((item) => item.status === "failed" || item.status === "blocked");
    if (!failed.length) return { findings: [], evidenceIds: all.map((item) => item.id) };
    const analysis = Object.freeze({ id: `analysis_${this.createId()}`, flowId, version, evidenceIds: failed.map((item) => item.id), findings: Object.freeze([{ kind: "node-reliability", message: "Some nodes failed or were blocked. Review their safe error codes and durations." }]), createdAt: this.now() });
    this.analyses.set(analysis.id, analysis);
    return structuredClone(analysis);
  }

  recordProposal({ analysisId, kind }) {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || !proposalKinds.has(kind)) fail("REMOTE_PROPOSAL_INVALID", "The analysis or proposal kind is invalid.");
    const proposal = Object.freeze({ id: `proposal_${this.createId()}`, flowId: analysis.flowId, version: analysis.version, analysisId, evidenceIds: analysis.evidenceIds, kind, status: "pending_review", createdAt: this.now() });
    this.proposals.set(proposal.id, proposal);
    return structuredClone(proposal);
  }
}
