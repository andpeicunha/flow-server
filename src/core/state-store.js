import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { redact } from "./redaction.js";

function assertRunId(runId) {
  if (!/^run_[a-z0-9-]{1,63}$/.test(runId)) throw new TypeError("Invalid run id.");
}

export class FileStateStore {
  constructor(stateDir, { fs = { link, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile }, redactor = redact } = {}) {
    this.stateDir = stateDir;
    this.fs = fs;
    this.redactor = redactor;
  }

  runDirectory(runId) {
    assertRunId(runId);
    return join(this.stateDir, "runs", runId);
  }

  async writeRun(run) {
    assertRunId(run.id);
    await this.writeJson(join(this.runDirectory(run.id), "run.json"), run);
  }

  async writeReceipt(receipt) {
    assertRunId(receipt.runId);
    if (typeof receipt.nodeId !== "string" || !/^[a-z][a-z0-9_-]{0,62}$/.test(receipt.nodeId)) throw new TypeError("Invalid node id.");
    await this.writeJson(join(this.runDirectory(receipt.runId), `receipt-${receipt.nodeId}.json`), receipt);
  }

  async reportDirectory(runId, { create = false } = {}) {
    const runDirectory = this.runDirectory(runId);
    const runInfo = await this.fs.lstat(runDirectory);
    if (!runInfo.isDirectory() || runInfo.isSymbolicLink()) throw new TypeError("Run dossier must be a real directory.");
    const canonicalRun = await this.fs.realpath(runDirectory);
    const reports = join(canonicalRun, "reports");
    let reportsInfo = await this.fs.lstat(reports).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (!reportsInfo && create) {
      await this.fs.mkdir(reports, { recursive: false, mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
      reportsInfo = await this.fs.lstat(reports);
    }
    if (!reportsInfo) return undefined;
    if (!reportsInfo.isDirectory() || reportsInfo.isSymbolicLink()) throw new TypeError("Run report directory must be a real directory.");
    const canonicalReports = await this.fs.realpath(reports);
    const pathFromRun = relative(canonicalRun, canonicalReports);
    if (pathFromRun !== "reports" || pathFromRun.startsWith(".." + sep) || pathFromRun === "..") throw new TypeError("Run report directory escapes the run dossier.");
    return { canonicalRun, canonicalReports };
  }

  async writeReport(runId, nodeId, report) {
    assertRunId(runId);
    if (typeof nodeId !== "string" || !/^[a-z][a-z0-9_-]{0,62}$/.test(nodeId)) throw new TypeError("Invalid node id.");
    if (!report || typeof report !== "object" || Array.isArray(report)) throw new TypeError("Node report must be a JSON object.");
    const content = JSON.stringify(this.redactor(report), null, 2) + "\n";
    if (Buffer.byteLength(content) > 1024 * 1024) throw new TypeError("Node report exceeds the 1 MiB limit.");
    const { canonicalReports } = await this.reportDirectory(runId, { create: true });
    const target = join(canonicalReports, nodeId + ".json");
    const temporary = target + "." + randomUUID() + ".tmp";
    const digest = createHash("sha256").update(content).digest("hex");
    try {
      await this.fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await this.fs.link(temporary, target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await this.fs.lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new TypeError("Existing node report must be a regular file.");
      const existingBytes = await this.fs.readFile(target);
      if (!existingBytes.equals(Buffer.from(content))) throw new TypeError("A different report already exists for this node.");
    } finally {
      await this.fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
    return { reportPath: "reports/" + nodeId + ".json", reportSha256: digest };
  }

  async readReport(runId, reportPath) {
    assertRunId(runId);
    if (typeof reportPath !== "string" || !/^reports\/[a-z][a-z0-9_-]{0,62}\.json$/.test(reportPath)) throw new TypeError("Invalid run-relative report path.");
    const directories = await this.reportDirectory(runId);
    if (!directories) throw new TypeError("Run report directory is missing.");
    const fileName = reportPath.slice("reports/".length);
    const target = join(directories.canonicalReports, fileName);
    const info = await this.fs.lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new TypeError("Node report is not a bounded regular file.");
    const canonicalTarget = await this.fs.realpath(target);
    const pathFromReports = relative(directories.canonicalReports, canonicalTarget);
    if (pathFromReports !== fileName || pathFromReports.startsWith(".." + sep) || pathFromReports === "..") throw new TypeError("Node report escapes its run directory.");
    const bytes = await this.fs.readFile(canonicalTarget);
    return { report: JSON.parse(bytes.toString("utf8")), reportSha256: createHash("sha256").update(bytes).digest("hex") };
  }

  async verifyReport(runId, reportPath, reportSha256) {
    try {
      const result = await this.readReport(runId, reportPath);
      return result.reportSha256 === reportSha256 ? { valid: true } : { valid: false, code: "REPORT_HASH_MISMATCH" };
    } catch (error) {
      return { valid: false, code: error.code === "ENOENT" ? "REPORT_MISSING" : "REPORT_INVALID" };
    }
  }

  async copyReport(sourceRunId, targetRunId, reportPath, expectedSha256) {
    const source = await this.readReport(sourceRunId, reportPath);
    if (source.reportSha256 !== expectedSha256) throw new TypeError("Source report digest changed.");
    const nodeId = reportPath.slice("reports/".length, -".json".length);
    const target = await this.writeReport(targetRunId, nodeId, source.report);
    if (target.reportSha256 !== expectedSha256) throw new TypeError("Copied report digest changed.");
    return target;
  }

  async removeRun(runId) {
    assertRunId(runId);
    const directory = this.runDirectory(runId);
    const info = await this.fs.lstat(directory).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (!info) return false;
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("Run dossier must be a real directory.");
    const removeContents = async (parent) => {
      const entries = await this.fs.readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        const child = join(parent, entry.name);
        const childInfo = await this.fs.lstat(child);
        if (childInfo.isDirectory() && !childInfo.isSymbolicLink()) {
          await removeContents(child);
          await this.fs.rmdir(child);
        } else await this.fs.unlink(child);
      }
    };
    await removeContents(directory);
    await this.fs.rmdir(directory);
    return true;
  }

  async archiveFailedReceipt(receipt, retryDecision) {
    assertRunId(receipt.runId);
    if (!/^[a-z][a-z0-9_-]{0,62}$/.test(receipt.nodeId) || !["failed", "completed"].includes(receipt.status)) throw new TypeError("Only a failed or completed node receipt can be archived for retry.");
    const attempt = receipt.attempt ?? 1;
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) throw new TypeError("Invalid receipt attempt.");
    const target = join(this.runDirectory(receipt.runId), "attempts", `receipt-${receipt.nodeId}-${attempt}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await this.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const archived = this.redactor({ ...receipt, retryDecision });
    let acceptedDecision = archived.retryDecision;
    try {
      await this.fs.writeFile(temporary, `${JSON.stringify(archived, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await this.fs.link(temporary, target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await this.fs.lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new TypeError("Archived attempt must be a regular file.");
      const existing = await this.readJson(target);
      const { retryDecision: existingDecision, ...existingReceipt } = existing;
      const { retryDecision: proposedDecision, ...proposedReceipt } = archived;
      const withoutTime = ({ requestedAt, ...decision } = {}) => decision;
      if (JSON.stringify(existingReceipt) !== JSON.stringify(proposedReceipt) ||
        JSON.stringify(withoutTime(existingDecision)) !== JSON.stringify(withoutTime(proposedDecision))) {
        throw new TypeError("Archived attempt differs from the current receipt or review.");
      }
      acceptedDecision = existingDecision;
    } finally {
      await this.fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
    return acceptedDecision;
  }

  async listArchivedReceipts(runId) {
    const directory = join(this.runDirectory(runId), "attempts");
    try {
      const entries = await this.fs.readdir(directory, { withFileTypes: true });
      return (await Promise.all(entries
        .filter((entry) => entry.isFile() && /^receipt-[a-z][a-z0-9_-]{0,62}-\d{1,3}\.json$/.test(entry.name))
        .map((entry) => this.readJson(join(directory, entry.name)))))
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId) || (a.attempt ?? 1) - (b.attempt ?? 1));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeReview(runId, report) {
    assertRunId(runId);
    const runDirectory = this.runDirectory(runId);
    const canonicalRun = await this.fs.realpath(runDirectory);
    const reviewDirectory = join(runDirectory, "review");
    const existing = await this.fs.lstat(reviewDirectory).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (existing?.isSymbolicLink()) throw new TypeError("Review directory must not be a symbolic link.");
    await this.fs.mkdir(reviewDirectory, { recursive: true, mode: 0o700 });
    const canonicalReview = await this.fs.realpath(reviewDirectory);
    const pathFromRun = relative(canonicalRun, canonicalReview);
    if (pathFromRun.startsWith("..") || pathFromRun.includes("../")) throw new TypeError("Review directory escapes the run dossier.");
    await this.writeJson(join(canonicalReview, "flow-review.json"), report);
  }

  async readRun(runId) {
    return this.readJson(join(this.runDirectory(runId), "run.json"));
  }

  async listReceipts(runId) {
    const directory = this.runDirectory(runId);
    try {
      const entries = await this.fs.readdir(directory, { withFileTypes: true });
      const receipts = await Promise.all(entries
        .filter((entry) => entry.isFile() && /^receipt-[a-z][a-z0-9_-]{0,62}\.json$/.test(entry.name))
        .map((entry) => this.readJson(join(directory, entry.name))));
      return receipts.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async readIdempotency(key) {
    try {
      return await this.readJson(this.idempotencyPath(key));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeIdempotency(key, value) {
    await this.writeJson(this.idempotencyPath(key), value);
  }

  async listRuns() {
    const root = join(this.stateDir, "runs");
    try {
      const entries = await this.fs.readdir(root, { withFileTypes: true });
      const runs = await Promise.all(entries
        .filter((entry) => entry.isDirectory() && /^run_[a-z0-9-]{1,63}$/.test(entry.name))
        .map((entry) => this.readRun(entry.name).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error))));
      return runs.filter(Boolean).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async readJson(path) {
    return JSON.parse(await this.fs.readFile(path, "utf8"));
  }

  idempotencyPath(key) {
    const digest = createHash("sha256").update(key).digest("hex");
    return join(this.stateDir, "idempotency", `${digest}.json`);
  }

  async writeJson(path, value) {
    const target = path;
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    const content = `${JSON.stringify(this.redactor(value), null, 2)}\n`;
    await this.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await this.fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await this.fs.rename(temporary, target);
  }
}
