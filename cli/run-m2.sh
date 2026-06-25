#!/usr/bin/env bash
# M2 ship engine — apply a selection into the clean fixture and prove it: correct code,
# builds, renders the picked fonts, idempotent, reversible. Leaves the fixture pristine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/cli/apply-test.mjs"
