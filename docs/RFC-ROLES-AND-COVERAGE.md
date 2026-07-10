# RFC — Do display/body/mono survive contact with real sites?

*2026-07-10 · rev 2.1. Triggered by the jack-mcgovern.com dogfood ("flipping fonts barely
changes the site, and everything classifies as body"). Rev 1 recommended keeping the
variable-wiring model and gating it with measured coverage; on review that fix made the
panel honest but still unable to preview on the majority site shape. Rev 2 removes the
incremental-change constraint and inverts the model. Rev 2.1 folds in tech-lead review:
ship scope declared at pick time, cluster identity as a P0 (not a tuning risk), widened
spike exit criteria, and an explicit compatibility contract with the copy-edit feature.*

## Verdict

**The three voices are the right language for humans. Defining them as CSS variables is
the wrong mechanism for machines.**

Display / body / mono as the *curation language* matches industry practice — Tailwind v4
ships `--font-sans/serif/mono`, shadcn uses the same three, Material 3 collapses fifteen
type styles onto two typeface tokens. Two-to-three voices is the right size for a human
choosing moment.

The broken layer is the assumption underneath: **role = a live, root-scoped CSS variable,
and declared implies rendered.** The analyzer resolves "display = Bricolage Grotesque" by
tracing declared variables (`ROLE_VARS`, `analyzer.mjs:24`) and never verifies the token
reaches pixels. On the dogfood site both of these were true at once: the analyzer reported
display = Bricolage, and no heading had ever rendered Bricolage.

## The dogfood was not a quirk

Every failure the dogfood surfaced is an instance of a mainstream pattern:

| What happened | Mechanism | Quirk or recurring? |
|---|---|---|
| Display swaps changed zero pixels | `.variable` classes on `<body>` + `@theme inline` + raw `var(--font-display)` in `@layer base`. The theme token substitutes where the theme is *defined* (`:root`), where the body-scoped leaf var can't resolve → guaranteed-invalid → headings silently inherit body. | **Recurring** — the create-next-app-era shape plus normal agent embellishment, squarely *inside* our declared v1 support matrix. Compiling the site's CSS with Tailwind 4.2.x confirms headings never rendered Bricolage, even before Font Lab arrived. |
| Everything classifies as "body" | Consequence of the above: a dead display chain collapses a 3-voice site into a 1-voice site. | **Recurring** — the modal AI-built site (est. 60–75% of the target market) has body working and display dead, unconsumed, or nonexistent. |
| Mono can't be previewed | `@theme inline` bakes `.font-mono` into a compiled system-stack *literal* — no runtime variable exists to override. | **Recurring** — most Tailwind sites never load a mono webfont, yet mono eyebrow labels are a dominant idiom. |
| /fontlab barely responds | Route-scoped brand island: per-route `next/font` consts on `--fl-*` vars, attached below `<body>`, consumed via inline-style `fontFamily`. | **Recurring** — per-route art direction is normal; 3 of this site's 5 routes are islands. Est. 20–30% of multi-page AI sites contain one. |

Two sharper findings from the audit:

- **The analyzer already detects most of this** (`coverage.deadRoles`,
  `coverage.otherSubsystems`, the `rewire` tool) — but detection terminates in note
  strings while `wiringFor()` hands the panel a live-looking override for a role it knows
  is dead. The silent no-op preview happens *downstream of a correct diagnosis*.
- **Mechanism correction:** modern Tailwind (4.1+) *does* emit `@theme inline` vars at
  `:root` (contra the comment at `analyzer.mjs:369`); the chain dies because `:root`-time
  substitution of a `<body>`-scoped leaf var yields guaranteed-invalid. The corrected
  mechanism also afflicts non-inline `@theme` and preflight `--default-font-family`
  whenever leaf vars ride `<body>`.

## Why rev 1 was not enough

Rev 1 kept the core coupling — preview overrides the exact variable that ship rewrites —
and added measured-coverage gates so the panel refuses instead of no-op'ing. That preserves
"preview == ship by construction," but on the modal site the resulting experience is a
refusal: *"display can't preview until you consent to a rewire."* Truthful, and still not
the product. The choosing moment — seeing candidate fonts on your real site — is the entire
value proposition, and rev 1 leaves it unavailable exactly where the wiring is broken,
which is most of the market. Worse, the "by construction" guarantee was already falsified
in practice: the panel's before/after label claimed a current display font that had never
painted. A guarantee resting on declared-implies-rendered was never a guarantee.

The deeper diagnosis: **one mechanism is doing two jobs** — showing fonts on the real site,
and guaranteeing shipped code matches. Coupling them makes the preview inherit every flaw
in the site's wiring. The fix is to decouple.

## The model: render-first classification, painted previews, compiled ship

**1. Classify by what renders, not what's declared.** Render the site (dev server +
headless Chromium — plumbing already exists for screenshots), walk every visible text
element, read computed font/size/weight, and cluster "similar text" into the site's actual
voices. On the dogfood site the census finds: headings-rendering-as-body (dead chain,
exposed immediately), body copy, mono eyebrow labels, and the `--fl-*` island as its own
cluster. Clusters are the real roles; display/body/mono become *labels mapped onto
clusters* so curation still speaks a small human language. Sites with two voices or six
both fit. Wiring is irrelevant to classification — the census reads what eyes read. The
panel's existing sentinel scan (`font-lab-panel.tsx:184-202`) is this machinery in embryo,
promoted from receipt to classifier.

**Cluster identity is a P0, not a tuning knob.** Computed style alone is insufficient in
both directions, and the dogfood site proves the harder one: on the dead-chain home page,
headings and body copy render the *same* family, so family-only clustering would merge
them — collapsing exactly the distinction the user needs to flip. A cluster's identity is
therefore the triple **(rendered style, structural role, provenance)**: computed
family/size-band/weight, element role (heading-like vs copy vs label), and *where the text
comes from* — which wiring subsystem (global roles, `--fl-*` island, inline style) and
which source call-site. Provenance comes free from the React debug-stack resolver the
copy-edit feature already uses to map DOM text to JSX (`font-lab-panel.tsx:790-797`); it
is what separates "h1 on `/`" from "Headline on `/fontlab`" (same visual voice, different
ship target) and keeps clusters stable across renders. The UX groups clusters under voice
labels with a merge affordance; spike exit criteria below cap cluster counts so this
cannot regress into a twelve-group inspector.

**2. Preview by painting clusters.** A flip applies the candidate family to a cluster's
elements at the rendering layer: stamp members (`data-fl-cluster`), inject one stylesheet
rule, MutationObserver re-stamps on hydration churn. This is the Snapfont/DevTools
mechanism — the reason those tools work on every site is that the rendered DOM is the one
layer all stacks share. Flipping "headings" changes every heading on every route, islands
included. **Preview becomes structurally unable to fail.** It is also stack-agnostic on
day one: Tailwind v3, Vite, Astro, CSS-in-JS, anything that renders.

**3. Ship as a compiler with a receipt — scope declared at pick time.** The pick becomes
a target state ("cluster `headings` ships in Fraunces"). Ship's job is to make the wiring
match it: clean variable swap where a healthy seam exists (today's codegen); rewire where
the chain is dead (today's `rewire`, promoted to a compiler pass); *add* wiring where none
exists (mono webfont + var + utility routing); for brand islands, an explicit human
question — "keep /fontlab's own fonts, or adopt the new direction?" — because that is
genuinely a taste call. Honest framing (per tech-lead review): **paint solves the choosing
moment; ship is a compiler where the path is paved and an agent work order + receipt
everywhere else** — on hostile wiring it is not one command, and we do not pretend it is.

Two consequences. First, **ship scope is part of the pick, not a surprise in the
receipt**: because every cluster carries provenance, the panel can show *at flip time*
what a direction touches — "this changes the global roles (`layout.tsx`, `globals.css`);
the `/fontlab` island keeps its own fonts unless you include it." Simple UX: a
global-pick / full-site-pick choice, backed by per-cluster detail. A receipt reading "62%
of headings converged" must be impossible as a *surprise*; if scope was declared, the
receipt only ever confirms a contract the user already saw. Second, partial convergence is
a **first-class UX state** — named residue with next steps ("2 spots need the agent:
here's the work order"), not a footnote. Then **re-render and diff against the preview**:
a per-element convergence receipt. The honesty invariant moves from *by construction* to
*by verification* — strictly stronger, because it is measured on pixels instead of assumed
from source.

## Why this holds up

- Every piece is individually proven: cluster-and-paint is battle-tested by every font
  extension (visually, they never fail — they just can't ship); the census is the sentinel
  scan generalized; rewire exists; the receipt is a re-census diff.
- The one new bet — "ship can always converge to the preview" — is underwritten by the
  agent-in-the-loop form factor plus the receipt. Codegen covers the mechanical majority;
  the agent executes the work order; the receipt makes any residue visible. No silent
  failure mode survives.
- Scalability: all per-stack cost concentrates in the ship compiler, which degrades
  gracefully (full auto → agent work order → manual instructions) without ever degrading
  the choosing moment. Widening beyond Next+Tailwind stops being a preview problem.

Known risks, engineering-tractable: hydration/HMR re-renders wiping overrides — managed,
not solved: the paint loop needs real budget, though the discipline already exists in
shipped form (the panel runs a debounced, self-excluding body-wide MutationObserver today,
`font-lab-panel.tsx:209-214`); preview font loading (inject Google Fonts CSS in dev);
partial convergence on hostile wiring (reported, never silent, scoped up front).

## Coexistence with copy editing (hard constraint)

The double-click-to-retype feature works well and must keep working. How it works today:
the panel resolves the rendered text run to its JSX call-site via React 19 debug-stack
frames (`font-lab-panel.tsx:790-797`), edits in a `contentEditable` host, and
`copyedit.mjs` rewrites the exact `JsxText` node via ts-morph — backup-first, refusal on
ambiguity. Its two dependencies are **React debug frames** and **text-run identity**.
Paint threatens neither, provided one contract holds:

**Paint is style-only.** It stamps existing elements with a cluster attribute and injects
stylesheet rules. It never wraps text runs, never inserts or replaces nodes, never touches
`textContent`. (This also rules out the Snapfont-style per-text-node span wrapping — the
one paint implementation that *would* break `editableRunAt`'s sole-text detection.)

Guards, all cheap: the paint observer ignores mutations inside panel-owned nodes (the
existing `OURS` filter), ignores the copy-edit wrap span (`data-fl-edit-wrap`), suspends
re-stamping while an edit is active (`editingEl` non-null), and filters its own attribute
writes to avoid observer feedback. One real interaction to handle: a font flip mid-edit
changes metrics and can shift the caret's line-wrapping — so flips commit or cancel an
active edit first.

And one synergy that makes the constraint an asset: the debug-stack call-site resolver
copy edit already owns is exactly the **provenance** signal cluster identity needs and the
**work-order targeting** ship needs ("this cluster's text lives in `app/fontlab/page.tsx`").
One DOM→source spine, shared by both features, instead of two parallel mappings that can
drift.

## What carries over from rev 1

The census and coverage numbers (now the classifier, not just an auditor), truthful
before-labels, skip-invisible-roles, rewire (as a compiler pass), the post-apply
verification render (now the centerpiece), islands as structured scopes, and consolidating
the duplicated `ROLE_VARS`/`ROLES` constants into one schema module before any of this
lands.

## Sequenced path

- **Spike (days, decides the direction):** census + cluster + paint against the dogfood
  site's dev server. No ship-code changes. Exit criteria (per tech-lead review — the spike
  validates the preview half AND must not lie about the ship half):
  1. **Preview:** one keystroke changes ≥90% of visible heading-like text on `/` *and*
     `/fontlab` (manual eyeball + automated count from the census).
  2. **Stability:** paint survives HMR, scroll-in lazy content, and panel open/close
     without losing or duplicating overrides.
  3. **Cluster sanity:** ≤3–4 clusters on `/`, ≤5 on `/fontlab`, with labels a human
     recognizes ("Headings", "Body", "Labels", "/fontlab serif") — granularity is P0.
  4. **Copy edit intact:** double-click retype on a *painted* heading on both routes;
     save and undo round-trip cleanly; no caret jumps from the paint loop.
  5. **Ship-truth stub (no new ship code):** pick a direction, run the existing `apply`,
     re-census, and show the receipt — it must truthfully report what converged on `/`
     and what `/fontlab` would *not* get, without lying. One full ship+receipt cycle on
     this repo before the direction is called validated.
- **Also, independent of the spike: ship rev 1's v1.1 honest-refusal patch now** (dead
  roles reach the panel as non-swappable-with-reason, denominator fix, truthful
  before-labels). Low-risk, stops the active lying while the spike proceeds.
- **v2.0 — choose plane:** panel rows become clusters (mapped to voice labels); screenshots
  render painted clusters; curation maps directions onto clusters.
- **v2.1 — ship plane:** target-state compiler (swap / rewire / add-seam passes + island
  question), agent work orders for the remainder.
- **v2.2 — receipt:** post-apply re-census diff as the standard ship output.
- **v2.3+ — widen stacks:** preview already works everywhere; add wiring adapters
  (Tailwind v3, plain CSS, Vite/Astro) one at a time.

## What we explicitly do not do

We do not gate the *preview* on the site's wiring health ever again — that was rev 1's
mistake, inherited from v1. And we do not ship on hope: no pick lands without a
convergence receipt. Where ship can't fully converge, the product says so with the
residue named — honesty stays, but it moves to the only place it can actually be
guaranteed: measured pixels.
