#!/usr/bin/env bash
# M1 walking skeleton — one command. Builds the parity catalog, starts the fixture dev
# server, and drives the full loop (panel → flip → pick → .font-lab/selection.json).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/examples/sample-next-site"
CLI="$ROOT/cli"
PORT_DEV=4331
mkdir -p "$CLI/out"

DEV_PID=""
cleanup() { [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[1/3] build parity catalog (self-host Google fonts + compute next/font fallbacks)"
node "$CLI/gen-catalog.mjs"

echo "[2/3] start fixture dev server (Turbopack)"
( cd "$APP" && pnpm exec next dev -p "$PORT_DEV" >"$CLI/out/dev.log" 2>&1 ) & DEV_PID=$!
until curl -sf "http://localhost:$PORT_DEV/" >/dev/null 2>&1; do sleep 0.5; done

echo "[3/3] drive the loop end to end"
BASE_URL="http://localhost:$PORT_DEV" node "$CLI/loop-test.mjs"

echo
echo "M1 PASS — pick written to examples/sample-next-site/.font-lab/selection.json"
