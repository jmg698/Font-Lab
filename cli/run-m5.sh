#!/usr/bin/env bash
# M5 MCP server + engine facade — verify the agent-facing surface: the engine functions
# (analyze / list_catalog / curate / compose / prepare / read / apply) and the MCP server
# over real stdio (initialize → tools/list → tools/call). Offline (fetch disabled).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/cli/m5-test.mjs"
