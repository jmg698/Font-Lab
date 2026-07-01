#!/usr/bin/env bash
# M8 — the portable choosing moment: a self-contained HTML specimen sheet (fonts embedded, project
# palette, honest width-diff render check) that works on ANY framework, plus previewSpecimen wiring.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/cli/m8-test.mjs"
