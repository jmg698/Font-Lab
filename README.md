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

Pre-code. Planning and architecture are committed; implementation starts at **M0** — the
go/no-go spike that proves the live font swap **survives HMR** and that **preview equals
ship**. See [`ROADMAP.md`](./ROADMAP.md).
