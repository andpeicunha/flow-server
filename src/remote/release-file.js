import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { FlowError } from "../core/errors.js";

export async function loadRemoteReleases(filePath, { fs = { readFile } } = {}) {
  if (typeof filePath !== "string" || !isAbsolute(filePath) || !filePath.endsWith(".json")) {
    throw new FlowError("REMOTE_CATALOG_FILE_INVALID", "The catalog file must be an absolute .json path.");
  }
  const canonicalPath = resolve(filePath);
  let document;
  try {
    document = JSON.parse(await fs.readFile(canonicalPath, "utf8"));
  } catch {
    throw new FlowError("REMOTE_CATALOG_FILE_INVALID", "The catalog file cannot be read as JSON.");
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.releases)) {
    throw new FlowError("REMOTE_CATALOG_FILE_INVALID", "The catalog file must contain a releases array.");
  }
  return document.releases;
}
