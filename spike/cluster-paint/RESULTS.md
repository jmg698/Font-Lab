# Results — cluster + paint spike

*2026-07-10 · run against jack-mcgovern-site (Next 15.5.19, Tailwind v4, React 19) — the
dogfood site that defeated the variable-override model. **All five exit criteria pass.***

```
PASS  c1_preview        heading flip → 100% of heading chars on / AND /fontlab, glyph metrics moved
PASS  c2_stability      100% through scroll, real HMR touch, revert, clear+re-flip
PASS  c3_clusterSanity  3 clusters on /, 4 on /fontlab, human-readable labels
PASS  c4_copyEdit       full applyEdit→HMR→undoEdit round-trip on painted headings, both routes
PASS  c5_shipTruth      receipt truthfully reports dead-chain 0% → post-rewire 100%, island untouched
PASS  c5_restore        target repo byte-identical after the ship cycle (git-verified)
```

Reproduce: `node spike/cluster-paint/run.mjs --project <site>` → `out/report.json`.

## What the census saw (this is the thesis, working)

```
/         c0 Bodys    — Hanken Grotesk   81.8%   (15 els)
          c1 Headings — Hanken Grotesk   15.2%   (13 els)   ← dead display chain, caught live
          c2 Labels   — Hanken Grotesk    2.9%
/fontlab  c0 Labels   — ui-monospace     90.3%   (101 els)  ← fl-scope chrome
          c1 Headings — Instrument Serif  5.9%   (inline)   ← island, via inline-style provenance
          c2 Bodys    — Hanken Grotesk    2.0%   (inline)
          c3 Bodys    — Instrument Serif  1.8%   (inline)
```

"Headings — Hanken Grotesk" on `/` is the RFC's P0 clustering case proven: headings render
the body family (dead `--font-display` chain), so family-only clustering would have merged
them — the (style, structure, provenance) triple kept them separate and flippable.

One keystroke (`flipVoice("heading", …)`) then changed **100% of heading characters on both
routes**, including the island's inline-styled serif headings — the thing the variable
model structurally could not do. Georgia was used as the paint family so the proof needs no
network; rendered-glyph movement was asserted via Range-measured text widths.

## Ship-truth receipt (existing apply + rewire, zero new ship code)

```
/         after apply:   heading 0%   body 100%   ← the dead chain, told truthfully
          after rewire:  heading 100% body 100%   ← existing rewire closes it
/fontlab  both phases:   heading 10.6%            ← island honestly unreached
```

Exactly the RFC story: paint previews everything; ship converges where the path is paved,
and the receipt names what it didn't touch instead of silently no-op'ing.

## Copy-edit compatibility (the hard constraint)

- Paint is style-only: the probed headings' DOM structure was **byte-identical** before and
  after paint on both routes.
- A real edit ran through production `applyEdit` → fast refresh updated the page → paint
  held at 100% → `undoEdit` restored source. On `/` the call-site resolved via a debug
  frame + dev source map; on `/fontlab` via the unique-phrase fallback.
- Notable: on this stack, fibers of server-component elements carry **no `_debugStack`** —
  the phrase fallback (production's second path) is what carried resolution. Exact-file
  provenance for clustering should therefore come from the same fallback chain, not fibers
  alone.

## Real-world finds worth acting on (independent of this spike)

1. **Site CSP is a first-class hazard for any preview plane.** This site's
   `next.config.mjs` sends a strict CSP in dev too; `connect-src 'self'` +
   `upgrade-insecure-requests` silently kill the Next HMR websocket in ANY browser, and
   `font-src 'self'` will block externally-loaded preview webfonts. The spike bypassed it
   (Playwright `bypassCSP`); the product must detect a dev CSP and warn or neutralize it,
   or panel previews on CSP'd sites will quietly show fallback fonts. Worth checking how
   the panel loads preview fonts on this site today.
2. **`apply.mjs` crashes after a successful apply** printing its summary: the css-entry
   branch returns `selfHosted: {dir, fonts}` (codegen.mjs:595) but the next-font branch
   returns a bare array (codegen.mjs:698); `r.selfHosted.fonts.length` throws when the
   array is empty-but-truthy. Cosmetic, but it exits non-zero after editing files.
3. **`restamps: 0` during HMR** — Next preserved the existing DOM nodes for a
   comment-touch, so stamped attributes survived without the observer's help; the observer
   earned its keep on the copy-edit path instead. Fuller remount churn (component-level
   edits) is future test surface.

## Verdict

The render-first model — census → clusters → paint, ship via existing pipeline + truthful
receipt — is validated on the hardest available evidence, with the copy-edit contract
intact. Per PLAN.md's rubric: proceed to v2.0 (panel rows become clusters), with the CSP
find added to the product backlog.
