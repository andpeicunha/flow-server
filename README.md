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

### Use with the legacy flow command

Install the local development commands on macOS from this repository:

```sh
npm link
```

This makes `flow-server` and the new `flow` client available in your shell.
The legacy flow runner remains unchanged unless you explicitly enable the
feature flag below:

```sh
export FLOW_SERVER_USE_LOCAL=1
```

With the flag enabled, the compatibility shim sends supported local-service
commands to the installed client. Without it, the shim uses the legacy runner.
The bridge does not launch Codex or Claude adapters.

## External flows and adapters

External flows are opt-in. `FlowCatalog` accepts only directories that the
caller explicitly configures. It never searches `$HOME`, and it accepts only
canonical v1 JSON flow documents. Core flows load first, then external flows,
then a selected profile; later sources replace matching flow IDs.

Codex and Claude are separate runtime contracts. Both support guided mode only
in this development build. Direct mode and adapter launch fail closed. No
adapter can run until a later approved change adds local authorization and a
host launcher.
