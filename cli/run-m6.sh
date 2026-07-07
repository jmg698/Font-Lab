#!/usr/bin/env bash
# M6 choosing-moment polish — build the catalog, start the fixture dev server, and drive the
# panel in a real browser: M1 loop still passes (compat), plus mixed picks, before/after,
# pin-to-compare, and multi-route persistence.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/examples/sample-next-site"
CLI="$ROOT/cli"
PORT_DEV=4332
mkdir -p "$CLI/out"

DEV_PID=""
cleanup() { [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[0/3] keymap parity (KEYMAP table ↔ onKey handler)"
node "$CLI/panel-keys-test.mjs"

echo "[1/3] build parity catalog"
node "$CLI/gen-catalog.mjs"

echo "[2/3] start fixture dev server (Turbopack) on $PORT_DEV"
( cd "$APP" && pnpm exec next dev -p "$PORT_DEV" >"$CLI/out/dev-m6.log" 2>&1 ) & DEV_PID=$!
until curl -sf "http://localhost:$PORT_DEV/" >/dev/null 2>&1; do sleep 0.5; done

echo "[3/3] drive M1 (compat) + M6 (mixed picks / pin / multi-route)"
BASE_URL="http://localhost:$PORT_DEV" node "$CLI/loop-test.mjs"
BASE_URL="http://localhost:$PORT_DEV" node "$CLI/m6-test.mjs"

echo
echo "M6 PASS"
