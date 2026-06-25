#!/usr/bin/env bash
# M3 analyzer — prove the analyzer reads real projects correctly and that codegen consumes
# that analysis to ship both wiring shapes (role-var fixture + the adopt path on the real
# jack-mcgovern.com site), refusing out-of-branch projects. Structural; no build needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/cli/m3-test.mjs"
