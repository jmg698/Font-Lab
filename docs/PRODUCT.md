# Font Lab — PRODUCT.md

> Product context for design-skill authors and contributors. The full concept
> lives in [`CONCEPT.md`](./CONCEPT.md); architecture in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What it is

A decision surface for typography. AI removed the labor of implementing fonts but deleted the
**moment of choice** — Font Lab re-inserts it. An agent curates tasteful, shippable font
directions rendered live on the user's own running site; the human picks; the agent ships the
exact code, reversibly. The human keeps the taste decision; the agent does the typing.

## Register

`product` — the visible surfaces (the dev panel, the specimen sheet, CLI output) are tools in
the middle of someone's task. Earned familiarity over novelty; delight at *moments* (the pick,
the ship), not spread across the surface.

## Audience

Developers and design-minded builders working inside AI coding agents (Claude Code, Cursor,
Codex, …) on Next.js / Tailwind projects — people who can ship code but want their site to
stop looking like every other AI-generated Inter/Geist page.

## Brand personality

Precise, honest, quietly confident. A calibrated instrument, not a toy. The product's core
promise is *honesty about fidelity*: what you preview is what ships (and when it can't be
byte-for-byte, it says so plainly). Copy is concrete and unhedged; celebration is earned and
brief.

## Anti-references

- The overexposed AI-default look (Inter/Geist/Space Grotesk on everything) — the disease
  Font Lab exists to cure. Its own surfaces must never feel like that either.
- Cramped floating-widget toolbars with tiny targets and hidden capability.
- Confetti-grade celebration; kitsch. The joy moment is a drawn checkmark, not a party.

## Key surfaces

- **The dev panel** (`cli/templates/font-lab-panel.tsx`) — Shadow-DOM overlay on the user's
  dev site: the direction list, per-role mixing, before/after + snap-back compare, inspect (hover-identify + role x-ray + change receipts), inline copy editing, live handoff state
  (endpoint / agent-listening / saved / shipped), parity honesty badges.
- **The specimen sheet** (`font_lab_preview`) — self-contained HTML choosing sheet.
- **CLI / MCP output** — the agent-facing contract; discoverability lives in tool descriptions.
