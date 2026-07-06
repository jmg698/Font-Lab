# Galley — the definitive Font Lab panel

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
| Pick | **Passing the proof for press** — then a drawn checkmark, nothing louder |
| Footer | A **colophon** of keycaps + version |

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
- **Page → panel (Proof Mode, `X` or ⌖)**: hover any text on the live site → marker outline +
  an ink chip names it: `DISPLAY · Fraunces · 40px · 4 on page`, while the matching role row
  lights up in the panel. **Click to lock** — the next `[` / `]` flips the face of the exact
  text under your cursor. Point at your own headline and flip it: the signature move.
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
2. **The delta ledger** — a line under the TOC states the diff in words, and asserts
   non-change as loudly as change: `Δ display Inter → Fraunces · body unchanged · mono
   unchanged · 13 elements · 3 below ↓ · ↺ flash`. The zero case is honest: `0 in view — J
   jumps to nearest`.
3. **Edge ticks** — 2×14px marker ticks on the right viewport edge at each changed element's
   position, clickable to scroll, ~4s. Changes below the fold are never silent.
4. **Row verdicts** — changed rows' family names take the marker color for a beat and fade
   back; unchanged rows dim briefly. One glance at the spread shows which of the three moved.
   The masthead `Aa` flipping (or not) is the peripheral fourth signal for display.

## Compare — one object, one lit source

The **proof bar** replaces the B-flag + pin buttons: four flat tabs — `GALLEY` (live),
`BEFORE` (current baseline, permanently present — the tray is never dead), `A`, `B`. Exactly
one tab is ever underlined: *what is the page showing right now* always has a one-glance
answer.

- `B` toggles BEFORE; **hold-B (>400ms) is a momentary peek** that springs back on release —
  the blink-comparator, the fastest diff the eye has. Both directions fire the change
  machinery.
- `P` pins the galley into A then B. Pinned tabs are micro-specimens: `A · Ag` set in the
  pinned display face, plus **diff dots** — one per role that differs from the live galley
  (lit only on the shown/hovered tab) — so "this pin differs on display" is readable at rest
  without yellow decaying into decoration.
- Pins are immutable snapshots: cycling a face while viewing A copies A into the galley first
  (`Editing a copy of A in the galley — the pin is untouched.`).
- **Guarded pick**: viewing a pin relabels the button `PICK A`; viewing BEFORE disables it
  with a stated reason (`Viewing BEFORE — flip back to a proof to pick.`). No dead chrome, no
  picking-while-looking-at-the-wrong-thing.

## Honesty states (all inherited, restyled into the system)

- Presence: `OFFLINE · NPX FONT-LAB` (hollow dot) / `ENDPOINT READY` (paper dot) /
  `AGENT LISTENING` (wire-green pulse) + the existing narrated tooltips.
- `≈` best-effort: coral hairline tag on the row + a coral fidelity line **directly above
  Pick** (prominent at the pick moment, per REDESIGN.md). The line shows fully for ~4s per
  new best-effort mix, then quiets to the inline `≈`; hovering Pick revives it — honest at
  the moment it matters, not a permanent nag.
- Unwired role: mono (never a fake specimen), boxed `WIRED ON SHIP` tag, steppers off,
  coverage reads `previews after ship`.
- Stale panel: the 4280f2c card restyled — plain language leads (`STALE PANEL — 0.9.1 SET ·
  0.9.3 RUNNING`), the press flavor is the subhead.
- Pick narrative: `PICK → SAVING… → PICKED ✓ (drawn check, the only celebration) → SHIPPED`
  with the undo line. Status strings stay concrete and unhedged.
- Keyboard is captured **only while expanded**; collapsed (dog-ear) leaves a 344×44 masthead
  bar that still carries the presence dot, the living `Aa`, the current folio + direction
  name, and an unsaved-changes tick — loop state is never hidden.

## What we take from v0, and what we reject

Take: the committed acid yellow (with a grammar), big in-face specimens with position
counters, labeled section + live counter, keycap legend, per-role taglines (add a `tagline`
field to the curator's role output — v0 invented it; it's worth making real). Reject: chip
soup (dies at 12 directions — the TOC scales and is itself a specimen), the focus ring that
only points at the panel (ours points at the page), the dead two-slot tray (ours carries
specimens + diffs), LIVE-EDIT as a mode (the galley is always live), and a second accent
hue.

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
4. **State model**: `proof: 'galley'|'before'|'A'|'B'` replaces `comparing`/`showingPin`;
   pick guard derives from it. Everything else is a restyle of existing state.
5. The endpoint protocol, persistence, and DCE guard are untouched.

The prototype survived a two-critic adversarial pass (design-craft lens + founder lens);
their must-fixes — proof-mode chip never occluding the sampled glyphs, the contents list and
counter always agreeing with the shown proof (`A·01` while viewing pin A), face-labeled
per-role pagers, tiered flash, and the yellow-discipline fixes above — are already in.

Prototype: `spike/panel-galley/prototype.html` — open it in a browser. The demo harness
(top-left) switches connection/honesty states; candidate faces render as local stand-ins
(the artifact sandbox can't fetch webfonts); the real panel loads the true subsets, so flips
will be *more* distinct than the demo, not less.
