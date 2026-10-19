import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { FlowError } from "../core/errors.js";

const flowIdPattern = /^[a-z][a-z0-9-]{0,62}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const identifierPattern = /^[a-z][a-z0-9-]{0,127}$/;
const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const statuses = new Set(["completed", "failed", "blocked", "skipped"]);
const proposalKinds = new Set(["flow-gap", "node-reliability", "validation-gap"]);
const prohibitedKeys = new Set(["prompt", "workspace", "path", "file", "body", "token", "secret", "output"]);
const stateVersion = 1;
const analysisFindings = Object.freeze([{ kind: "node-reliability", message: "Some nodes failed or were blocked. Review their safe error codes and durations." }]);

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

function assertExactKeys(value, allowed, code, message) {
  assertObject(value, code, message);
  if (Object.keys(value).length !== allowed.size) fail(code, message);
  assertAllowedKeys(value, allowed, code);
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

function safeTimestamp(value, code) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(code, "The stored state is invalid.");
}

function safeStoredId(value, prefix) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[a-z0-9-]{1,128}$`).test(value)) {
    fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
  }
}

export class FileCatalogStateStore {
  constructor({ filePath, fs = { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } } = {}) {
    if (typeof filePath !== "string" || !isAbsolute(filePath) || !filePath.endsWith(".json")) {
      fail("REMOTE_CATALOG_STATE_INVALID", "The catalog state file must be an absolute .json path.");
    }
    this.filePath = resolve(filePath);
    this.fs = fs;
  }

  load() {
    let source;
    try {
      source = this.fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      fail("REMOTE_CATALOG_STATE_INVALID", "The catalog state file cannot be read.");
    }
    try {
      return JSON.parse(source);
    } catch {
      fail("REMOTE_CATALOG_STATE_INVALID", "The catalog state file cannot be read as JSON.");
    }
  }

  save(state) {
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      this.fs.mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      this.fs.writeFileSync(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
      this.fs.renameSync(temporaryPath, this.filePath);
      this.fs.chmodSync(this.filePath, 0o600);
    } catch {
      fail("REMOTE_CATALOG_STATE_WRITE_FAILED", "The catalog state cannot be saved.");
    }
  }
}

export class RemoteFlowCatalog {
  constructor({ releases = [], createId = () => randomUUID(), now = () => new Date().toISOString(), minimumEvidence = 2, stateStore } = {}) {
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
    this.stateStore = stateStore;
    if (stateStore) this.hydrate(stateStore.load());
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
    const item = Object.freeze({ id: `evidence_${this.createId()}`, flowId, version, eventId, runId, nodeId, status, durationMs, ...(errorCode ? { errorCode } : {}), counters: safeCounterMap(counters), recordedAt: this.now() });
    this.assertEvidenceCanBeStored(item);
    this.persist(this.stateDocument({ evidence: [...this.evidence.values(), item] }));
    this.storeEvidence(item);
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
    const analysis = Object.freeze({ id: `analysis_${this.createId()}`, flowId, version, evidenceIds: Object.freeze(failed.map((item) => item.id)), findings: analysisFindings, createdAt: this.now() });
    this.persist(this.stateDocument({ analyses: [...this.analyses.values(), analysis] }));
    this.analyses.set(analysis.id, analysis);
    return structuredClone(analysis);
  }

  recordProposal({ analysisId, kind }) {
    const analysis = this.analyses.get(analysisId);
    if (!analysis || !proposalKinds.has(kind)) fail("REMOTE_PROPOSAL_INVALID", "The analysis or proposal kind is invalid.");
    const proposal = Object.freeze({ id: `proposal_${this.createId()}`, flowId: analysis.flowId, version: analysis.version, analysisId, evidenceIds: analysis.evidenceIds, kind, status: "pending_review", createdAt: this.now() });
    this.persist(this.stateDocument({ proposals: [...this.proposals.values(), proposal] }));
    this.proposals.set(proposal.id, proposal);
    return structuredClone(proposal);
  }

  assertEvidenceCanBeStored(item) {
    if (this.eventIds.has(item.eventId)) fail("REMOTE_EVIDENCE_DUPLICATE", "This event was already recorded.");
    const nodeKey = `${releaseKey(item.flowId, item.version)}/${item.runId}/${item.nodeId}`;
    if (this.nodeStatuses.has(nodeKey)) fail("REMOTE_EVIDENCE_INVALID", "The node already has a terminal status.");
    if (this.evidence.has(item.id)) fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
  }

  storeEvidence(item) {
    this.eventIds.add(item.eventId);
    this.nodeStatuses.set(`${releaseKey(item.flowId, item.version)}/${item.runId}/${item.nodeId}`, item.status);
    this.evidence.set(item.id, item);
    const key = releaseKey(item.flowId, item.version);
    this.evidenceByRelease.set(key, [...(this.evidenceByRelease.get(key) || []), item.id]);
  }

  stateDocument({ evidence = [...this.evidence.values()], analyses = [...this.analyses.values()], proposals = [...this.proposals.values()] } = {}) {
    return { version: stateVersion, evidence: evidence.map((item) => ({ ...item, errorCode: item.errorCode ?? null })), analyses, proposals };
  }

  persist(document) {
    if (this.stateStore) this.stateStore.save(document);
  }

  hydrate(document) {
    if (document === undefined) return;
    assertExactKeys(document, new Set(["version", "evidence", "analyses", "proposals"]), "REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    if (document.version !== stateVersion || !Array.isArray(document.evidence) || !Array.isArray(document.analyses) || !Array.isArray(document.proposals)) {
      fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    }
    for (const item of document.evidence) this.hydrateEvidence(item);
    for (const analysis of document.analyses) this.hydrateAnalysis(analysis);
    for (const proposal of document.proposals) this.hydrateProposal(proposal);
  }

  hydrateEvidence(item) {
    assertExactKeys(item, new Set(["id", "flowId", "version", "eventId", "runId", "nodeId", "status", "durationMs", "errorCode", "counters", "recordedAt"]), "REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    safeStoredId(item.id, "evidence");
    safeTimestamp(item.recordedAt, "REMOTE_CATALOG_STATE_INVALID");
    const { errorCode, ...withoutErrorCode } = item;
    const value = errorCode === null ? withoutErrorCode : { ...withoutErrorCode, errorCode };
    try {
      this.recordEvidenceValidation(value);
    } catch {
      fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    }
    const evidence = Object.freeze({ ...value, counters: safeCounterMap(value.counters) });
    try {
      this.assertEvidenceCanBeStored(evidence);
    } catch {
      fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    }
    this.storeEvidence(evidence);
  }

  recordEvidenceValidation({ flowId, version, eventId, runId, nodeId, status, durationMs, errorCode, counters }) {
    if (!this.releases.has(releaseKey(flowId, version))) fail("REMOTE_RELEASE_NOT_FOUND", "The approved flow release was not found.");
    assertIdentifier(eventId, "REMOTE_EVIDENCE_INVALID", "Event ID");
    assertIdentifier(runId, "REMOTE_EVIDENCE_INVALID", "Run ID");
    assertIdentifier(nodeId, "REMOTE_EVIDENCE_INVALID", "Node ID");
    if (!statuses.has(status) || !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 86_400_000) fail("REMOTE_EVIDENCE_INVALID", "Evidence status or duration is invalid.");
    if (errorCode !== undefined && (typeof errorCode !== "string" || !safeErrorCodePattern.test(errorCode))) fail("REMOTE_EVIDENCE_INVALID", "The error code is invalid.");
    safeCounterMap(counters);
  }

  hydrateAnalysis(analysis) {
    assertExactKeys(analysis, new Set(["id", "flowId", "version", "evidenceIds", "findings", "createdAt"]), "REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    safeStoredId(analysis.id, "analysis");
    safeTimestamp(analysis.createdAt, "REMOTE_CATALOG_STATE_INVALID");
    if (!Array.isArray(analysis.evidenceIds)) fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    const failed = (this.evidenceByRelease.get(releaseKey(analysis.flowId, analysis.version)) || []).map((id) => this.evidence.get(id)).filter((item) => item.status === "failed" || item.status === "blocked");
    const analysisEvidenceIds = failed.slice(0, analysis.evidenceIds.length).map((item) => item.id);
    if (!this.releases.has(releaseKey(analysis.flowId, analysis.version)) || analysis.evidenceIds.length === 0 || JSON.stringify(analysis.evidenceIds) !== JSON.stringify(analysisEvidenceIds) || JSON.stringify(analysis.findings) !== JSON.stringify(analysisFindings) || this.analyses.has(analysis.id)) {
      fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    }
    this.analyses.set(analysis.id, Object.freeze({ ...analysis, evidenceIds: Object.freeze([...analysis.evidenceIds]), findings: analysisFindings }));
  }

  hydrateProposal(proposal) {
    assertExactKeys(proposal, new Set(["id", "flowId", "version", "analysisId", "evidenceIds", "kind", "status", "createdAt"]), "REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    safeStoredId(proposal.id, "proposal");
    safeTimestamp(proposal.createdAt, "REMOTE_CATALOG_STATE_INVALID");
    const analysis = this.analyses.get(proposal.analysisId);
    if (!analysis || !proposalKinds.has(proposal.kind) || proposal.status !== "pending_review" || proposal.flowId !== analysis.flowId || proposal.version !== analysis.version || !Array.isArray(proposal.evidenceIds) || JSON.stringify(proposal.evidenceIds) !== JSON.stringify(analysis.evidenceIds) || this.proposals.has(proposal.id)) {
      fail("REMOTE_CATALOG_STATE_INVALID", "The stored state is invalid.");
    }
    this.proposals.set(proposal.id, Object.freeze({ ...proposal, evidenceIds: Object.freeze([...proposal.evidenceIds]) }));
  }
}
