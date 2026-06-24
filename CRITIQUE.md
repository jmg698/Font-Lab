# Font Lab — Critique & Decision Log

> A teardown of the original architecture and roadmap, the founder's responses, and what a
> round of grounded technical research confirmed or changed. This is the *why* behind the
> current [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`ROADMAP.md`](./ROADMAP.md), and
> [`SHIP-SPEC.md`](./SHIP-SPEC.md). Kept as a living record so we don't relitigate settled
> calls — or forget the open ones.

## Headline

The concept is strong and the original plan was honest about risk. The two scariest
*technical* unknowns — "does the preview actually match what ships?" and "can the live swap
survive HMR?" — both resolved **in our favor**, and cheaply. That moves the real risk off
the technology and onto **demand** (will people pause to choose?) and **distribution**
(will the agent reach for us?). Net: the idea is more buildable than it first looked.

## The teardown (six load-bearing critiques)

### 1. We de-risked the wrong magic first
M0 originally proved the *technical* swap. The riskiest assumption is **behavioral**: do
vibe-coders want to *choose*, or want a good default and to move on? Anthropic's own design
skill already just *picks* a font — the market partly votes "decide for me."
**Resolution:** demand is tested by **dogfooding, not a fake demo** (founder's call, and
the right one for a founder living the pain) — does Jack reach for it unprompted next week?
Added as a standing thread in the roadmap, not a gate.

### 2. The proxy/iframe was the wrong mechanism
The original M0 reached for a reverse proxy + CSP stripping + same-origin iframe — the
bookmarklet-era model. But the agent/dev-dependency form factor already puts us *inside the
origin*. **Resolution (confirmed by research):** a dev-only `<FontLabDevPanel/>` that swaps
`--font-*` on `:root` is simpler, higher-fidelity, and **survives Fast Refresh by
construction** (inline `<html>` styles live outside React's tree). Proxy deleted from v1;
parked for a later "preview a site we can't add a dependency to" product.

### 3. Preview ≠ ship, in the way that breaks the promise
`next/font` doesn't just load a file — it subsets and generates a *metric-adjusted fallback*
to prevent CLS. A naive CDN `<link>` preview gets none of that, so the human approves
something subtly different from what ships. **Resolution (confirmed):** `next/font` is
deterministic and build-time; the preview **precomputes the identical primary +
adjusted-fallback `@font-face`** (same woff2 subset + `@capsizecss/metrics` + the same
formulas). At steady state, preview *is* the shipped CSS. Promoted to an explicit M0 exit
criterion (pixel-diff preview vs. ship).

### 4. Codegen — the link nobody closes — was hand-waved
"Emit the snippet" is easy; *applying it idempotently and reversibly into an arbitrary real
project* is the value prop and was under-scoped. **Resolution:** a full spec
([`SHIP-SPEC.md`](./SHIP-SPEC.md)) — ts-morph for `.tsx`, fenced markers for CSS/config,
backup-first undo, Tailwind v3/v4 + App/Pages branches, an edge-case table, and
verify-with-auto-restore. Promoted from M4 to **M2**.

### 5. The catalog is not the moat
A 40-name Google-Fonts list is copyable in an afternoon, and the genuinely distinctive
fonts are commercial (can't auto-ship). **Resolution:** the founder agreed and went
further — we're not the taste-maker, we're the *control surface*. The catalog is reframed
as a **parity asset** (precomputed bundles that make preview == ship), and the real
compounding moat is the **logged pick-stream** (taste memory), captured from M1.

### 6. The agent-native loop has no top-of-funnel
"Rides the agent wave" is a hope, not a channel; a skill nobody knows to look for isn't
discovered. **Resolution:** keep a thin **front-door lure** (bookmarklet/extension → "now
install the skill to ship it") for awareness, and treat the **skill/tool description as
"SEO for agents"** so the agent reaches for us. Both added to the roadmap (front-door
thread + M5).

## Smaller points (folded in)

- **No runtime LLM in v1.** The agent driving the tool *is* the LLM; the curator is a
  deterministic lookup + pre-written rationale. Cheaper, instant, reliable.
- **Preload all candidates** so flips have zero latency (no FOUT on flip).
- **Multi-route preview** — fonts read differently across screens; "your real site" is more
  than one page (M6).
- **Don't stand up 7 packages before M0** — stay minimal through M1; the monorepo is the
  eventual shape, not the starting one.
- **Platform-vendor risk** (Anthropic improving its default design skill) — founder accepts
  it; the hedge is the deferred cross-axis taste layer.

## Founder responses (recorded)

- **Catalog isn't the moat** — agreed, strongly. We don't make the taste; we make sure the
  human has control and can see/manipulate it. Lean on existing taste skills (impeccable),
  let the human decide.
- **Demand** — build it real rather than fake it; the founder is the target user and feels
  the pain (restart dev server, wait for build, tweak, repeat). DM Bakaus once it's real.
  Goes in the portfolio either way.
- **Proxy** — agreed; drop it for the dev-only panel; revisit the iframe only if the thing
  takes off.
- **Preview = ship** — must be exact; that's the whole point.
- **Agent-native funnel** — landing page (`fontlab.jack-mcgovern.com`) + social + creators;
  wants LLMs to find it easily when someone asks.
- **"No LLM on critical path"** — clarified: the agent still drives everything; we just
  don't make a *separate* LLM call *inside the package* at runtime for v1.
- **Platform risk** — willing to live with it.

## New risks the research surfaced (didn't exist in the original docs)

1. **Capsize coverage gaps** — `next/font`'s metric table doesn't cover every Google font;
   uncovered fonts throw `"Failed to find font override values"` at build. Gates *ship*,
   not just preview. Verify per catalog font.
2. **DCE guard fragility** — the dev panel's `NODE_ENV` guard must be inline; wrapping it in
   a helper ships the panel to production. Lint-enforce.
3. **Turbopack is the default dev bundler (Next 16)** — no webpack-plugin API; a `webpack`
   key with no `turbopack` key now errors. Confirms injection belongs in *app code*, not a
   bundler plugin.
4. **impeccable integration is soft** — no API, no MCP, no stable report file; only
   `npx impeccable detect --json` (undocumented schema) + exit codes. Its font rules *flag*
   but don't *suggest*. So it seeds the brief, not the directions; treat as optional,
   Apache-2.0, credit it.

## Verdict

A good wedge, now with the two fatal-if-false technical questions answered green. Build the
font slice to feel magical; architect `selection.json` to log every pick from day one
(fonts prove the loop, the logged taste data is the actual company). The remaining risk is
demand and discovery — neither solved by code, both addressable by dogfooding and by tuning
how agents find us.

## Provenance

The technical claims here (next/font internals, Tailwind v3/v4 wiring, dev injection under
Turbopack, reversible codegen patterns, impeccable's surface) were verified against current
official docs and source in a five-thread research pass (June 2026). Per-claim source URLs
live in that research output; the load-bearing ones are cited inline in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`SHIP-SPEC.md`](./SHIP-SPEC.md).
