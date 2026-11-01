#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { throw new Error("flow-server requires Node.js 22 or newer") }'
npm ci --omit=dev --no-audit --no-fund
