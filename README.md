# Font Lab

A **decision surface** for typography in AI-built software. AI removed the labor of
implementation but deleted the moment of choice — and taste only happens at the moment
of choice. Font Lab re-inserts **the choosing moment**: it hands a human a curated set
of font directions, rendered live on their *real* running site, lets them pick, and the
agent ships the implementation.

> The human keeps the taste decision; the agent does the typing.

## Docs

- [`CONCEPT.md`](./CONCEPT.md) — the vision and the core belief (the *why*).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the choosing moment works, the monorepo
  seams, and the central `selection.json` contract (the *how*).
- [`SHIP-SPEC.md`](./SHIP-SPEC.md) — how a pick becomes real, reversible code in a real
  project (the link nobody else closes).
- [`ROADMAP.md`](./ROADMAP.md) — the v1 build order, milestone by milestone (the *when*).
- [`CRITIQUE.md`](./CRITIQUE.md) — the teardown and decision log behind the plan (the
  *why we chose this*).

## Status

**M0 → M4 shipped.** The go/no-go spike (M0) proved the live swap survives HMR and that
**preview equals ship**; M1 is the end-to-end choosing loop; M2 is the reversible ship
engine; **M3 is the real analyzer** (framework, router, Tailwind version, current fonts,
wiring + coverage diagnostics), verified on the in-repo fixtures *and* the real
jack-mcgovern.com site; **M4 is the parity catalog + curator** — a 41-font catalog of
capsize-verified variable fonts and a deterministic, LLM-free curator that turns the analysis
into ~5 tasteful directions. See [`ROADMAP.md`](./ROADMAP.md) and
[`cli/README.md`](./cli/README.md) for the per-milestone evidence. Next up: **M5** — MCP
server + skill so an agent drives the whole loop.
