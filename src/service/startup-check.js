import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

function connectionCode(error) {
  return error?.cause?.code || error?.code;
}

function liveProcess(pid, isProcessAlive) {
  return Number.isInteger(pid) && pid > 0 && isProcessAlive(pid);
}

export async function checkBeforeStart({ stateDir, port, sourceConfig, fetchImpl = fetch,
  readFileImpl = readFile, accessImpl = access, isProcessAlive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code === "EPERM"; }
  } } = {}) {
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const response = await fetchImpl(`${endpoint}/v1/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) throw new Error(`Service health returned ${response.status}.`);
    const running = await response.json();
    if (running.status !== "ready") throw new Error(`flow-service is ${running.status || "not ready"}.`);
    if ((running.sourceConfig || sourceConfig) && running.sourceConfig !== sourceConfig) {
      throw new Error("flow-service is already running with a different source configuration.");
    }
    return { action: "ready", running };
  } catch (error) {
    if (["EACCES", "EPERM"].includes(connectionCode(error))) {
      throw new Error("Cannot access the local flow-service from this session (loopback blocked). Check session permissions; do not remove the service lock or start another service.");
    }
    if (!["ECONNREFUSED", "ENOENT"].includes(connectionCode(error))) {
      throw new Error(`Cannot confirm that the flow-service is stopped: ${error.message}. Do not remove the service lock or start another service.`);
    }
  }

  let owner;
  try { owner = JSON.parse(await readFileImpl(join(stateDir, "service.lock", "owner.json"), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Cannot inspect the service lock: ${error.message}. No service was started.`);
    try {
      await accessImpl(join(stateDir, "service.lock"));
      throw new Error("The service lock exists without readable owner metadata. No service was started or lock removed.");
    } catch (lockError) {
      if (lockError.code !== "ENOENT") throw lockError;
    }
  }
  if (owner && (!Number.isInteger(owner.pid) || owner.pid <= 0)) {
    throw new Error("The service lock has an invalid owner. No service was started or lock removed.");
  }
  if (liveProcess(owner?.pid, isProcessAlive)) {
    throw new Error(`The service lock belongs to active process ${owner.pid}, but port ${port} did not answer. Check the configured port and session access. No service was started or lock removed.`);
  }
  return { action: "start" };
}
