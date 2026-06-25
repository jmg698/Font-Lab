# Font Lab — Roadmap

> Build order for the v1 slice: **fonts only, Next.js + Tailwind**. See
> [`CONCEPT.md`](./CONCEPT.md) for the why, [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the
> how, [`SHIP-SPEC.md`](./SHIP-SPEC.md) for the codegen detail, and
> [`CRITIQUE.md`](./CRITIQUE.md) for the decisions behind this ordering. Every milestone
> is a vertical slice that runs end to end — we never build a package in isolation and
> hope it integrates later.

## Guiding principle

De-risk the magic before investing in structure. The whole concept lives or dies on two
things: the live, full-fidelity swap (the **choosing moment**) *and* the guarantee that
**what they pick is exactly what ships.** M0 proves both; nothing downstream matters if it
fails, so it comes first. The second-riskiest link — reliably applying the change into a
real project — is pulled forward (M2), because it's the part nobody else closes and the
one we'd previously under-scoped.

## Testbeds

- **`examples/sample-next-site`** — deterministic in-repo Next.js + Tailwind v4 fixture for
  fast, reproducible iteration.
- **`jack-mcgovern.com`** — the real site, used as a periodic fidelity check against a
  moving, production-grade target *and* as the dogfood surface (below).

## The two cross-cutting threads (run the whole time)

- **Dogfood, not fake-test, the demand.** The riskiest assumption is behavioral, not
  technical: will a human pause to *choose*, or do they just want a good default? We don't
  fake a demo to test it — we ship it and watch whether Jack reaches for it *unprompted* on
  jack-mcgovern.com. If the builder of the tool doesn't open it next week, that's the
  signal. The Bakaus (impeccable) DM is a "once it's real" move, not an early one.
- **Capture the pick-stream from M1.** `selection.json` is append-only and logs every pick
  locally (opt-in). Taste memory is the only asset that compounds and can't be backfilled,
  so we start collecting before we need it.

## Milestones

### M0 — Parity + injection spike  *(go/no-go)*
Two claims, both now de-riskable:
1. **Injection survives HMR.** A dev-only `<FontLabDevPanel/>` swaps `--font-*` on `:root`,
   visibly changes the rendered site, and **survives Next.js Fast Refresh** (because the
   override lives outside React's tree). Panel UI isolated in a Shadow DOM so it isn't
   restyled by its own swap.
2. **Preview == ship, proven.** Precompute one font's primary + adjusted-fallback
   `@font-face` (same woff2 subset + capsize metrics + formulas), preview it, then
   *actually ship it* via `next/font` and **pixel-diff the rendered result.** A match is
   the real go/no-go — not "does it feel cool," but "is the magic honest."

Throwaway code. **If preview doesn't equal ship, or the swap doesn't survive HMR, we stop
and rethink before building anything else.**

### M1 — Walking skeleton (loop exists, end to end)
CLI launches the dev panel with **2 hardcoded directions**; arrow keys flip the active
font; a "Pick" button POSTs to a localhost endpoint that writes `.font-lab/selection.json`
(and appends to the pick log). Dumb but complete — the entire loop is real.

### M2 — The ship engine (codegen)  *(promoted)*
`selection.json` → the **exact** `next/font` + Tailwind edits, *applied to the project*,
idempotently and reversibly. Built against the pinned `sample-next-site` (known App Router
+ Tailwind v4) so it doesn't block on the analyzer. ts-morph for the `.tsx` surgery, fenced
markers for CSS/config, **backup-first** undo, verify-and-auto-restore on failure. This is
the step nobody else closes — full spec in [`SHIP-SPEC.md`](./SHIP-SPEC.md).

### M3 — Real analyzer  *(done — `cli/analyzer.mjs`, `cli/run-m3.sh` 55/55)*
Detect framework, **App vs Pages Router**, **Tailwind v3 vs v4**, current fonts, and font
wiring (CSS-var vs hardcoded). Feeds the codegen branch selection *and* the before/after
toggle. Panel shows `current: …` and a **before/after toggle** against the live current
state. The analyzer traces the CSS custom-property graph from each role var (`--font-display`)
back through any indirection to the next/font const that feeds it — so it names the real
current font on a site that maps `--font-display: var(--font-bricolage)` as readily as on the
fixture's `--font-sans → --fl-sans → --font-inter`. Codegen consumes it two ways: it
**refuses** out-of-branch projects (v3 / Pages / hardcoded) with a clear reason, and on the
supported branch it either replaces a role-var const or **adopts** the project's own variable
(rewriting the const in place, minimal diff). Verified end-to-end on **jack-mcgovern.com**:
analyzed, applied, **built**, rendered, and reverted byte-for-byte.

### M4 — Parity catalog + curator  *(done — `cli/catalog.mjs`, `cli/curator.mjs`, `cli/run-m4.sh` 96/96)*
A **41-font catalog** of variable Google fonts as precomputed parity bundles (self-hosted
woff2 + the two `@font-face` blocks), each gated on **verified capsize coverage** (checked
by importing the metrics) *and* single-woff2 variable parity — the two hard requirements for
"preview == ship." A deterministic **LLM-free curator** turns `analysis + vibe` into ~5
curated directions, each a name + vibe label + one-line rationale; it moves off the project's
current fonts, ranks by vibe, and is fully reproducible. `gen-catalog` now runs the whole
analyzer → curator → parity-bundle pipeline. Seeding the brief from an impeccable
`detect --json` audit is left as an optional future hook.

### M5 — MCP server + skill (+ agent discoverability)  *(done — `cli/mcp.mjs`, `cli/engine.mjs`, `skill/font-lab/SKILL.md`, `cli/run-m5.sh` 26/26)*
A dependency-free JSON-RPC/stdio **MCP server** wraps the engine as 8 tools so an agent drives
the whole loop: invoke → curate → preview → read the pick → apply. The agent gets the curated
default for free **and can take the wheel** — composing its own directions from the catalog
(option 3) — but only from catalog fonts, so preview == ship still holds, and the **human
always makes the final pick** (the engine only ever prepares a preview; it never auto-selects).
A `SKILL.md` documents the loop and the rules, with tool/skill **descriptions tuned for
discoverability** so agents reach for Font Lab when a user wants to choose a font. Verified over
real stdio (initialize / tools-list / tools-call). Mirroring impeccable's provider-native
hook-manifest pattern beyond MCP is left as a follow-on.

### M6 — Polish the choosing moment  *(done — `cli/run-m6.sh`, M1 16/16 + M6 17/17, in a real browser)*
**Mixed picks** (heading from one direction, body from another — assembled per role and shipped
intact), **pin-two-to-compare**, **"more like this one,"** refined keyboard UX, and
**multi-route flipping** — the working pairing persists across routes (`/`, `/dense`, `/form`)
via sessionStorage, because a face reads differently on a hero vs. a dense docs page vs. a form.
All driven and verified in a real browser; a mixed pick ships end to end through codegen.

### Parallel front-door (awareness, not the product)
A deliberately thin bookmarklet/extension whose only job is the wow on any live site →
"install the skill to actually ship it." The agent-native loop is the conversion surface;
it has no top-of-funnel without this.

## Definition of done for the v1 slice

A human, inside their Next.js + Tailwind project, invokes Font Lab; sees ~5 tasteful
directions rendered on *their own running site* in CSS that is **byte-for-byte what will
ship**; flips through, compares, and picks; and the agent applies the real `next/font` +
Tailwind implementation — reversibly. The human kept the taste decision; the agent did the
typing; and what they saw is exactly what shipped.

## Explicitly out of scope for v1 (north star, not now)

- Other taste axes (color, spacing, radius, component style, motion).
- Taste memory / per-user learning (but we *log* the picks from M1 so it's buildable later).
- Hosted "second opinion / share" link (the eventual single paid, hosted piece).
