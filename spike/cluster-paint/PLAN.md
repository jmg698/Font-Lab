# Spike: cluster + paint (render-first preview)

*First step of `docs/RFC-ROLES-AND-COVERAGE.md` rev 2.1. Decides whether Font Lab's
preview should move from variable-overrides to render-first cluster painting.*

## Thesis under test

A census of the **rendered** page can (a) discover the site's real typographic voices as
clusters — including text the variable model can't see (dead chains, inline-style islands,
system-stack mono) — and (b) preview a font on *every similar text* by painting clusters,
on the exact site that defeated the variable model (jack-mcgovern.com). Ship stays the
existing pipeline; this spike only has to prove the preview half and *tell the truth*
about the ship half.

## What gets built

- `census.js` — injected browser script, framework-free. Walks visible text elements,
  classifies each into a structural voice (heading / body / label) with provenance
  (inline-style island vs global, route bucket from the React call-site chunk), clusters
  by **(family, voice, provenance)**, stamps members with `data-flc`, paints via one
  injected stylesheet (`[data-flc="…"]{font-family:… !important}`), and re-stamps new
  nodes through a debounced, self-excluding MutationObserver that suspends during an
  active content edit. **Style-only contract: no node is created, moved, wrapped, or
  text-edited — ever.**
- `run.mjs` — Playwright driver. Boots the target's dev server, runs the exit criteria on
  `/` and `/fontlab`, and writes `out/report.json` + a console summary. Reuses the
  production pieces the RFC names: the fiber `_debugStack` call-site technique
  (panel), source-map frame resolution (`font-lab.mjs resolveFrame`), and
  `copyedit.mjs applyEdit/undoEdit` for the real edit round-trip.

## Exit criteria (from RFC rev 2.1, tech-lead reviewed)

1. **Preview** — one flip changes ≥90% of visible heading-like text on `/` *and*
   `/fontlab`, counted by the census (computed-family check + a glyph-metrics sanity
   signal, since specified ≠ loaded).
2. **Stability** — paint survives HMR (a real file touch), scroll-in content, and a
   clear/re-flip cycle without losing or duplicating overrides.
3. **Cluster sanity** — ≤4 clusters on `/`, ≤5 on `/fontlab`, labels a human recognizes.
4. **Copy edit intact** — on a *painted* heading: DOM structure is byte-identical before
   and after paint, the call-site frame still resolves, and a real
   `applyEdit` → HMR → `undoEdit` round-trip lands with paint surviving it.
5. **Ship-truth stub** — no new ship code: run the existing `apply` (spike selection of
   verified Google families), re-census, and produce a receipt that truthfully reports
   per-voice convergence per route — expected: body converges on `/`, display does NOT
   (dead chain) until the existing `rewire` runs, `/fontlab` island stays unreached.
   One full ship+receipt cycle on the real repo, then everything restored
   (`git checkout` + selection backup; apply/rewire are backup-first anyway).

## Non-goals

No panel UI, no curation changes, no new ship code, no cluster-merge UX (counts are
capped by criterion 3 instead). Exact per-file provenance via source maps is proven by
the copyedit round-trip but not wired into clustering yet (route-bucket + inline-style
provenance is enough for this site); that wiring is v2.0 work.

## Verdict rubric

All five pass → RFC direction validated on the hardest available evidence; proceed to
v2.0 (panel rows become clusters). Criterion 1 or 4 fails → the direction as designed is
dead or needs a different paint mechanism; stop and rethink before any product code.
