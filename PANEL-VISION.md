# Galley — the definitive Font Lab panel

> "Galley" is this design's internal codename. The product surface says only **FONT LAB** —
> one tool name, and a strict glossary: **direction** (a curated set of three), **role**
> (display / body / mono), **font** (the candidate you cycle, "font 3 of 5"). Every string in
> the panel uses these three nouns and no synonyms.

> The unconstrained answer to "what is the absolute best version of this panel?" — synthesized
> from a five-concept design exploration (specimen sheet, hardware console, page x-ray,
> editorial companion, darkroom contact sheet) judged from three lenses (founder taste, design
> craft, daily use). This doc is the spec; `spike/panel-galley/prototype.html` is the living,
> clickable version of it.

## The diagnosis

The current panel — and v0's competing take — both treat the **panel** as the product. But the
panel's real job is to make **judging type on the real page** effortless, and both named pains
are the same failure: *the panel and the page are strangers.*

- "If we hovered over something in the site and it would illuminate what kind of font that
  belongs to" — the page can't answer questions.
- "It's hard to tell when you flip fonts what actually changed… almost all fonts were body" —
  the page changes silently, and the panel doesn't say what moved (or, just as important,
  what *didn't*).

And the identity failure has a specific cause: the current chrome is Tailwind-default colors
(`#26262e`, `#2563eb` blue) in system sans — a typography product whose own surface has no
typographic opinion. That's why it reads "generic SaaS / vibe-coded" no matter how the boxes
are arranged.

## The organizing idea

**The panel is a galley proof — the editor's proof slip clipped to the page before it goes to
press.** Every region maps to a real editorial form, every act to a proofing act:

| Region | Editorial form |
| --- | --- |
| Title bar | A **masthead** — living `Aa` badge set in the current working display face, wordmark, presence dot |
| Direction chips | A **table of contents** — folio numbers, names set in their own display faces, dotted leaders, vibe words |
| Role rows | A **specimen spread** — the face at size, a standfirst tagline, live coverage stats |
| Rationale | A **standfirst** in serif italic |
| Compare | A **proof bar** — GALLEY / BEFORE / A / B, four proofs of the same page |
| Pick | **Passing the proof for press** — then a drawn checkmark, nothing louder. A quiet `⇄ before` toggle sits beside it — compare the proof where you pass it |
| Footer | A **colophon** — one line: the 3-key spine (`←→` direction · `↑↓` role · `[ ]` font), a `? keys` door, version. The full key reference is the **back page**: an overlay you flip to (`?`), grouped by proofing act, shown once in full on first run |

The metaphor is load-bearing, not costume: it dictates the color grammar, the two-voice
typography, and the vocabulary (`galley`, `proof`, `press`) — and it gives Font Lab the brand
it doesn't have. This is the only surface most users ever see; it *is* the company's visual
identity.

## The design system

### Color — one accent, with a grammar

| Token | Value | Meaning |
| --- | --- | --- |
| INK | `#100F0D` | Panel ground. Warm near-black — deliberately off the Tailwind-zinc axis. |
| INK-2 / INK-3 | `#191813` / `#232219` | Wells, hovers, the badge. |
| PAPER | `#F2EFE5` (dim at 60%) | All text. Unbleached stock, not blue-white. |
| HAIRLINE | `rgba(242,239,229,.14)` | Every rule and border. |
| **MARKER** | `#E7FF3B` | **The editor's hand — attention and action, never decoration.** Appears only at: the active direction's folio + underline, the focused role's margin bar, the change-flash on the page, the shown proof tab, the Pick button, the drawn check. When you view BEFORE or a pin, the galley's own markers *go quiet* — yellow always follows what the page is showing. |
| CORAL | `#E98A6D` low-chroma | Every honesty caution: `≈` parity, fidelity line, stale card, endpoint errors. Heads-up, not on fire. Structurally never confusable with attention. |
| WIRE | `#6EE7A0` | Agent-listening pulse and shipped-good status only. |

The founder's instinct about v0's yellow was right — but committing to a color means giving it
*rules*, not spraying it. Yellow-as-grammar is what separates "picked a color and ran with it"
from decoration.

### Type — two voices, zero sans-serif

- **Data voice**: `ui-monospace` with tuned tracking — labels, folios, counters, status,
  keycaps. Tabular numerals everywhere digits align.
- **Editorial voice**: a serif italic (ship **Instrument Serif**, OFL, as two ~14KB base64
  woff2 ASCII subsets injected alongside the catalog faces — same pattern, family-namespaced
  `FL UI Serif`) — the standfirst rationale, per-role taglines, the word *Galley*.
- **The borrowed voice**: candidate family names render as specimens **in their own faces**
  (display 20–21px / body 15–16px / mono 13–14px), and TOC direction names render in that
  direction's display face — the contents page is itself a specimen sheet. The chrome takes a
  vow of silence so the candidates are the only expressive type on the surface.

A typography tool whose own chrome pairs a serif italic against a mono — with no sans-serif
anywhere — cannot be mistaken for a Vercel/Linear clone.

## The two centerpieces (the founder's pains, solved structurally)

Both are powered by one verified primitive: **the sentinel scan**. The panel already owns the
role variables; append a sentinel fallback family to each value it sets
(`…, __fl_role_display`). Any element's `getComputedStyle().fontFamily` then names the role
variable it actually consumes — ground truth, zero visual effect, zero deps, cached and
re-stamped by a debounced MutationObserver.

### 1. Role clarity — the page answers questions

- **Panel → page**: hover any role row → every element of that role illuminates (marker
  underline + 13% tint, element-level classes so it's scroll-proof), with a docked count tag:
  `BODY — 214 elements · 91% of text on this page`.
- **Page → panel (Inspect — ON BY DEFAULT, no mode)**: hover any text on the live site
  (160ms dwell) → a quiet underline + an ink chip names it: `DISPLAY · Fraunces · 40px ·
  4 on page`, and the matching role row takes focus in the panel. No clicks are ever
  intercepted — the site stays fully usable. Because hover *is* focus, `[` / `]` flips the
  role you're pointing at: point at your own headline and flip it, no lock step, no mode.
  The ⌖ toggle lives in the masthead (pressed = paper, never resting yellow); `X` toggles it
  off for people who find hover chips noisy.
- **Keyboard parity**: moving role focus with `↑↓` fires an ~800ms pulse of that role's
  page highlight, so keyboard users get the same panel→page mapping for free.
- **Shift+X — the full map**: all roles at once, focused role in marker, others outlined with
  `D`/`B`/`M` chips (letters always present; color is never the only channel).
- **Always-on**: every role row carries a live coverage stat — `73% of page text`,
  `4 spots on this page`. On a body-heavy page the panel explains the Artificial-Insights
  confusion *before it happens*.

### 2. Change legibility — no flip is ever silent

Every flip (face, direction, or proof switch) fires four redundant layers:

1. **The flash** — only elements whose resolved family actually changed run a ~600ms marker
   sweep, staggered by role and softened to a light wash when most of the page changes at
   once, so a full-direction flip reads as extent, not an explosion (reduced motion: static
   tint, one-step removal). Absence is information: unchanged text does not flash.
2. **Row verdicts as the receipt** — no separate ledger strip (it read as clutter in
   testing). For ~2.5s after a flip, each role row's own stat line becomes its verdict —
   `→ 4 spots changed` on changed rows, an explicit `unchanged` on the others — so
   non-change is asserted as loudly as change, in the place you're already looking. The
   status line carries the global receipt: `23 elements changed · 6 below ↓ · ↺ replay`,
   with the honest zero case (`0 in view — J jumps to nearest`).
3. **Edge ticks** — 2×14px marker ticks on the right viewport edge at each changed element's
   position, clickable to scroll, ~4s. Changes below the fold are never silent.
4. **The name beat** — changed rows' font names take the marker color for a beat and fade
   back; unchanged rows dim briefly. One glance at the spread shows which of the three moved.
   The masthead `Aa` flipping (or not) is the peripheral fourth signal for display.

## Compare — the list IS the comparison

An earlier draft had a four-tab "proof bar" (GALLEY / BEFORE / A / B) with pin slots. It was
coherent and it was a second selection system to learn — founder testing killed it. The
replacement folds comparison into the direction list itself, one mental model:

- **`space` — snap back.** Toggles between the direction you're viewing and the one you
  viewed last (alt-tab semantics, zero setup). Click your two finalists once each, then tap
  space repeatedly and watch the page flicker between them — with the change-flash marking
  exactly what differs, that *is* A/B comparison.
- **`S` — save a mix.** A hand-mixed trio (the `MIX` state) saves as a real row in the list
  (`06 Mix 01 ····· your mix`), named in its own display font like every other row. Mixes
  are then comparable, pickable, and snap-back-able like anything else — no frozen-snapshot
  concept, no "editing a copy of A." Its on-screen control is the standfirst sentence
  itself — *"save this mix as a direction"* is a live link, present exactly when there is a
  mix to save (never a scolding dead-end button).
- **`B` — before.** Tap toggles the site's current fonts, **hold (>400ms) peeks** and
  springs back — the blink-comparator. Both directions fire the change machinery. (It's
  "snap back to row 00," but it earns its own key.) Its on-screen control is the `⇄ before`
  toggle beside Pick (pressed = paper, like the inspect toggle — compare is neither the
  hand nor a caution).
- **Pick always picks what the page is showing.** The only guard left: viewing Current or
  before disables it with a stated reason (`Viewing before — flip back to pick.`).

## Copy edits on the same proof (the text-edit brief, integrated)

The inspect layer is the entry point the inline-copy-editing spike needs (see
`spike/text-edit` — React 19 `_debugStack` → source map → ts-morph write-back, proven):

- The inspect chip's second line already teaches it: `[ ] flips this text · double-click
  retypes it`.
- **Double-click any words → retype in place** (`contenteditable`, plaintext-only). `⏎`
  saves — the panel narrates `Saved ✓ page.tsx:35 — words are in your source · undo` — and
  `esc` cancels. Single clicks are never intercepted.
- **Soft-degrade honesty**: dynamic text (`{post.title}`, mapped lists) gets `comes from
  data — not editable` in the chip and a coral status line on attempt — refuse and explain,
  never guess (the brief's own principle, in the panel's existing coral grammar).
- Panel shortcuts suspend automatically while typing (the contentEditable guard).
- Editorially the metaphor strengthens: marking up copy is exactly what an editor does on a
  galley proof. Same loop, same honesty, same undo muscle — pointed at words.

## Honesty states (all inherited, restyled into the system)

- Presence: `OFFLINE · NPX FONT-LAB` (hollow dot) / `ENDPOINT READY` (paper dot) /
  `AGENT LISTENING` (wire-green pulse) + the existing narrated tooltips.
- `≈` best-effort: the coral hairline tag on the row is the **permanent** honesty surface —
  it names *which* role is approximate and never fades (a caution that times out is a
  caution that can be missed; the earlier auto-quieting fidelity band was deleted for
  exactly that reason). The full sentence — `≈ close preview — Fraunces may differ slightly
  once shipped.` — lands once in the status line, in coral, the first time each best-effort
  face enters the working mix. The chip carries an `aria-label`, not just a title.
- Unwired role: mono (never a fake specimen), boxed `WIRED ON SHIP` tag, steppers off,
  tagline reads `previews after ship · pick records.`
- Stale panel: the 4280f2c card restyled — plain language leads (`STALE PANEL — 0.9.1 SET ·
  0.9.3 RUNNING`), the press flavor is the subhead.
- Pick narrative: `PICK → SAVING… → PICKED ✓ (drawn check, the only celebration) → SHIPPED`
  with the undo line. Status strings stay concrete and unhedged.
- Keyboard is captured **only while expanded**; collapsed (dog-ear) leaves a 344×44 masthead
  bar that still carries the presence dot, the living `Aa`, the current folio + direction
  name, and a legible `● unsaved` marker — loop state is never hidden. The marker is pinned
  non-truncating: a long direction name gives way, the state token never does.

## The streamline (state / tools / teaching)

One sorting rule, applied everywhere, replaced the original always-painted surface. The
panel's content divides into three kinds with three lifespans:

- **State** — connection, folio/position, coverage zeros, `≈` parity, unsaved-mix,
  what-just-changed — **always visible, never hides.**
- **Tools** — the `‹ ›` steppers — **appear under the hand**: hidden at rest
  (`visibility`, never `opacity`, so a hidden control is never tabbable), revealed on the
  row that is focused or hovered — the same gesture that lights the marker bar. The
  `font 03/04` counter stays put (state), and the focused row's steppers carry a faint
  `[ ]` so the key is taught in place. Routine coverage stats reveal the same way, but a
  **zero is pinned** ("0 spots on page" is an invisible pick — the one case that must
  never hide), and post-flip row verdicts always show.
- **Teaching** — the keycap hints — **folds behind one labeled door.** The colophon rests
  as the 3-key spine + `? keys`; `?` flips to the back page (an overlay over the slip body,
  so Pick never moves and the masthead's state stays visible; any working key closes it and
  still acts). On the very first run the back page shows itself once, then rests folded.

The two controls that used to hide in the footer dressed as hints (`B`, `S`) moved to where
their proof-acts live (see Compare above); the colophon is now uniformly inert except the
one element that is honestly a button. A single `KEYMAP` table in the template is the source
of truth for every painted hint, and `cli/panel-keys-test.mjs` (in the publish gate and
`run-m6.sh`) asserts it never drifts from the `onKey` handler — in either direction.

## What we take from v0, and what we reject

Take: the committed acid yellow (with a grammar), big in-face specimens with position
counters, labeled section + live counter, keycap legend, per-role taglines (add a `tagline`
field to the curator's role output — v0 invented it; it's worth making real). Reject: chip
soup (dies at 12 directions — the TOC scales and is itself a specimen), the focus ring that
only points at the panel (ours points at the page), the dead two-slot tray (comparison lives
in the list itself — space snaps between finalists), LIVE-EDIT as a mode (the working set is
always live), and a second accent hue.

## Implementation notes (against `cli/templates/font-lab-panel.tsx`)

Everything fits the existing constraints — zero deps, one file, shadow DOM, vanilla DOM in the
React shell:

1. **Sentinel scan** (~60 lines): append sentinels in `applyToPage`; TreeWalker + computed-style
   classify; cache; debounced MutationObserver invalidation. Powers x-ray, proof mode, flash,
   ledger counts, coverage, edge ticks, J-jump.
2. **Page-side layers**: one injected light-DOM `<style>` for x-ray/flash classes (element-level,
   scroll-proof) + one `pointer-events:none` overlay host for chips/ticks — sibling of the
   panel host.
3. **Serif subsets**: build step embeds Instrument Serif regular+italic base64 into the
   template (placeholder-replaced like `__FONTLAB_VERSION__`); fall back to
   `Iowan Old Style/Palatino/Georgia` italic if the subset fails, with a build alarm.
4. **State model**: `beforeView: bool` + `lastView: {sel, cursor}` (space snap-back) +
   saved mixes appended to the directions array replace `comparing`/`showingPin`/pins
   entirely; the pick guard derives from `beforeView || onCurrent`.
5. **Copy edits**: the dev server grows an `/edit` + `/undo` endpoint pair (sibling of
   `/select`) backed by the `spike/text-edit` engine; the panel's dblclick handler posts
   `{loc, before, after}` and narrates the ack. Same NODE_ENV guard, nothing ships.
6. The font endpoint protocol, persistence, and DCE guard are untouched.

The prototype survived a two-critic adversarial pass (design-craft + founder lens) and a
founder review round. The founder round reshaped it structurally: inspect became always-on
and modeless, the delta ledger dissolved into row verdicts, the rationale moved up under the
direction list, the vocabulary collapsed to direction/role/font, the compare bar was deleted
in favor of the list-based model above, and inline copy editing was integrated.

**Status: implemented** — this spec is live in `cli/templates/font-lab-panel.tsx` (the
sentinel scan, inspect, change receipts, list-based compare, copy editing via the endpoint's
`/edit`+`/undo` backed by `cli/copyedit.mjs`, and the shared-leaf wiring split in
`analyzer.wiringFor`). Verified against the real fixture: loop 16/16, m6 18/18, handoff
19/19, version 13/13, write-back engine 13/13, plus a live dblclick→source→undo e2e.

Prototype: `spike/panel-galley/prototype.html` — open it in a browser. The demo harness
(top-left) switches connection/honesty states; candidate faces render as local stand-ins
(the artifact sandbox can't fetch webfonts); the real panel loads the true subsets, so flips
will be *more* distinct than the demo, not less.
