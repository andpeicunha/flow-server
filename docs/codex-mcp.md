# Codex MCP setup

`flow-mcp` is a local stdio MCP server. It reads the local service metadata and
connects only to `http://127.0.0.1`. It never runs shell commands, reads run
directories, or starts Codex or Claude adapters.

Install this repository locally, then start the service:

```sh
npm link
flow-server start
```

Add this MCP server to Codex:

```sh
codex mcp add flow-server -- flow-mcp
```

For a non-default state directory:

```sh
codex mcp add flow-server -- flow-mcp --state-dir /absolute/state-directory
```

Restart the Codex session after adding the server. Prompts can then use
`flow_list`, `flow_inspect`, `flow_start_guided`, `flow_checkpoint`, and
`flow_audit` through the local MCP connection.

`flow_next` and `flow_open` are visible but fail closed until the local
scheduler and optional viewer exist.
