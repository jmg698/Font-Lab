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

## Setup — do as much yourself as you can, then guide the human

The live panel needs **two long-running local processes up at the same time**: the **dev server**
and the **pick + edit endpoint** (`npx font-lab --project <dir>`, on :7777). Neither ever exits.

- **If you have a local terminal** (Cursor, Claude Code, Windsurf, VS Code, Gemini CLI — the common
  case): **start BOTH yourself as background tasks and leave them running** (skip whichever is
  already up). Never start them in the foreground — they don't return and your turn will hang. Then
  the human just opens their site.
- **If you're a cloud / container agent** with no reach to the user's localhost: you can still
  install, scaffold the panel, and ship — but you **cannot start or reach** those processes. Hand
  the human the exact commands (`font_lab_live_instructions({ projectDir })`) and the URL to open,
  and drive the pick from screenshots (`font_lab_screenshot_directions`).
- **Only the human can:** reload the session once after install (so the MCP tools load) and make the
  actual pick / retype copy in their browser.

The goal is that the human does nothing you could have done for them — you handle setup, scaffolding,
and shipping; they keep the taste decision.

**After upgrading Font Lab** (npm install of a new version), three things hold the OLD version until
restarted: the `:7777` endpoint (kill + relaunch it), the MCP server (the human reloads the
IDE/session so new tools appear), and the installed panel (`font_lab_init` re-stamps it).
`font_lab_status` reports all three drifts — check it after any version bump.

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
     appended to the live panel (existing options kept). The human can also ask from **inside the
     panel** ("None of these? Tell Font Lab what you want" → Get more): that request reaches you via
     whichever listening mechanism you set up in step 4 (`serve --once` exiting with
     `{ event: "request" }`, or `font_lab_wait` returning it). If NO agent is listening, the endpoint
     self-serves curator picks tuned to the mini-brief so the human is never stuck — but those aren't
     agent-composed, so **keep a listener parked** whenever the human is exploring. If you were
     working while a request landed, any Font Lab tool result will carry a `pendingHumanRequest`
     field — fulfill it before moving on.
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

     **How to receive panel events — turn-based agents can't poll while idle, so pick ONE
     mechanism (never "check back later"):**
     | Your harness | Do this |
     |---|---|
     | Background terminals available (Claude Code, Cursor, …) | Run `npx font-lab serve --once --project <dir>` as a **background task**, then end your turn. It **exits on the first panel event** — a pick OR a "Get more" request — with the event JSON as its final stdout line (`{ event: "pick", selection }` or `{ event: "request", request }`); the exit wakes you. On a pick → `font_lab_apply`. On a request → compose directions for `request.brief`, call `font_lab_more_directions`, **then relaunch `serve --once` and end your turn** so the next event reaches you too. |
     | MCP-only / no background terminals | Start the endpoint however you can (`npx font-lab serve`; the panel needs it), then call **`font_lab_wait`** — it blocks up to 240s for a pick OR a request (whichever comes first) and lights up "agent listening" in the panel. On `{ event: "timeout" }`, call it again. |

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

## Copy edits — same endpoint, no extra setup

Once the panel is mounted (`init`) and the **`:7777` endpoint is running**, the human can
**double-click any text on their page, retype it, and it saves to their source** — reversibly,
through the same backup machinery as apply. It rides the exact endpoint you already started for
picks, so there's nothing extra to install: if picks work, copy edits work. This is why keeping
that endpoint up (and pointed at the site root) matters even when the user only came for fonts.

Prose written with **HTML entities** (`what&apos;s`, `Tom &amp; Jerry`) edits fine — the engine
decodes them to match the rendered words and re-encodes on write, so the apostrophe round-trips and
no lint rule (`react/no-unescaped-entities`) is reintroduced. Copy that's **duplicated across pages**
also edits fine as long as the panel can resolve the call site (dev mode): the frame pins the one
file, so the twin on another page is left untouched.

If an edit **appears to save then snaps back**, it's the failure signal, and it's almost always one
of three things — say which, don't leave it looking broken:
- the **endpoint isn't running** (or the panel says OFFLINE),
- it's **pointed at the wrong folder** — `npx font-lab --project <dir>` must be the site's own root
  (a mismatch, or a space/odd char in the path, shows up as "couldn't find these words"),
- the **site isn't in dev mode** — copy edit reads the dev server's source map to locate the JSX to
  rewrite; a production build won't have it.

When an edit **genuinely can't be automated** — the words come from data (a DB/CMS/props), or the
same phrase lives in several files with no resolvable call site — the panel stops guessing and
offers a **"Copy fix for your agent →"** button. That copies a ready-to-paste instruction (change
"X" to "Y", and where) the human hands to you; make that exact change in source, reversibly. The
same text comes back on the endpoint's refusal as `agentPrompt`, so an un-automatable copy edit
still has a clean next step instead of a dead end.

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
- **Headless needs a Chromium.** Font Lab ships a light Playwright driver (`playwright-core`, an
  optional dependency), so `font_lab_screenshot_directions` works out of the box — it drives
  **whatever Chromium is already on the machine** (the user's system Chrome/Edge, a pre-installed
  cloud build, or a full `playwright` bundle); no exact version match required (pass `executablePath`
  to force one). If the tool reports no browser could launch, the one-time fix is `npx playwright
  install chromium` (or install a system Chrome). If it still won't, don't fake a pick — hand the
  human `font_lab_live_instructions` and let them choose in a real browser. The live, local path is
  always the highest-fidelity option.
