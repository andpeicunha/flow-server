---
name: flow-performance-review
description: Review stored flow runs and propose evidence-based flow improvements without changing active runs or flow files.
---

# Flow Performance Review

Use this Skill only when a maintainer explicitly asks to review or revalidate a
flow. Never invoke it from an active node.

1. Call the local MCP `flow_review` with the selected `flowId`, `profileId`,
   `last: 20`, and `compareVersions: true`. Use `since` or `contentHash` when
   the maintainer requests a narrower sample. The CLI `flow review` is a
   fallback when the MCP is unavailable.
2. Confirm the report's `flowId`, content-hash groups, run IDs, sample sizes,
   and `advisoryOnly: true` marker.
3. Evaluate success rate, failures, retries, duration, validation failures,
   missing metrics, passive signals, and `runEvidence` completeness per node.
   Treat `unknown` as missing proof, not as complete evidence.
4. Treat a single anomaly as weak evidence. State sample size and confidence.
5. Read referenced receipts only when a finding needs more context. Do not copy
   secrets, full prompts, or private output into the report.
6. Classify recommendations as flow YAML, node prompt, guardrail, Skill,
   agent/model routing, plugin/tooling, or runtime integration.
7. Produce a proposed diff and validation plan. Do not edit or activate the flow
   until the maintainer approves a separate change.
8. Never claim correlation proves that a model, effort, or Skill caused a
   result. Recommend a controlled comparison when evidence is uncertain.

The deterministic tool gathers facts. An independent agent interprets them
after the run. Review must never stop, retry, reroute, or mutate an active run.

