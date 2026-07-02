---
name: font-lab
description: >-
  Use when a user wants to choose, change, compare, or improve the FONTS / typography of
  their Next.js + Tailwind app ("pick a font", "these fonts look generic/AI-generated",
  "make the headings nicer", "what typeface should I use", "change the font"). Font Lab asks
  what they're going for, then shows tasteful, ready-to-ship font directions tailored to it and
  rendered live on their OWN running site, lets the human pick, and ships the exact next/font +
  Tailwind code — reversibly. The human keeps the taste decision; you do the typing.
---

# Font Lab

A decision surface for typography. AI removed the labor of implementing fonts but deleted the
**moment of choice** — and taste only happens at the moment of choice. Font Lab re-inserts it:
the human picks from a curated set rendered on their real site, and you ship what they chose,
byte-for-byte. **You never auto-pick a font for the user.** Your job is to curate the menu and
ship the order.

## The loop

Use the `font-lab` MCP tools (or the CLIs in `cli/`) in this order:

1. **Start & intake** — `font_lab_start({ projectDir })`. This analyzes the project AND returns
   a `context` block (the project's existing **color palette**, any **brand/design docs**, and a
   **sample of the real copy**) plus Font Lab's *design brief*: the framing questions to **ask
   the human first** (what feeling? how bold a departure? any brand to evoke or avoid?), a
   strategy scaffold, the overexposed default fonts to avoid, and distinctive references to reach
   for. **Read the `context` so your options fit THIS project, then ask the intake questions and
   wait for the answers before proposing any fonts** — this is what makes the result tailored to
   *them* instead of a generic default. (`font_lab_start` runs the analysis for you; if it
   reports the project is out-of-branch — not App Router + Tailwind v4 + CSS-variable wiring —
   tell the user what's missing instead of pushing ahead.)
2. **Compose the menu for their brief** — using the intake answers and the brief's references,
   assemble tailored directions with `font_lab_compose_directions({ directions: [...] })`.
   Reach past the overexposed defaults and give each direction a one-line rationale tied to what
   they asked for. You are **not limited to the catalog**: any of ~1,500 Google fonts works, plus
   a curated bench of distinctive **open-foundry** faces (Cabinet Grotesk, General Sans, Clash
   Display, Sentient, …). Check uncertain faces with `font_lab_check_fonts({ families: [...] })` — it
   says whether each ships **guaranteed** (byte-for-byte) or **best-effort** (shippable, but show
   the human the fidelity warning). `compose_directions` admits them and rejects only genuinely
   unshippable fonts. Browse the verified floor with `font_lab_list_catalog({ role, tag })`.
   `font_lab_curate({ projectDir, vibe? })` is the **fallback** when you have no brief.
   > **Which framework?** Check `analyze`'s `capabilities`. On **Next.js App Router** you get the
   > live in-app panel (`livePanel: true`) — use the `init` path below. On **any other framework**
   > (TanStack / Vite / Astro / … — `livePanel: false`), the panel can't mount: **skip `init`** and
   > use the portable **`font_lab_preview`** in step 4 instead. Either way the pick ships with
   > `font_lab_apply` (next/font on Next; self-hosted `@font-face` + Tailwind `@theme` elsewhere).
3. **Set up the preview (Next only)** — `font_lab_init({ projectDir, directions })`, passing the directions
   you just composed. The panel shows **exactly those**. `init` **refuses without directions** —
   so you can't mount the generic default menu without doing the brief first; only pass
   `allowFallback: true` if the user explicitly wants the deterministic default. If `analyze`
   flagged a dead role and the user wants it to change, also call `font_lab_rewire_dead_roles`.
   (Already initialized and changing the set? `font_lab_prepare_preview({ projectDir, directions })`
   rebuilds without re-mounting.)
   - **Want more options?** The menu is never capped. When the user asks "what else?", compose
     additional directions and call `font_lab_more_directions({ projectDir, directions })` — they're
     appended to the live panel (existing options kept).
4. **The choosing moment** — pick the path that fits where you're running.

   - **Portable (works on ANY framework, no dev server — the default off Next):**
     `font_lab_preview({ projectDir, directions })` builds a single self-contained HTML sheet — one
     card per direction, the parity fonts **embedded** (opens offline), rendered on the project's
     own palette. **Show the human that file** (or open it) and ask them to pick an id. Each card
     has a live **render-check badge** (a real width-diff — it flags a font that silently fell back,
     unlike `document.fonts.check`). Want verified screenshots too? it also has a headless
     screenshot+verify mode. Record the pick with `font_lab_select`.

   The two paths below need Next's live panel (`init`) + a running dev server — start it in the
   background first (`<dev command>`); note its URL (e.g. `http://localhost:3000`).

   - **Live (best — when the human has a real browser on this machine):** you're in a local
     terminal / IDE (Mac or Linux terminal, VS Code, Cursor, the Claude Code IDE extension).
     Also start the pick endpoint, then tell the human to open their site and flip the panel
     (← →, `↑↓`+`[ ]` to mix, `B` for before/after) and **pick one**.

     **How to receive the pick — turn-based agents can't poll while idle, so pick ONE
     mechanism (never "check back later"):**
     | Your harness | Do this |
     |---|---|
     | Background terminals available (Claude Code, Cursor, …) | Run `npx font-lab serve --once --project <dir>` as a **background task**, then end your turn. It **exits the moment the pick lands** (the selection JSON is its final stdout line) — the exit wakes you. |
     | MCP-only / no background terminals | Start the endpoint however you can (`npx font-lab serve`; the panel needs it), then call **`font_lab_wait_for_pick`** — it blocks up to 240s and lights up "agent listening" in the panel. On `{ timedOut: true }`, call it again. |

     Resuming a session, or unsure where things stand? **`font_lab_status`** returns the pick,
     whether it shipped, and whether the endpoint is up. The endpoint binds to **127.0.0.1** by
     default; pass `--host 0.0.0.0` only if the human wants to flip from another device.

   - **Headless (when there's NO live browser for the human — a web/cloud session, or they're on
     a phone):** call `font_lab_screenshot_directions({ projectDir, baseUrl })`. It drives the
     real panel and screenshots the site in each direction (faithful to what ships). **Show those
     images to the human** and ask them to pick an id. Record it with
     `font_lab_select({ projectDir, directionId })` (supports a mixed pick via `roles`). You are
     still only preparing the menu — **the human makes the call.**

   Always offer the live escape hatch: if the screenshots aren't enough and the human wants to
   flip/mix/compare themselves, give them `font_lab_live_instructions({ projectDir })` —
   ready-to-run commands to launch the full editor locally (works in any terminal / IDE / Cursor).
5. **Ship it** — once a selection exists (from any path), `font_lab_apply({ projectDir })`. On Next
   it writes next/font + Tailwind — Google faces via `next/font/google`, open-foundry faces via
   `next/font/local` (the parity woff2 self-hosted into `app/fonts/`; every family is verified
   buildable **before** any file is written, so apply refuses with a reason rather than leaving a
   build that breaks later). Elsewhere it self-hosts the parity `@font-face` and routes it
   through the project's own seam — Tailwind `@theme` (TW v4), or the project's own CSS font vars
   (`--font-*`, `--fd`, …) when it's var-wired, Tailwind or not. It refuses only when there's no
   seam (hardcoded `font-family`, CSS-in-JS); `font_lab_analyze.capabilities` says which, and you
   can still hand the human the generated block to paste. Reversible via `font_lab_undo`.
   **After applying, verify before declaring success:** run the project's build (`next build`, or
   at minimum let the dev server recompile cleanly) and report the result honestly — apply verifies
   structure; the build verifies the fonts resolve.

## Rules

- **The human picks.** Never choose the final font yourself. Prepare options; let them decide.
- **Ask first.** Always gather the brief (`font_lab_start`'s intake questions) before proposing
  fonts. Tailored options are the whole point; a menu picked without a brief is a generic menu.
- **Reach past the defaults.** The point is to escape the generic AI look. Do **not** propose
  the overexposed defaults (Inter, Geist, Space Grotesk, Roboto, Open Sans, Montserrat, Poppins,
  DM Sans, Manrope, Sora, Figtree, JetBrains/Roboto/Geist Mono, …) unless the brief specifically
  calls for maximum neutrality — and say why if you do. Default to distinctive, characterful
  faces tailored to the project; `font_lab_start` lists what to avoid and what to reach for.
  `compose_directions` **rejects** an all-generic menu (any direction overexposed in both display
  and body, or a set whose every display is a default) — fix it with distinctive faces, or pass
  `force:true` only when the user explicitly wants the default look. The human's own final pick is
  **never blocked**: if it reads generic, relay the heads-up `font_lab_select` returns and let
  them decide.
- **Shippable-only, not catalog-only.** Reach beyond the catalog to any distinctive Google font or
  a curated open-foundry face — the shippability gate admits it. Prefer **guaranteed** (full WYSIWYG)
  faces; when only a **best-effort** ship is possible, present it with the honest "may render
  slightly differently once applied" note and let the human decide. `font_lab_check_fonts` gives
  the verdict; `compose_directions` rejects only genuinely unshippable fonts and suggests
  alternates.
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
