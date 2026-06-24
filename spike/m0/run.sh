#!/usr/bin/env bash
# M0 go/no-go — one command. Proves both load-bearing claims end to end:
#   1. the dev-only :root font swap survives Next.js Fast Refresh, and
#   2. the precomputed preview renders pixel-identically to the next/font ship output.
#
# Requires: pnpm, a Playwright chromium (spike/m0 installs playwright), the fixture's deps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/examples/sample-next-site"
SPIKE="$ROOT/spike/m0"
PORT_PROD=4321
PORT_DEV=4322
mkdir -p "$SPIKE/out"

PROD_PID=""; DEV_PID=""
cleanup() { [ -n "$PROD_PID" ] && kill "$PROD_PID" 2>/dev/null || true; [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[1/6] reproduce next/font's adjusted fallback from capsize metrics"
node "$SPIKE/gen-fonts.mjs"

echo "[2/6] production build"
( cd "$APP" && pnpm build >"$SPIKE/out/build.log" 2>&1 ) || { tail -20 "$SPIKE/out/build.log"; exit 1; }

echo "[3/6] compare computed overrides vs next/font emitted + stage woff2"
node "$SPIKE/compare.mjs"

echo "[4/6] parity: pixel-diff /ship vs /preview (prod server)"
( cd "$APP" && pnpm exec next start -p "$PORT_PROD" >"$SPIKE/out/prod.log" 2>&1 ) & PROD_PID=$!
until curl -sf "http://localhost:$PORT_PROD/ship" >/dev/null 2>&1; do sleep 0.5; done
BASE_URL="http://localhost:$PORT_PROD" node "$SPIKE/screenshot-parity.mjs"
kill "$PROD_PID" 2>/dev/null || true; PROD_PID=""

echo "[5/6] DCE: dev panel must be absent from the production client bundle"
if grep -rq "fontlab-panel-host" "$APP/.next/static" --include='*.js' 2>/dev/null; then
  echo "  ✗ panel LEAKED into prod JS"; exit 1
else echo "  ✓ panel absent from prod client JS"; fi

echo "[6/6] HMR: the :root font swap must survive Fast Refresh (dev server)"
( cd "$APP" && pnpm exec next dev -p "$PORT_DEV" >"$SPIKE/out/dev.log" 2>&1 ) & DEV_PID=$!
until curl -sf "http://localhost:$PORT_DEV/" >/dev/null 2>&1; do sleep 0.5; done
BASE_URL="http://localhost:$PORT_DEV" node "$SPIKE/hmr-test.mjs"
kill "$DEV_PID" 2>/dev/null || true; DEV_PID=""

echo
echo "M0 PASS — reports in spike/m0/out/{parity,hmr,compare}-report.json"
