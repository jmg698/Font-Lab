# Font Lab — Architecture

> Engineering companion to [`CONCEPT.md`](./CONCEPT.md). This is the tech-lead view of
> *how* the concept becomes real code. No specs are frozen here — it captures the
> decisions we've made, the seams between pieces, and the one contract everything
> hangs off.

## The crux: how the "choosing moment" actually works

Everything in the concept is ordinary work **except** rendering the user's real,
running site in a candidate font — live, flippable, full-fidelity. If that isn't
magic, there's no product. So it drives the architecture.

The mechanism:

1. **Local reverse proxy.** Font Lab runs a proxy in front of the user's dev server
   (e.g. their `localhost:3000` → our `localhost:4000`).
2. **HTML injection.** The proxy injects a `<style>`/`<script>` into their HTML on the
   way through, and **strips frame-blocking headers** (`Content-Security-Policy:
   frame-ancestors`, `X-Frame-Options`) — safe because it's all local.
3. **Same-origin iframe.** The panel mounts the proxied site in an iframe. Because it
   comes through our proxy, it's same-origin → we can reach into the DOM. No CORS, no
   headless browser, no screenshots.
4. **Font swap = CSS-variable override.** `next/font` exposes fonts as CSS custom
   properties (`--font-sans`, etc.) that Tailwind's `fontFamily` points at. We inject
   CSS that redefines those variables and loads the candidate font → the whole site
   reflows instantly. Flipping directions = toggling which override is active.

This is the entire trick, and it's cheap. It's also *why the agent/dev-tool form
factor beats a bookmarklet* — running inside the project against the local dev server
is what makes full-fidelity preview free.

### The riskiest assumption inside it

- **HMR vs. injection.** Next.js Fast Refresh may re-render and wipe injected styles.
  We need injection that survives HMR (persistent high-specificity `<style>`,
  re-applied on mutation).
- **Font wiring.** Real projects must route fonts through CSS variables for a
  high-fidelity swap. Projects that hardcode `font-family` get a lower-fidelity
  broad-override fallback.

Both are answerable in the M0 spike (see [`ROADMAP.md`](./ROADMAP.md)). M0 is the
go/no-go for the whole concept.

## Monorepo layout

```
font-lab/
  packages/
    catalog/        # the moat: hand-authored fonts + pairings + vibes (pure data)
    analyzer/       # static read of the project: framework, current fonts, font wiring
    curator/        # analysis + vibe -> ~5 directions (catalog lookup; LLM only ranks/explains)
    preview-server/ # THE MAGIC: proxy + header strip + CSS injection + the panel UI
    codegen/        # selection -> exact next/font + Tailwind snippet (the ship step)
    cli/            # `npx font-lab` ties it together
    mcp/            # MCP server + skill so the agent drives all of the above
  examples/
    sample-next-site/  # deterministic Next + Tailwind fixture to develop against
```

Data flows one direction, each arrow a typed contract:

```
analyzer  ->  curator  ->  preview-server  ->  selection.json  ->  codegen
```

Each package stays independently testable; any one can be swapped without touching the
others.

### What each package owns

- **catalog** — Hand-authored font + pairing data (display/body/mono), vibe labels,
  rationale. The human-taste asset. Pure data + types, no logic. The LLM never writes
  to this; it only reads it.
- **analyzer** — Static parsing of the target project: framework, current fonts, site
  type, and *how fonts are wired* (CSS vars vs. hardcoded). Pure functions. This is the
  gamut-engine pattern reused.
- **curator** — Turns `analysis + vibe` into ~5 concrete directions. Catalog lookup for
  the candidates; LLM used **only** to rank and explain, never to invent the list. For
  v1, directions may be hardcoded to keep the LLM off the critical path.
- **preview-server** — The proxy, header stripping, CSS injection, and the panel UI
  (the chrome around the iframe: arrow-key flip, before/after toggle, pin-to-compare,
  "more like this"). The hard package.
- **codegen** — Takes the selection and emits the exact `next/font` + Tailwind snippet,
  so the implementation is reliable, not guessed.
- **cli** — `npx font-lab`; wires analyzer → curator → preview-server and writes the
  selection.
- **mcp** — Thin wrapper exposing the engine as MCP tools + a skill so an agent can
  drive the loop end to end.

## The central contract: `.font-lab/selection.json`

This file is the interface between **"human picked"** and **"agent ships."** The panel
writes it; the agent (via codegen) reads it. We pin this schema early so the two halves
can be built in parallel. Illustrative shape (not frozen):

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
    "styling": "tailwind",
    "fontWiring": "css-variables"
  }
}
```

Note `roles` allows a **mixed pick** (heading from direction A, body from direction B),
which the concept explicitly calls for.

## Key decisions (with rationale)

- **TypeScript + pnpm workspaces.** Standard, fast, fits the npm-dev-dependency
  distribution story.
- **Engine is a CLI/library first; MCP + skill is a thin wrapper second.** If it works
  from `npx font-lab`, wrapping it for the agent is trivial. MCP-first would couple our
  hard problems to a protocol.
- **`.font-lab/selection.json` is the contract.** Defined early; it's the seam that
  lets the pick-side and ship-side proceed in parallel.
- **Catalog is hand-authored; the LLM never invents the list.** LLM ranks and explains
  only. v1 may hardcode directions entirely.
- **Catalog standardizes on Google-Fonts-available families.** Gives preview-vs-ship
  parity for free — identical font files in the iframe preview and in the shipped
  `next/font/google` output. `next/font/local`-only families are a later special case.
- **Testbeds: both.** A deterministic in-repo `examples/sample-next-site` for
  day-to-day iteration, plus the real `jack-mcgovern.com` as the periodic fidelity
  check.

## Where impeccable fits

A stack, not a rivalry. impeccable is the **floor** (a critic: "this is generic, here's
a direction"); Font Lab is the **ceiling** (a chooser). The analyzer/curator can
**consume impeccable's audit as one input** to seed directions, and credit it — making
us interoperable with a tool people already install.

## Risks we're tracking

1. **HMR vs. injected styles** — M0 answers it.
2. **Font-wiring heterogeneity** — hardcoded `font-family` projects get a lower-fidelity
   fallback; v1 is scoped to our own stack.
3. **Preview/ship parity** — solved by sourcing identical font files (the Google Fonts
   decision).
4. **Distribution friction** — bet on the agent wave; CLI-first keeps us honest if MCP
   shifts.
