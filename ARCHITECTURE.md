# Font Lab — Architecture

> Engineering companion to [`CONCEPT.md`](./CONCEPT.md). This is the tech-lead view of
> *how* the concept becomes real code. No specs are frozen here — it captures the
> decisions we've made, the seams between pieces, and the contracts everything hangs
> off. The detailed plan for the ship step lives in [`SHIP-SPEC.md`](./SHIP-SPEC.md);
> the decision history and open risks live in [`CRITIQUE.md`](./CRITIQUE.md).

## The crux: how the "choosing moment" actually works

Everything in the concept is ordinary work **except** two things, and both are the
product: (1) rendering the user's real, running site in a candidate font — live,
flippable, full-fidelity — and (2) being able to prove that *what they pick is exactly
what ships*. If either isn't true, there's no product. So they drive the architecture.

### Mechanism 1 — live swap via a dev-only in-app panel (no proxy)

We run **inside the user's own dev server, as part of their app** — not behind a reverse
proxy. Because the tool is agent-installable (or a dev dependency), we don't need a proxy
to reach the page's origin; **we are the origin.**

1. **Dev-only panel.** A `<FontLabDevPanel/>` client component is mounted in
   `app/layout.tsx`, gated *inline* by `process.env.NODE_ENV === 'development'` so it is
   dead-code-eliminated from production builds.
2. **Swap = CSS variable override on `:root`.** The panel swaps fonts by calling
   `document.documentElement.style.setProperty('--font-sans', …)`. `next/font` exposes
   fonts as CSS custom properties (`--font-sans`, `--font-display`, `--font-mono`) that
   Tailwind's font utilities resolve through, so overriding the variable reflows the
   whole site instantly.
3. **Survives HMR by construction.** Inline styles on `<html>` live *outside* React's
   render tree, so Next.js Fast Refresh never wipes them. (A full reload re-applies from
   `selection.json` on mount.) This was the original architecture's single biggest risk;
   it's now answered by the mechanism itself.
4. **Panel isolated in a Shadow DOM.** The panel's own UI is a fixed-position overlay
   mounted in a Shadow DOM root, so the font swap it performs on the page doesn't restyle
   the panel.

This is cheaper and higher-fidelity than the proxy/iframe we originally sketched: no
header stripping, no websocket proxying, no cross-origin dance. The proxy/iframe idea is
parked for a *different, later* product (previewing a site we can't add a dependency to).

> **Why not a bundler plugin?** Turbopack is the default dev bundler in Next.js 16+ and
> has no webpack-plugin API; a `webpack` key with no matching `turbopack` key now errors.
> Injection therefore lives in *application code* (the component), which is identical on
> both bundlers — not in the bundler.

### Mechanism 2 — preview/ship parity (the WYSIWYG guarantee)

The honest version of "preview on your real site" is **the preview renders the exact CSS
that will ship.** This is achievable because `next/font/google` is fully *build-time* and
*deterministic*:

- It self-hosts the woff2, subsets it, and emits **two** `@font-face` blocks: the real
  font, plus an *adjusted-fallback* font carrying `size-adjust`, `ascent-override`,
  `descent-override`, and `line-gap-override` (to prevent layout shift).
- Those override values are computed by a pure function from a static metrics table
  (`@capsizecss/metrics`; Arial as the sans fallback, Times New Roman as the serif
  fallback). Same inputs → same output, every time.

So the preview **precomputes the identical two `@font-face` blocks** — same woff2 subset,
same metrics, same formulas — and injects them as plain CSS. At steady state (once fonts
are loaded), the preview *is* the shipped CSS. Parity is provable, not approximate.

The two places parity can drift, and how we close them:

- **woff2 bytes / subset** — use the *same* subset/woff2 the project will ship. Eliminated
  by sourcing identical files (the parity-bundle decision below).
- **transient FOUT during a swap** — a load-time artifact, not a steady-state delta;
  preloading all candidates up front removes it for flips.

### The riskiest assumptions that remain

- **Capsize coverage.** `next/font`'s metric table doesn't cover *every* Google font;
  uncovered fonts throw `"Failed to find font override values"` at build. This gates the
  *ship* path, not just preview. **Every catalog font must be verified covered** (or we
  measure its metrics ourselves via fontkit). See Risks.
- **Font wiring heterogeneity.** Projects that route fonts through CSS variables get the
  high-fidelity swap; projects that hardcode `font-family` get a lower-fidelity broad
  override. v1 is scoped to the CSS-variable path (our own stack).

Both are exercised in the M0 spike (see [`ROADMAP.md`](./ROADMAP.md)). M0 is the go/no-go.

## Monorepo layout

```
font-lab/
  packages/
    catalog/        # parity bundles: woff2 + the two @font-face blocks + verified metrics
    analyzer/       # static read of the project: framework, router, TW version, fonts, wiring
    curator/        # analysis + vibe -> ~5 directions (deterministic lookup; no runtime LLM)
    preview/        # THE MAGIC: dev-only panel, :root swap, parity CSS injection, panel UI
    codegen/        # selection -> exact next/font + Tailwind edits, applied + reversible
    cli/            # `npx font-lab` ties it together + the localhost write-back endpoint
    mcp/            # MCP server + skill so the agent drives all of the above
  examples/
    sample-next-site/  # deterministic Next + Tailwind v4 fixture to develop against
```

Data flows one direction, each arrow a typed contract:

```
analyzer  ->  curator  ->  preview  ->  selection.json  ->  codegen
```

Each package stays independently testable; any one can be swapped without touching the
others.

### What each package owns

- **catalog** — Not a taste asset (see [`CRITIQUE.md`](./CRITIQUE.md)); a **parity asset.**
  For each font: the woff2 (matching the shippable subset), the precomputed primary +
  adjusted-fallback `@font-face` CSS, and a flag confirming capsize-metric coverage. Pure
  data. This is what makes preview == ship.
- **analyzer** — Static parsing of the target project: framework, **App vs Pages Router**,
  **Tailwind v3 vs v4**, current fonts, and *how fonts are wired* (CSS vars vs hardcoded).
  Pure functions; the gamut-engine pattern reused. Its output selects the codegen branch.
- **curator** — Turns `analysis + vibe` into ~5 concrete directions via a deterministic
  lookup over the catalog, with pre-written rationale. **No runtime LLM call** — the
  agent driving the tool *is* the LLM; the package stays dumb, instant, and free.
  Optionally seeds the brief from an impeccable audit.
- **preview** — The dev-only panel, the `:root` variable swap, the parity-CSS injection,
  and the panel chrome (arrow-key flip, before/after toggle, pin-to-compare, "more like
  this"). The hard package.
- **codegen** — Takes the selection and applies the exact `next/font` + Tailwind edits to
  the project, idempotently and reversibly. The link nobody else closes. Full spec in
  [`SHIP-SPEC.md`](./SHIP-SPEC.md).
- **cli** — `npx font-lab`; wires analyzer → curator → preview, and runs the small
  localhost endpoint the browser panel POSTs the pick to.
- **mcp** — Thin wrapper exposing the engine as MCP tools + a skill so an agent can drive
  the loop end to end. Discoverability (how the agent learns to reach for us) is a
  first-class concern here.

## The central contract: `.font-lab/selection.json`

This file is the interface between **"human picked"** and **"agent ships."** The panel
writes it (via the localhost endpoint); codegen reads it. We pin the schema early so the
two halves can be built in parallel. Illustrative shape (not frozen):

```jsonc
{
  "version": 1,
  "pickedAt": "2026-06-24T00:00:00Z",
  "direction": {
    "id": "editorial-serif",
    "name": "Editorial",
    "vibe": "editorial",
    "rationale": "Warm serif headings against a clean grotesque body."
  },
  "roles": {
    "display": { "family": "Fraunces", "source": "google", "weights": [400, 600] },
    "body":    { "family": "Inter",    "source": "google", "weights": [400, 500] },
    "mono":    { "family": "JetBrains Mono", "source": "google", "weights": [400] }
  },
  "replaces": {
    "display": "Geist",
    "body": "Inter"
  },
  "target": {
    "framework": "next",
    "router": "app",
    "styling": "tailwind",
    "tailwindVersion": 4,
    "fontWiring": "css-variables"
  }
}
```

Two notes:

- `roles` allows a **mixed pick** (heading from direction A, body from direction B),
  which the concept explicitly calls for.
- **Append, don't overwrite.** Every pick is logged from M1 onward (locally, opt-in). The
  pick-stream is the only asset that compounds per-user (taste memory) and it can't be
  backfilled — so we start capturing it before we need it.

## Key decisions (with rationale)

- **Dev-only in-app injection, not a proxy.** The agent/dev-dependency form factor already
  puts us inside the origin; a proxy solves a problem we don't have and adds real risk
  (header stripping, websocket proxying, HMR breakage). Swapping `--font-*` on `:root`
  survives Fast Refresh for free.
- **Preview precomputes next/font's exact output.** `next/font` is deterministic and
  build-time; we reproduce its primary + adjusted-fallback `@font-face` so the preview is
  the shipped CSS. This is what makes the WYSIWYG promise honest.
- **Catalog is a parity asset, not a taste moat.** The list of font names is not
  defensible; the precomputed parity bundles are the mechanism that makes preview == ship.
- **Curator is LLM-free in v1.** Deterministic lookup + pre-written rationale → no API key,
  no latency, no nondeterminism, no cost inside the package.
- **Catalog standardizes on Google-Fonts families with verified capsize coverage.** Gives
  preview-vs-ship parity for free *and* guarantees the CLS-safe fallback exists at ship
  time. `next/font/local`-only families are a later special case.
- **Codegen = ts-morph (AST) for `.tsx`, fenced markers for CSS/config, backup-first
  undo.** Robust merges into code the user already owns, trivial reversibility for a
  vibe-coder who hasn't committed. Full rationale in [`SHIP-SPEC.md`](./SHIP-SPEC.md).
- **`.font-lab/selection.json` is the contract.** Defined early; the seam that lets the
  pick-side and ship-side proceed in parallel.
- **Engine is a CLI/library first; MCP + skill is a thin wrapper second.** If it works from
  `npx font-lab`, wrapping it for the agent is trivial. MCP-first would couple our hard
  problems to a protocol.
- **Testbeds: both.** A deterministic in-repo `examples/sample-next-site` for day-to-day
  iteration, plus the real `jack-mcgovern.com` as the periodic fidelity check.

## Where impeccable fits

A stack, not a rivalry. impeccable is the **floor** (a critic: "this is generic"); Font
Lab is the **ceiling** (a chooser). Integration is **best-effort, not a dependency**:
impeccable ships no API, no MCP, and no stable report file — the only mechanism is shelling
out to `npx impeccable detect --json` and parsing stdout (whose schema is undocumented, so
we'd pin it against the installed version). Its font rules only *flag* (Inter, Geist, Space
Grotesk, flat hierarchy, single family) — they don't suggest replacements. So impeccable
**seeds the brief** ("you're on slop; you need a display/body pair with more contrast"), not
the directions. It's Apache-2.0, so wrapping and crediting it is clean.

## Risks we're tracking

1. **Capsize coverage gaps** — some Google fonts lack metric data and can't be shipped with
   the CLS-safe fallback. Mitigation: verify coverage per catalog font; measure missing
   metrics ourselves (fontkit). A hard gate on catalog membership.
2. **Preview/ship parity drift** — closed by sourcing identical woff2/subset and replicating
   the adjusted-fallback `@font-face`; verified by pixel-diff in M0.
3. **DCE guard fragility** — the `NODE_ENV` guard must be written inline; wrapping it in a
   helper ships the dev panel to production. Lint-enforce the inline form.
4. **Font-wiring heterogeneity** — hardcoded `font-family` projects get a lower-fidelity
   fallback; v1 is scoped to the CSS-variable path.
5. **Demand / behavioral risk (the real one)** — will people pause to *choose*, rather than
   want a good default? Not answerable in code; tested by dogfooding (see ROADMAP).
6. **Distribution discovery** — "rides the agent wave" is a hope until the skill/tool
   description is tuned so agents reach for us, plus a thin front-door lure for awareness.
