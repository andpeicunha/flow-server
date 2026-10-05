import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const excluded = new Set([".git", "node_modules", "dist"]);
const prohibitedPaths = /(^|\/)(profiles|runs|receipts|logs)(\/|$)|\.env(\.|$)/;
const sensitiveText = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s]+/i
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

const failures = [];
for (const file of await files(root)) {
  const name = relative(root, file);
  if (prohibitedPaths.test(name)) failures.push(`${name}: prohibited path`);
  const text = await readFile(file, "utf8");
  if (sensitiveText.some((pattern) => pattern.test(text))) {
    failures.push(`${name}: possible credential`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public artifact check passed.");
}
