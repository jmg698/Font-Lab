# RFC — Do display/body/mono survive contact with real sites?

*2026-07-10 · rev 2. Triggered by the jack-mcgovern.com dogfood ("flipping fonts barely
changes the site, and everything classifies as body"). Rev 1 recommended keeping the
variable-wiring model and gating it with measured coverage; on review that fix made the
panel honest but still unable to preview on the majority site shape. Rev 2 removes the
incremental-change constraint and recommends inverting the model.*

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

**2. Preview by painting clusters.** A flip applies the candidate family to a cluster's
elements at the rendering layer: stamp members (`data-fl-cluster`), inject one stylesheet
rule, MutationObserver re-stamps on hydration churn. This is the Snapfont/DevTools
mechanism — the reason those tools work on every site is that the rendered DOM is the one
layer all stacks share. Flipping "headings" changes every heading on every route, islands
included. **Preview becomes structurally unable to fail.** It is also stack-agnostic on
day one: Tailwind v3, Vite, Astro, CSS-in-JS, anything that renders.

**3. Ship as a compiler with a receipt.** The pick becomes a target state ("cluster
`headings` ships in Fraunces"). Ship's job is to make the wiring match it, whatever that
takes: clean variable swap where a healthy seam exists (today's codegen); rewire where the
chain is dead (today's `rewire`, promoted to a compiler pass); *add* wiring where none
exists (mono webfont + var + utility routing); for brand islands, an explicit human
question — "keep /fontlab's own fonts, or adopt the new direction?" — because that is
genuinely a taste call. Mechanical steps run as codegen; non-mechanical steps become a
precise work order for the coding agent that is already in the loop. Then **re-render and
diff against the preview**: a per-element convergence receipt ("100% converged" / "96%,
two spots diverged, here's why"). The honesty invariant moves from *by construction* to
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

Known risks, engineering-tractable: hydration re-renders wiping overrides (observer
re-stamp); cluster granularity (users must see "Headings / Body / Labels," not twelve
groups — needs naming + merge affordances); preview font loading (inject Google Fonts CSS
in dev); partial convergence on hostile wiring (reported, never silent).

## What carries over from rev 1

The census and coverage numbers (now the classifier, not just an auditor), truthful
before-labels, skip-invisible-roles, rewire (as a compiler pass), the post-apply
verification render (now the centerpiece), islands as structured scopes, and consolidating
the duplicated `ROLE_VARS`/`ROLES` constants into one schema module before any of this
lands.

## Sequenced path

- **Spike (days, decides the direction):** census + cluster + paint against the dogfood
  site's dev server. No ship changes. Success = one keystroke changes every heading on `/`
  *and* `/fontlab` simultaneously. If it works on the site that broke the current model,
  the direction is validated on the hardest available evidence.
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
