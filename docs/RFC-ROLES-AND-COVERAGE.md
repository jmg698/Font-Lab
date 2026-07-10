# RFC — Do display/body/mono survive contact with real sites?

*2026-07-10 · triggered by the jack-mcgovern.com dogfood ("flipping fonts barely changes the
site, and everything classifies as body"). This is the pre-release answer to: is our
categorization model right, and is there a smarter, more scalable way?*

## Verdict

**The taxonomy is right. The detection layer under it is the fragile part.**

Display / body / mono as the *curation and shipping language* matches industry practice —
Tailwind v4 ships `--font-sans/serif/mono`, shadcn uses the same three, Material 3 collapses
its fifteen type styles onto two typeface tokens. Two-to-three typeface voices is the modal
shape of real sites, and it's the right size for a human choosing moment.

What broke on the dogfood is not the categories. It's the assumption one layer down:

> **role = a live, root-scoped CSS variable, and *declared* implies *rendered*.**

Font Lab currently resolves a role by tracing declared variables (`ROLE_VARS`,
`analyzer.mjs:24`) through the custom-property graph. It never verifies that the token
reaches pixels. That's the gap between "the analyzer says display is Bricolage Grotesque"
and "no heading on the site has ever rendered Bricolage Grotesque" — both were true at once
on jack-mcgovern.com.

## The dogfood was not a quirk

Every failure the dogfood surfaced is an instance of a mainstream pattern. Classified:

| What happened | Mechanism | Quirk or recurring? |
|---|---|---|
| Display swaps changed zero pixels | `.variable` classes on `<body>` + `@theme inline` + raw `var(--font-display)` in `@layer base`. The theme token is substituted where the theme is *defined* (`:root`), where the body-scoped leaf var can't resolve → guaranteed-invalid → headings silently inherit body. | **Recurring** — this is the create-next-app-era shape plus normal agent embellishment, squarely *inside* our declared v1 support matrix. Compiling the site's CSS with Tailwind 4.2.x confirms headings never rendered Bricolage, even before Font Lab arrived. |
| Everything classifies as "body" | Consequence of the above: a dead display chain collapses a 3-voice site into a 1-voice site. Body swaps drag headings along. | **Recurring** — the modal AI-built site (est. 60–75% of the target market) has body working and display dead, unconsumed, or nonexistent. |
| Mono can't be previewed | `@theme inline` bakes `.font-mono` into a compiled system-stack *literal* — there is no runtime variable to override. | **Recurring** — most Tailwind sites never load a mono webfont, yet mono eyebrow labels are a dominant idiom. |
| /fontlab barely responds | Route-scoped brand island: per-route `next/font` consts on `--fl-*` vars, attached to divs below `<body>`, consumed via inline-style `fontFamily`. Outside the role graph entirely. | **Recurring** — per-route art direction (marketing pages, docs subsites, demo widgets) is normal; 3 of this site's 5 routes are islands. Est. 20–30% of multi-page AI sites contain one. |
| /fonts page immune | Font names flow through JS data into `style` attributes. | Page itself is a quirk; the *mechanism* (typography as JS data) recurs. |

Two sharper points from the audit:

- **The analyzer already knows.** `coverage.deadRoles` catches the dead chain,
  `coverage.otherSubsystems` catches the islands, and `rewire` can repair raw
  `var(--font-role)` usages. But detection currently terminates in a *note string*, while
  `wiringFor()` hands the panel a live-looking override for a role it knows is dead. The
  worst failure — a silent no-op preview — happens *downstream of a correct diagnosis*.
- **One mechanism correction.** The comment at `analyzer.mjs:369` says Tailwind v4 doesn't
  publish `@theme inline` vars to `:root`. Current Tailwind (4.1+) *does* emit them; the
  chain is dead because `:root`-time substitution of a `<body>`-scoped leaf var yields
  guaranteed-invalid. Same symptom, different mechanism — and the corrected mechanism also
  afflicts **non-inline** `@theme` and preflight `--default-font-family` whenever leaf vars
  ride `<body>`. Detection should key on "leaf var scoped below the resolution point," not
  on the `inline` keyword.

## The principle we adopt

**A role must earn its place with a measured number.** Not "the variable graph resolves,"
but "this token controls N% of visible text on this route." Prior art splits into preview
tools that read *rendered* truth but can't ship (Snapfont, DevTools) and token systems that
read *declared* truth and routinely diverge from pixels (every design-token system). Nobody
joins the two. That join — rendered-usage census attributed back to the declared seam, with
coverage percentages gating what we'll preview and ship — is the honest version of Font Lab,
and it's a genuine moat, because "preview == ship" was already our differentiator and
coverage is what makes it *true* rather than assumed.

Roles stay the language humans choose in. Coverage becomes the license to preview.

## Design: coverage-gated roles (with four grafts)

Three architectures were drafted and adversarially judged: (A) keep declared roles, add
measured coverage as a gate; (B) invert to render-discovered slots mapped back onto the
three voices; (C) a two-plane split — Snapfont-style always-truthful preview plane plus a
"shippability compiler." **A won** — it's the only one where preview keeps overriding the
exact seam that apply rewrites, so preview == ship stays true *by construction* rather than
by instrumentation. C was rejected as the default preview because it deliberately shows
swaps the wiring plane may not be able to ship — the exact dishonesty we exist to prevent.
B contributed the best ideas about islands and discovery, grafted below.

**The spine.** Keep `ROLE_VARS` as the shipping language and the static var-graph as the
seam-finder. Add a render layer: `font-lab audit` boots the dev server headlessly (the
Chromium plumbing from screenshots already exists), enumerates routes, and runs the panel's
sentinel trick server-side — perturb each role's wiring var, walk visible text nodes, and
attribute each element to a role by computed `fontFamily`. Output per route, per role:
**rendered coverage %**. That number gates everything:

- a 0%-coverage role renders in the panel as *dimmed, with the reason and the fix* ("display
  is declared but dead — run rewire"), never as a live flip that changes nothing;
- `replaces` reports what actually renders, so the before/after label stops claiming the
  site "currently has" a font that never painted;
- apply **skips** a 0-reach role by default ("no mono text renders on this site — skipping")
  instead of shipping an invisible font behind `codegen will add one`;
- the panel's coverage denominator includes *unattributed* text, surfacing "N% of this page
  is not controlled by any role" — today that text silently vanishes from the stats, which
  makes exactly the broken sites look fine.

**Graft 1 — islands become scopes, not warnings** (from B). Promote `otherFontSubsystems`
output from note strings to structured scope records: `{ vars, attachEl, declaringFile,
routes, coverage }`. Generalize the panel's override target from the `html|body` binary to a
scope-root selector, and an island wired through vars (like `--fl-*`) becomes *previewable*
— overriding `--fl-serif` on the island's root is seam-honest for inline-style `var()`
consumers. Scoped apply follows later; until then the island is an *honest, named exclusion*
("this direction won't touch /fontlab — it has its own font system"), which is exactly what
a deliberate brand island wants.

**Graft 2 — dead-chain repair joins the paved path.** `rewire` stops being a footnote: when
audit finds a dead role, the skill offers rewire as the guided first step of the flow, and
rewire extends beyond the single CSS entry to every file with a dead raw usage. Detection
switches to the corrected mechanism above.

**Graft 3 — post-apply verification render** (from C). After apply, optionally re-census a
scratch build and assert measured reach actually moved. Upgrades "ship succeeded = files
written" to "ship succeeded = pixels changed," and it's the version-proof answer to Tailwind
point-release drift.

**Graft 4 — one schema to rule the roles.** `ROLE_VARS`/`ROLES` are duplicated across
analyzer, codegen, engine, curator, and the panel template. Consolidate into a shared module
*before* any of this lands, so `scopes[]` and coverage fields have a single owner.

## Sequenced roadmap

- **v1.1 — static honesty (days, no new deps).** `wiringFor()` consults the
  already-computed `coverage.deadRoles` → dead roles reach the panel as
  non-swappable-with-reason. Panel denominator counts unattributed text. `replaces` labels
  rendered truth. This alone kills the silent no-op preview on jack-class sites.
- **v1.2 — audit + scopes.** Headless per-route census, coverage % in analysis and panel,
  scope records for islands, skip-invisible-roles default in apply.
- **v1.3 — reach.** Island var-preview via scope roots; multi-file rewire; mono via a
  verified compiled-seam override (inject a dev-only `.font-mono` var seam, clearly labeled
  "adds wiring on ship").
- **v1.4 — receipt.** Optional post-apply verification render.
- **v2 — scoped apply** (per-island ship), and only then consider widening the stack matrix
  — the census layer is stack-agnostic, which is what makes Tailwind v3 / Vite / Astro
  *cheaper* to add later, not harder.

## Open question

The **missing-role preview**: single-font starters have no display seam at all, so the
highest-value move — introducing a display voice — currently ships blind. Candidate: preview
by injecting the same dev-only seam codegen would ship (a heading-selector rule routing
`h1–h3` through the new var), labeled as "this adds wiring." It's seam-honest but it *is* a
wiring opinion; needs its own small spike.

## What we explicitly do not do

No Snapfont-style computed-style override as the default preview. It would make every site
"work" in the panel while quietly breaking preview == ship — the one promise that makes this
product different. Where there is no seam, we refuse loudly, name the reason, and pave the
path. That's the honesty, not a bug.
