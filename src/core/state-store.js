import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { redact } from "./redaction.js";

function assertRunId(runId) {
  if (!/^run_[a-z0-9-]{1,63}$/.test(runId)) throw new TypeError("Invalid run id.");
}

export class FileStateStore {
  constructor(stateDir, { fs = { link, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile }, redactor = redact } = {}) {
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
