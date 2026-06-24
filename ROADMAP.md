# Font Lab — Roadmap

> Build order for the v1 slice: **fonts only, Next.js + Tailwind**. See
> [`CONCEPT.md`](./CONCEPT.md) for the why and [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> for the how. Every milestone is a vertical slice that runs end to end — we never
> build a package in isolation and hope it integrates later.

## Guiding principle

De-risk the magic before investing in structure. The whole concept lives or dies on the
live, full-fidelity font swap (the **choosing moment**). M0 is the go/no-go; nothing
downstream matters if it fails, so it comes first.

## Testbeds

- **`examples/sample-next-site`** — deterministic in-repo Next.js + Tailwind fixture for
  fast, reproducible iteration.
- **`jack-mcgovern.com`** — the real site, used as a periodic fidelity check against a
  moving, production-grade target.

## Milestones

### M0 — Spike: de-risk the magic  *(go/no-go)*
Proxy the sample site, inject **one hardcoded font swap**, and confirm it:
- visibly changes the rendered site,
- survives Next.js Fast Refresh (HMR),
- looks full-fidelity (no flash, no layout break).

Throwaway code. **If this doesn't feel magic, we stop and rethink before building
anything else.**

### M1 — Walking skeleton (loop exists, end to end)
CLI launches proxy + a bare panel with **2 hardcoded directions**; arrow keys flip the
active font; a "Pick" button writes `.font-lab/selection.json`. Dumb but complete — the
entire loop is real.

### M2 — Real analyzer
Detect framework, current fonts, site type, and font wiring. Panel shows
`current: Inter/Geist` and a **before/after toggle** against the live current state.

### M3 — Real catalog + curator
~40-font hand-authored catalog; ~5 curated directions each with a name, vibe label, and
one-line rationale. LLM ranks/explains only (directions may still be hardcoded for the
testbed at this stage).

### M4 — Codegen + handoff (loop closed)
`selection.json` → the **exact** `next/font` + Tailwind snippet, applied to the project.
Reversible; re-runnable. This is the step nobody else closes.

### M5 — MCP server + skill
Wrap the engine so an agent drives the whole loop: invoke → curate → preview → read the
pick → apply. Distribution as an agent-installable tool.

### M6 — Polish the choosing moment
Pin-two-to-compare, "more like this one," refined keyboard UX, mixed picks (heading from
A, body from B).

### Optional, alongside M3
Call **impeccable** to seed the directions — proving the "we make impeccable's advice
choosable" story.

## Definition of done for the v1 slice

A human, inside their Next.js + Tailwind project, invokes Font Lab; sees ~5 tasteful
directions rendered on *their own running site*; flips through, compares, and picks; and
the agent ships the real `next/font` + Tailwind implementation. The human kept the taste
decision; the agent did the typing.

## Explicitly out of scope for v1 (north star, not now)

- Other taste axes (color, spacing, radius, component style, motion).
- Taste memory / per-user learning.
- Hosted "second opinion / share" link (the eventual single paid, hosted piece).
