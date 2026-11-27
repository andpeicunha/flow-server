# Codex MCP setup

For the day-to-day sequence, see the [quick guide in Portuguese](guia-rapido.md)
and the [colored sequence diagram](../README.md#guided-run-sequence).

`flow-mcp` is a local stdio MCP server. It reads the local service metadata and
connects only to `http://127.0.0.1`. It never runs shell commands, reads run
directories, or starts Codex or Claude adapters.

Install this repository locally, then start the service. For private flows,
the CLI reads `~/.config/flow-server/sources.json` by default (the Herdr
plugin creates it on first use). Set `FLOW_SOURCE_CONFIG` or pass
`--source-config` to use another file. Startup fails if the selected file is
missing or has no profiles:

```sh
npm link
flow-server start
# For another file: flow-server start --source-config /absolute/path/to/sources.json
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
Legacy sources can set `execution.runtime: "claude"`. With execution profiles,
`doctor` checks the MCP registration and Skills for configured execution
profiles and legacy runtime/fallback settings. It does not verify model
availability, account access, or whether the current
agent session has loaded the MCP tools.

Use `flow_list` to inspect flows in a source profile. `flow_select` may also
return `executionProfiles` and `defaultExecutionProfileId`. When profiles are
listed, choose the intended one (or use the declared default) and pass its ID as
`executionProfileId` to `flow_start_guided`. The Herdr pane asks for this choice
when starting a run. Pass the original task so it appears in node prompts.
`flow_next` starts the run and returns ready nodes with their configured agent,
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
on the same run. If a node has a failed receipt or a completed receipt that
triggered `stopWhen` with `mode: block`, first use
`flow_retry_inspect` to review its predecessors and pinned worktree. Stop if a
completed predecessor is wrong. Then call `flow_continue` with a short reason,
the pinned workspace, a factual `worktreeReview`, and `reviewedPredecessors: true`
only after reviewing every predecessor. The service archives the
old receipt and returns only that node with its new `attempt` number. A paused run
requires `flow_lifecycle` with `resume` first. Terminal runs cannot continue.

A source may define reusable execution profiles for new runs. Each run pins
its selected profile, runtime, model mappings, and resolved node settings. After a
real provider limit, use `flow_inspect` and `flow_retry_inspect` to confirm the
blocked node and inspect `selectedExecution`, `availableExecutionProfiles`,
predecessor receipts, `otherFailures`, `retryPending`, and the actual pinned
worktree. If another execution profile is available and every check passes, call
`flow_switch_runtime` with its `executionProfileId`, the pinned workspace, a
reason, a factual `worktreeReview`, and `reviewedPredecessors: true`. This
switches the blocked node and later nodes that do not yet have a receipt;
completed receipts remain unchanged. Use the returned runtime, model, effort,
and attempt in the next checkpoint.

Execution profiles select runtime and model IDs; they do not select or change
provider credentials. The active agent session must already be authenticated
for the selected runtime. Legacy `fallbackExecution` remains supported for
existing runs and switches only the blocked node. If there is no alternate
profile or legacy fallback, continue the same run only after primary provider
access is restored. Otherwise leave it blocked. Do not start a replacement run
automatically.
`flow_retry_node` remains available for older clients but is no longer the
normal path for guided runs.
Use `flow_inspect` and `flow_audit` for run review. Audit reports `passed` only
after a completed run has evidence for every required node. `flow_open` remains
unavailable until the optional viewer is installed.

Only after the maintainer explicitly asks in a separate session, call
`flow_review` for a completed flow and use the `flow-performance-review` Skill
to interpret its advisory evidence report. It does not run automatically from
an active flow or launch an agent.
