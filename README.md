# flow-server

Public, local-first workflow service for YAML/JSON DAG flows, deterministic receipts, checkpoints, and audit.

This repository is in early development. It includes a runnable local service,
versioned public contracts, and synthetic fixtures only. It
deliberately contains no private flows, profiles, credentials, sessions, real
run evidence, company names, or dotfiles configuration.

The local HTTP API is documented in
[`contracts/v1/openapi.json`](contracts/v1/openapi.json). It is loopback-only;
every route that changes state requires the local service token and an
idempotency key.

The service does not emit telemetry, upload runs, or expose a non-loopback
bind. The local token is created with owner-only filesystem permissions in the
state directory.

This project is available under the [MIT License](LICENSE).

For a short, human-readable walkthrough, see the [quick guide in Portuguese](docs/guia-rapido.md).

See `openspec/changes/local-flow-service-product/` for the staged architecture and migration plan.

## Development

Requires Node.js 22 or newer.

```sh
npm test
npm run check:public
openspec validate local-flow-service-product --strict
```

## Local service (development)

Start the local service with its platform state-directory default:

```sh
node src/cli/flow-server.mjs start
node src/cli/flow-server.mjs status
node src/cli/flow-server.mjs doctor
node src/cli/flow-server.mjs stop
```

Use `--state-dir /absolute/path` to isolate local state during development and
`--port <1-65535>` to choose a loopback port. The development CLI provides no
adapter execution or Docker mode.

The `flow` client talks only to that local service:

```sh
node src/cli/flow.mjs list
node src/cli/flow.mjs start --flow hello-flow --workspace /absolute/workspace --runtime codex --mode guided
node src/cli/flow.mjs inspect <run-id>
node src/cli/flow.mjs audit <run-id>
```

Direct mode requires `--approve-host-adapter`; the current development build
still does not launch any adapter.

### Install local commands

Install the local development commands on macOS from this repository:

```sh
npm link
```

This makes `flow-server`, `flow-source`, `flow-mcp`, and the new `flow` client
available in your shell. Use the Herdr plugin and local MCP for new runs.

## External flows and adapters

External flows are opt-in. `FlowCatalog` accepts only directories that the
caller explicitly configures. It never searches `$HOME`; it validates compact
JSON flows and agent workflow YAML, including agent, model, effort, Skills,
prompts, conditions, dependencies, and stop rules. Flows with the same ID stay
separate in different profiles.

Codex and Claude are separate runtime contracts. Both support guided mode only
in this development build. Direct mode and adapter launch fail closed. No
adapter can run until a later approved change adds local authorization and a
host launcher.

## Local MCP

`flow-mcp` lets Codex call the local flow service from a prompt. It uses stdio
and connects only to the loopback service. Setup instructions are in
[docs/codex-mcp.md](docs/codex-mcp.md).

## Local flow sources

Personal flows stay in explicitly configured local directories. A source may be
`local` or a local `git` worktree owned by the developer. `flow-server` never
searches `$HOME`, stores Git credentials, or requires a remote service.
Each developer chooses their own source path. A private repository can be used;
no repository name or hosting provider is built into the plugin.

### Herdr plugin

Install a published GitHub branch or tag with:

```sh
herdr plugin install andpeicunha/flow-server --ref <branch-or-tag> -y
```

For a local checkout, use:

```sh
herdr plugin link /absolute/path/to/flow-server --enabled
```

The plugin package includes the local service, CLI, schemas, Skills, and
starter flow. It does not install or activate private flows. Each developer
configures the directory containing their own flows after installation.

Open the `Flow Server` pane. On first use, choose an existing local flow
directory and an optional workspace directory. The plugin saves only source
metadata in `~/.config/flow-server/sources.json`, starts a loopback service, and
shows local flows and guided runs. It never starts an agent by itself. Use the
local `flow-server` MCP from your agent to advance a guided run and checkpoint
node output. See [docs/codex-mcp.md](docs/codex-mcp.md) for the MCP setup.

The old `flow-tui-bridge` is a legacy reference. Do not register or call it for
new runs.

Create an owner-only JSON or restricted YAML configuration. Use local workspace
roots to associate repositories with private profiles:

```yaml
schemaVersion: v1
sources:
  - id: personal
    mode: local
    path: /absolute/path/to/flows
    workspaceRoots:
      - /absolute/path/to/workspace
    sync:
      pull: confirm
      push: manual
```

For a private Git repository, point `path` to its checked-out flow directory
and set `mode: git`. You may also set `remote` and `branch` for that source.
Git synchronization is separate from flow execution: the plugin reads the
current checkout and does not pull remote changes automatically.

Start the service with the explicit file:

```sh
flow-server start --source-config /absolute/path/to/sources.yaml
```

Validate and record a changed flow without performing any Git mutation:

```sh
flow-source validate /absolute/path/to/flow.yaml
flow-source mark --config /absolute/path/to/sources.yaml --source personal --file /absolute/path/to/flow.yaml
```

The runner selects a profile automatically only when one configured workspace
root matches uniquely. It selects a flow automatically only from an explicit
flow ID or when exactly one flow matches routing terms. Otherwise, the CLI or MCP
`flow_select` returns `needs_confirmation`; the agent must ask the developer
before starting. `flow_next` then returns ready nodes with the exact configured
agent, model, effort, executor, Skills, constraints, and prompt. The agent
records bounded structured output in node receipts so later conditions can run.
The first `flow_next` starts the run. It marks the run complete when all required
nodes finish; the CLI lifecycle command controls an active run.
The CLI audit command reports `passed` only for a completed run with evidence for every
required node.

For the full sequence in plain language, see the [quick guide](docs/guia-rapido.md).

The installed `flow-source-management` Skill defines safe commit, push, pull,
and rollback behavior. Pull always requires confirmation. The optional remote
catalog, VPS, Caddy, Cloudflare, and WorkOS deployment are paused and are not
required for local sources.

## Low-cost run evidence and flow review

Node receipts may record bounded duration, attempt, effective agent/model,
effort, Skills, deterministic validation, and passive review signals. Signals
are advisory and must set `affectsRun: false`; they never change an active run.

An explicit post-run review uses only local deterministic aggregation.

The maintainer requests this review in a separate session. The agent calls
`flow_review` through the local MCP and uses the `flow-performance-review`
Skill to interpret the report. The CLI is also available:

```sh
node src/cli/flow.mjs review sdd --last 20 --compare-versions
node src/cli/flow.mjs review sdd --since 2026-10-01T00:00:00Z
node src/cli/flow.mjs review sdd --content-hash <sha256>
```

The report is stored under the newest matching run at
`runs/<runId>/review/flow-review.json`. It references the analyzed run IDs and
groups evidence by flow content hash. It does not call a model. The installed
`flow-performance-review` Skill tells an independent agent how to interpret the
report and propose a separate, approved flow change.

When a run has an immutable flow snapshot, the report compares expected nodes
with stored receipts. Older runs without a snapshot are marked with unknown
evidence completeness. Evidence beyond the bounded software-flow limits is
rejected instead of producing an oversized report.

## Remote catalog MCP (V2 development)

`flow-remote-mcp` is separate from the local `flow-mcp` bridge. It has only
versioned-flow catalog and safe run-analysis tools. It cannot run agents, use a
shell, access a workspace, or publish a flow.

For local protocol development, create an explicit JSON catalog file with a
`releases` array. Each release must set `approved` to `true`. Set its absolute
path and a unique bearer token with at least 16 characters, then start the
stdio server:

```sh
export FLOW_REMOTE_MCP_BEARER_TOKEN="replace-with-a-unique-development-token"
export FLOW_REMOTE_MCP_CATALOG_FILE="/absolute/path/to/approved-releases.json"
export FLOW_REMOTE_MCP_DATA_FILE="/absolute/path/to/remote-catalog-state.json"
flow-remote-mcp
```

The remote transport must pass this value as `Bearer <token>` in the MCP request
authorization context. Do not put this token in a flow definition, prompt,
repository, or log. The data file stores only validated, redacted evidence,
analyses, and `pending_review` proposals. It never stores release definitions,
prompts, workspace paths, file bodies, tokens, secrets, or full agent output.
Use a dedicated writable directory for this one file. The release file stays
read-only. A VPS deployment and WorkOS OAuth are not included yet.
