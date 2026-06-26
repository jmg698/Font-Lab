---
name: font-lab
description: >-
  Use when a user wants to choose, change, compare, or improve the FONTS / typography of
  their Next.js + Tailwind app ("pick a font", "these fonts look generic/AI-generated",
  "make the headings nicer", "what typeface should I use", "change the font"). Font Lab shows
  the user tasteful, ready-to-ship font directions rendered live on their OWN running site,
  lets the human pick, then ships the exact next/font + Tailwind code — reversibly. The human
  keeps the taste decision; you do the typing.
---

# Font Lab

A decision surface for typography. AI removed the labor of implementing fonts but deleted the
**moment of choice** — and taste only happens at the moment of choice. Font Lab re-inserts it:
the human picks from a curated set rendered on their real site, and you ship what they chose,
byte-for-byte. **You never auto-pick a font for the user.** Your job is to curate the menu and
ship the order.

## The loop

Use the `font-lab` MCP tools (or the CLIs in `cli/`) in this order:

1. **Analyze** — `font_lab_analyze({ projectDir })`. Learn the current fonts, wiring, and any
   coverage warnings. Do this first. If it reports the project is out-of-branch (not App
   Router + Tailwind v4 + CSS-variable wiring), tell the user what's missing instead of
   pushing ahead.
2. **Decide the menu** — two ways, your call:
   - **Default (free):** `font_lab_curate({ projectDir, vibe? })` → ~5 tasteful directions.
   - **Take the wheel:** when the user asked for something specific, `font_lab_list_catalog({ role, tag })`
     to browse, then `font_lab_compose_directions({ directions: [...] })` to build your own.
     Every family must be a catalog member — that's what keeps preview == ship.
   Mix freely: start from `curate`, swap a direction or two with composed ones.
3. **Preview** — `font_lab_prepare_preview({ projectDir, directions | vibe })`. This builds the
   live preview into the project. Then tell the human to open their dev server and flip through
   the directions (← →, `B` for before/after) and **pick one**. Wait for the human.
4. **Read the pick** — poll `font_lab_read_pick({ projectDir })` until it returns a selection.
5. **Ship it** — `font_lab_apply({ projectDir })`. Reversible via `font_lab_undo`.

## Rules

- **The human picks.** Never choose the final font yourself. Prepare options; let them decide.
- **Catalog-only.** Compose freely, but only from catalog fonts — preview fidelity and the
  CLS-safe ship both depend on it. `compose_directions` enforces this and suggests alternates.
- **Be honest about coverage.** If `analyze` flags a dead role (a font declared but not actually
  rendered, common with Tailwind v4 `@theme inline` + raw `var(--font-*)`), tell the user a
  swap there won't be visible until it's rewired — don't pretend it worked. Offer
  `font_lab_rewire_dead_roles` to fix it (points the raw usage at the published leaf var so the
  font renders); it's reversible via `font_lab_undo`.
- **Reversible.** Every apply backs up first; offer `undo` if they don't love it.
