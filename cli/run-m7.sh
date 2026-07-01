#!/usr/bin/env bash
# M7 — the next/font decoupling + multi-framework support: detect framework + current fonts on
# TanStack/Vite/Astro, ship via the css-entry branch (self-hosted @font-face + Tailwind @theme),
# degrade honestly elsewhere, and never boot a server on `--version`. Structural + offline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/cli/m7-test.mjs"
