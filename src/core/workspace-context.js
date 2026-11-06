import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const maxFiles = 2000;
const maxFileBytes = 8 * 1024 * 1024;
const maxTotalBytes = 32 * 1024 * 1024;
const maxDiffBytes = 16 * 1024 * 1024;

function hash(...values) {
  const digest = createHash("sha256");
  for (const value of values) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    digest.update(String(bytes.length));
    digest.update(":");
    digest.update(bytes);
  }
  return digest.digest("hex");
}

function inside(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

async function git(workspace, args, maxBuffer = maxDiffBytes) {
  const { stdout } = await execFile("git", ["-C", workspace, ...args], { encoding: "buffer", timeout: 5000, maxBuffer });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

export async function fingerprintWorkspace(workspace, { fs = { lstat, readFile, realpath }, runCommand = execFile } = {}) {
  if (typeof workspace !== "string" || !workspace.trim()) throw new TypeError("A workspace path is required.");
  const canonicalWorkspace = await fs.realpath(workspace);
  const workspaceInfo = await fs.lstat(canonicalWorkspace);
  if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()) throw new TypeError("Workspace must be a real directory.");

  const runGit = async (args, maxBuffer = maxDiffBytes) => {
    const { stdout } = await runCommand("git", ["-C", canonicalWorkspace, ...args], { encoding: "buffer", timeout: 5000, maxBuffer });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  };
  const head = (await runGit(["rev-parse", "--verify", "HEAD"], 1024 * 1024)).toString("utf8").trim();
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new TypeError("Workspace revision could not be verified.");
  const diff = await runGit(["diff", "--binary", "HEAD", "--"], maxDiffBytes);
  const openspecDiff = await runGit(["diff", "--binary", "HEAD", "--", "openspec"], maxDiffBytes);
  const untracked = (await runGit(["ls-files", "--others", "--exclude-standard", "-z"], 4 * 1024 * 1024))
    .toString("utf8").split("\0").filter(Boolean).sort();
  if (untracked.length > maxFiles) throw new TypeError("Workspace has too many untracked files to fingerprint.");

  const untrackedDigest = createHash("sha256");
  const openspecDigest = createHash("sha256");
  let totalBytes = diff.byteLength + openspecDiff.byteLength;
  for (const relativePath of untracked) {
    if (relativePath.includes("\0")) throw new TypeError("Workspace has an invalid untracked path.");
    const absolutePath = resolve(canonicalWorkspace, relativePath);
    if (!inside(canonicalWorkspace, absolutePath)) throw new TypeError("Workspace has an untracked path outside its root.");
    const info = await fs.lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxFileBytes) throw new TypeError("Workspace has an unsupported untracked file.");
    totalBytes += info.size;
    if (totalBytes > maxTotalBytes) throw new TypeError("Workspace changes exceed the fingerprint limit.");
    const content = await fs.readFile(absolutePath);
    untrackedDigest.update(relativePath);
    untrackedDigest.update("\0");
    untrackedDigest.update(content);
    if (relativePath === "openspec" || relativePath.startsWith(`openspec${sep}`)) {
      openspecDigest.update(relativePath);
      openspecDigest.update("\0");
      openspecDigest.update(content);
    }
  }
  const worktreeHash = hash(diff, untrackedDigest.digest());
  const openSpecHash = hash(openspecDiff, openspecDigest.digest());
  return {
    canonicalWorkspace,
    head,
    worktreeHash,
    openSpecHash,
    contextHash: hash(canonicalWorkspace, head, worktreeHash, openSpecHash)
  };
}
