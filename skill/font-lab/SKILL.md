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
3. **Set up the preview** — `font_lab_init({ projectDir, vibe? })`. This self-hosts the
   fonts, installs the dev panel, and mounts it (dev-only). If `analyze` flagged a dead role and
   the user wants it to change, also call `font_lab_rewire_dead_roles({ projectDir })`.
   (Already initialized and just changing the options? `font_lab_prepare_preview` rebuilds the
   bundles without re-mounting.)
4. **The choosing moment** — pick the path that fits where you're running. Start the dev server
   in the background first (`<dev command>`); note its URL (e.g. `http://localhost:3000`).

   - **Live (best — when the human has a real browser on this machine):** you're in a local
     terminal / IDE (Mac or Linux terminal, VS Code, Cursor, the Claude Code IDE extension).
     Also start the pick endpoint (`node cli/font-lab.mjs --project <dir>`), then tell the human
     to open their site and flip the panel (← →, `↑↓`+`[ ]` to mix, `B` for before/after) and
     **pick one**. Read the pick with `font_lab_read_pick` (poll until it returns a selection).

   - **Headless (when there's NO live browser for the human — a web/cloud session, or they're on
     a phone):** call `font_lab_screenshot_directions({ projectDir, baseUrl })`. It drives the
     real panel and screenshots the site in each direction (faithful to what ships). **Show those
     images to the human** and ask them to pick an id. Record it with
     `font_lab_select({ projectDir, directionId })` (supports a mixed pick via `roles`). You are
     still only preparing the menu — **the human makes the call.**

   Always offer the live escape hatch: if the screenshots aren't enough and the human wants to
   flip/mix/compare themselves, give them `font_lab_live_instructions({ projectDir })` —
   ready-to-run commands to launch the full editor locally (works in any terminal / IDE / Cursor).
5. **Ship it** — once a selection exists (from either path), `font_lab_apply({ projectDir })`.
   Reversible via `font_lab_undo`; remove the panel scaffolding with `font_lab_uninit`.

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
- **Headless needs a Chromium.** `font_lab_screenshot_directions` needs the `playwright` library
  (`npm i -D playwright`), but it drives **whatever Chromium is already on the machine** — a
  pre-installed build (cloud envs), the user's system Chrome/Edge, or Playwright's bundle; no exact
  version match required (pass `executablePath` to force one). If none launches, don't fake a pick —
  hand the human `font_lab_live_instructions` and let them choose in a real browser. The live, local
  path is always the highest-fidelity option.
