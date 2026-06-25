#!/usr/bin/env bash
# M4 catalog + curator — verify every catalog font has real capsize coverage and the right
# shape, and that the curator is deterministic, valid, and always moves off the baseline.
# Offline (no network): coverage is checked by importing each font's metrics.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/cli/m4-test.mjs"
