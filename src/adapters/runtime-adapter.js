import { FlowError } from "../core/errors.js";

const capabilities = Object.freeze({
  codex: Object.freeze({ guided: true, direct: false }),
  claude: Object.freeze({ guided: true, direct: false })
});

export function supportedRuntimes() {
  return Object.keys(capabilities);
}

export function capabilityMatrix() {
  return structuredClone(capabilities);
}

export function assertAdapterCapability(runtime, executionMode) {
  if (!capabilities[runtime]) throw new FlowError("UNSUPPORTED_RUNTIME", `Runtime '${runtime}' is not supported.`);
  if (!capabilities[runtime][executionMode]) throw new FlowError("UNSUPPORTED_ADAPTER_OPERATION", `Runtime '${runtime}' does not support '${executionMode}' mode.`);
}

export function createRuntimeAdapter(runtime) {
  if (!capabilities[runtime]) throw new FlowError("UNSUPPORTED_RUNTIME", `Runtime '${runtime}' is not supported.`);
  return Object.freeze({
    runtime,
    capabilities: { ...capabilities[runtime] },
    async launch() {
      throw new FlowError("ADAPTER_LAUNCH_DISABLED", "Host adapter launch is not enabled in this development build.");
    }
  });
}
