# Codex MCP setup

For the day-to-day sequence, see the [quick guide in Portuguese](guia-rapido.md)
and the [colored sequence diagram](../README.md#guided-run-sequence).

`flow-mcp` is a local stdio MCP server. It reads the local service metadata and
connects only to `http://127.0.0.1`. It never runs shell commands, reads run
directories, or starts Codex or Claude adapters.

Install this repository locally, then start the service. For private flows,
pass an explicit source configuration (the Herdr plugin creates one on first
use):

```sh
npm link
flow-server start
# Or: flow-server start --source-config ~/.config/flow-server/sources.json --port 4741
```

Add this MCP server to Codex:

```sh
codex mcp add flow-server -- flow-mcp
```

For a non-default state directory:

```sh
codex mcp add flow-server -- flow-mcp --state-dir /absolute/state-directory
```

Restart the Codex session after adding the server. Use `flow_select` before a
run when the workspace or flow is not already known. A unique local workspace
mapping and route can be trusted automatically; if selection is ambiguous, ask
the developer and do not start a run yet.

For Claude, register the same `flow-mcp` command with `claude mcp add flow-server -- flow-mcp`.
The local source can set `execution.runtime: "claude"`; the doctor then checks
Claude's MCP registration and Skills instead of Codex's.

Use `flow_list` to inspect flows in a profile, `flow_start_guided` to create a
selected run. Pass the original task so it appears in node prompts. `flow_next`
starts the run and returns ready nodes with their configured agent,
model, effort, executor, Skills, constraints, and prompt. Record node outputs
with `flow_checkpoint` so conditions and stop rules can be evaluated. For a
completed node with a configured model, the checkpoint must record the matching
model and effort. Check the actual runtime settings before saving it. The
`receipt` needs `schemaVersion: "v1"`, the same `runId` as the outer argument,
`nodeId`, `status: "completed"` or `"failed"`, and an RFC 3339 `recordedAt`.
Put node answers inside `receipt.output`; `decision`, `reason`, and `evidence`
are not top-level receipt fields. See the [quick guide](guia-rapido.md) for an
example.

Use `flow_lifecycle` to pause, resume, stop, or fail a run; completion is automatic.
If a ready node cannot run before a checkpoint, call `flow_block` with the
reason and node ID. After the developer fixes the problem, use `flow_continue`
on the same run. If a node has a failed receipt, first use
`flow_retry_inspect` to review its predecessors and pinned worktree. Stop if a
completed predecessor is wrong. Then call `flow_continue` with a short reason,
the pinned workspace, a factual `worktreeReview`, and `reviewedPredecessors: true`
only after reviewing every predecessor. The service archives the
failure and returns only that node with its new `attempt` number. A paused run
requires `flow_lifecycle` with `resume` first. Terminal runs cannot continue.
`flow_retry_node` remains available for older clients but is no longer the
normal path for guided runs.
Use `flow_inspect` and `flow_audit` for run review. Audit reports `passed` only
after a completed run has evidence for every required node. `flow_open` remains
unavailable until the optional viewer is installed.

Only after the maintainer explicitly asks in a separate session, call
`flow_review` for a completed flow and use the `flow-performance-review` Skill
to interpret its advisory evidence report. It does not run automatically from
an active flow or launch an agent.
