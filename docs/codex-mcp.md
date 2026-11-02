# Codex MCP setup

For the day-to-day sequence, see the [quick guide in Portuguese](guia-rapido.md).

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

Use `flow_list` to inspect flows in a profile, `flow_start_guided` to create a
selected run. Pass the original task so it appears in node prompts. `flow_next`
starts the run and returns ready nodes with their configured agent,
model, effort, executor, Skills, constraints, and prompt. Record node outputs
with `flow_checkpoint` so conditions and stop rules can be evaluated. For a
completed node with a configured model, the checkpoint must record the matching
model and effort. Check the actual runtime settings before saving it.

Use `flow_lifecycle` to pause, resume, stop, or fail a run; completion is automatic.
Use `flow_inspect` and `flow_audit` for run review. Audit reports `passed` only
after a completed run has evidence for every required node. `flow_open` remains
unavailable until the optional viewer is installed.

Only after the maintainer explicitly asks in a separate session, call
`flow_review` for a completed flow and use the `flow-performance-review` Skill
to interpret its advisory evidence report. It does not run automatically from
an active flow or launch an agent.
