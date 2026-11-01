#!/usr/bin/env bash
set -euo pipefail
workspace="${HERDR_WORKSPACE_ID:?Run this action inside a Herdr workspace}"
plugin="${HERDR_PLUGIN_ID:-andpeicunha.flow-server}"
cwd=""
if [ -n "${HERDR_PLUGIN_CONTEXT_JSON:-}" ] && command -v jq >/dev/null 2>&1; then
  cwd="$(printf '%s' "$HERDR_PLUGIN_CONTEXT_JSON" | jq -r '.focused_pane_cwd // .workspace_cwd // empty')"
fi
args=(plugin pane open --plugin "$plugin" --entrypoint flows --placement tab --workspace "$workspace" --focus)
if [ -n "$cwd" ]; then args+=(--cwd "$cwd"); fi
"${HERDR_BIN_PATH:-herdr}" "${args[@]}"
