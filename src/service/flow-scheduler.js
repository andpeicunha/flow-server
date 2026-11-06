function pathTokens(path) {
  if (typeof path !== "string" || path.length > 256) return undefined;
  const normalized = path.replace(/^\$\.?/, "");
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/.test(normalized)) return undefined;
  return normalized.split(".").flatMap((part) => {
    const tokens = [];
    part.replace(/([A-Za-z0-9_-]+)|\[(\d+)\]/g, (_match, key, index) => tokens.push(key ?? Number(index)));
    return tokens;
  });
}

function outputOf(receipt) {
  if (receipt.output !== undefined) return receipt.output;
  if (typeof receipt.summary === "string") {
    try { return JSON.parse(receipt.summary); } catch { /* Plain text summaries remain available below. */ }
  }
  return { status: receipt.status, ...(receipt.summary !== undefined ? { summary: receipt.summary } : {}) };
}

function valueAtPath(value, path) {
  const tokens = pathTokens(path);
  if (!tokens) return { known: false };
  let current = value;
  for (const token of tokens) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, token)) return { known: false };
    current = current[token];
  }
  return { known: true, value: current };
}

export function evaluateCondition(condition, receipts) {
  const receipt = receipts.get(condition.step);
  if (!receipt) return { known: false, reason: "referenced node has no receipt" };
  const resolved = valueAtPath(outputOf(receipt), condition.jsonPath);
  if (!resolved.known) return { known: false, reason: "referenced output path is missing" };
  const value = resolved.value;
  const equal = (left, right) => typeof left === "string" && typeof right === "string"
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : Object.is(left, right);
  const matches = Object.hasOwn(condition, "equals") ? equal(value, condition.equals)
    : Object.hasOwn(condition, "notEquals") ? !equal(value, condition.notEquals)
      : Object.hasOwn(condition, "in") ? condition.in.some((item) => equal(value, item))
        : condition.notIn.every((item) => !equal(value, item));
  return { known: true, matches };
}

function renderValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function promptOutputOf(receipt) {
  const output = outputOf(receipt);
  return output && typeof output === "object" && !Array.isArray(output)
    && typeof output.reportPath === "string" && typeof output.reportSha256 === "string"
    ? { ...output, reportAvailableOnRequest: true }
    : output;
}

function renderPrompt(template, run, receipts, flow) {
  if (typeof template !== "string") return "";
  const context = (flow.nodes ?? []).flatMap((node) => {
    const receipt = receipts.get(node.id);
    return receipt?.status === "completed" ? [`## ${node.id}`, renderValue(promptOutputOf(receipt))] : [];
  }).join("\n\n");
  const lastAnswer = [...receipts.values()].filter((receipt) => receipt.status === "completed")
    .sort((left, right) => String(left.recordedAt ?? "").localeCompare(String(right.recordedAt ?? "")) || left.nodeId.localeCompare(right.nodeId))
    .at(-1);
  const task = flow.taskContext === "once" && run.taskContextDelivered
    ? "The original task was supplied earlier in this run. Continue using that same task."
    : run.task ?? "";
  const reportProtocol = "\n\n### Full report protocol\nFor a substantial result, call flow_report_write with this runId and nodeId and the complete JSON report. Put the returned reportPath and reportSha256 in receipt.output with a concise summary (up to 4 KiB). Keep report-referenced receipt output up to 8 KiB. Use flow_report_read only when a prior summary is insufficient. Short results may stay inline.";
  return (template.replace(/\{\{\s*task\s*\}\}/g, task)
    .replace(/\{\{\s*context\s*\}\}/g, context)
    .replace(/\{\{\s*lastAnswer\s*\}\}/g, lastAnswer ? renderValue(promptOutputOf(lastAnswer)) : "")
    .replace(/\{\{\s*step\.([a-z][a-z0-9_-]{0,62})\s*\}\}/g, (_match, nodeId) => {
      const receipt = receipts.get(nodeId);
      return receipt ? renderValue(promptOutputOf(receipt)) : "";
    })) + `\n\nRun ID: ${run.id}.` + reportProtocol;
}

function dependenciesOf(node) {
  return node.after ?? node.dependsOn ?? [];
}

function readyNode(node, receipts) {
  const dependencies = dependenciesOf(node).map((id) => receipts.get(id));
  if (dependencies.some((receipt) => receipt?.status === "failed")) return { ready: false, failedDependency: true };
  return { ready: dependencies.every(Boolean) };
}

function skillWarningsFor(node, run) {
  if (!node.skills?.length) return undefined;
  const runtime = node.executor ?? run.runtime;
  const skillToolAvailable = node.skillToolSupport?.[runtime];
  if (skillToolAvailable === true) return undefined;
  return [{
    code: skillToolAvailable === false ? "SKILL_TOOL_UNAVAILABLE" : "SKILL_TOOL_CAPABILITY_UNVERIFIED",
    reason: skillToolAvailable === false ? `The configured ${runtime} executor does not expose the Skill tool for this node.` : `The configured ${runtime} executor's Skill tool capability is unknown; verify it before relying on declared Skills.`
  }];
}

export function planFlowNext(flow, run, receiptList) {
  const receipts = new Map(receiptList.map((receipt) => [receipt.nodeId, receipt]));
  const failed = receiptList.find((receipt) => receipt.status === "failed");
  if (failed) return { status: "blocked", reason: "DEPENDENCY_FAILED", nodeId: failed.nodeId };
  for (const rule of flow.stopWhen ?? []) {
    if (!receipts.has(rule.step)) continue;
    if (receipts.get(rule.step).status === "skipped") continue;
    const result = evaluateCondition(rule, receipts);
    if (!result.known) return { status: "blocked", reason: "STOP_RULE_OUTPUT_MISSING", nodeId: rule.step };
    if (result.matches) {
      const details = { nodeId: rule.step, status: rule.status, next: rule.next };
      return rule.mode === "block"
        ? { status: "blocked", reason: "STOP_RULE", nodeId: rule.step, block: details }
        : { status: "stopped", stop: details };
    }
  }

  const skipped = [];
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const node of flow.nodes) {
      if (receipts.has(node.id)) continue;
      const readiness = readyNode(node, receipts);
      if (readiness.failedDependency) return { status: "blocked", reason: "DEPENDENCY_FAILED", nodeId: node.id, skipped };
      if (!readiness.ready) continue;
      if (node.when) {
        const condition = evaluateCondition(node.when, receipts);
        if (!condition.known) return { status: "blocked", reason: "CONDITION_OUTPUT_MISSING", nodeId: node.id, skipped };
        if (!condition.matches) {
          const receipt = { nodeId: node.id, status: "skipped", summary: "Condition did not match.", _node: node };
          receipts.set(node.id, receipt);
          skipped.push(receipt);
          madeProgress = true;
          continue;
        }
      }
    }
  }

  const ready = flow.nodes.filter((node) => {
    if (receipts.has(node.id)) return false;
    if (!readyNode(node, receipts).ready) return false;
    if (!node.when) return true;
    return evaluateCondition(node.when, receipts).matches;
  }).map((node) => ({
    ...(skillWarningsFor(node, run) ? { skillWarnings: skillWarningsFor(node, run) } : {}),
    id: node.id,
    title: node.title ?? node.id,
    agent: node.agent,
    role: node.role,
    model: node.model,
    effort: node.effort,
    variant: node.variant,
    executor: node.executor,
    skills: node.skills ?? [],
    ...(node.reusable === true ? { reusable: true } : {}),
    mcps: node.mcps ?? [],
    toolGuidance: "Use only the Skills and MCPs declared by this node and allowed by the active profile.",
    constraints: node.constraints ?? [],
    prompt: renderPrompt(node.prompt ?? node.input ?? node.output, run, receipts, flow),
    output: node.output,
    dependsOn: dependenciesOf(node),
    ...(node.evidencePolicy ? { evidencePolicy: node.evidencePolicy } : {})
  }));
  const result = { status: ready.length ? "ready" : receipts.size === flow.nodes.length ? "done" : "blocked", nodes: ready, skipped: skipped.map(({ _node, ...receipt }) => receipt) };
  if (result.status === "blocked") result.reason = "DEPENDENCIES_UNRESOLVED";
  return result;
}
