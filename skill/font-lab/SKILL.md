---
name: font-lab
description: >-
  Use when a user wants to choose, change, compare, or improve the FONTS / typography of
  their web app — ANY framework: Next.js, Vite, Astro, Remix, SvelteKit, TanStack, plain
  CSS ("pick a font", "these fonts look generic/AI-generated", "make the headings nicer",
  "what typeface should I use", "change the font"). Font Lab asks what they're going for,
  then shows tasteful, ready-to-ship font directions tailored to it and rendered on their
  OWN site (live panel on Next; real-site screenshots everywhere else), lets the human
  pick, and ships the exact code for the stack — next/font + Tailwind on Next, self-hosted
  @font-face (Tailwind v4 @theme, v3 utility overrides, or the project's own font vars)
  everywhere else — reversibly. The human keeps the taste decision; you do the typing.
---

# Font Lab

A decision surface for typography. AI removed the labor of implementing fonts but deleted the
**moment of choice** — and taste only happens at the moment of choice. Font Lab re-inserts it:
the human picks from a curated set rendered on their real site, and you ship what they chose,
byte-for-byte. **You never auto-pick a font for the user.** Your job is to curate the menu and
ship the order.

## Setup — do as much yourself as you can, then guide the human

**MCP tools not live yet?** Right after `npx font-lab install` the `font_lab_*` tools don't load
until the session reloads — but you don't have to wait (and never hand-roll an MCP client): every
tool is also a one-shot CLI, **`npx font-lab run <tool> '<json-args>'`** (same table, same JSON
out — e.g. `npx font-lab run font_lab_start '{"projectDir":"/abs/path"}'`, or `npx font-lab run
start --project .`). `npx font-lab run` lists them. Use it for the whole first loop if you have
to, and any time the MCP server drops mid-session; the reload just makes the tools native.

The live panel needs **two long-running local processes up at the same time**: the **dev server**
and the **pick + edit endpoint** (`npx font-lab --project <dir>`, on :7777). Neither ever exits.

- **If you have a local terminal** (Cursor, Claude Code, Windsurf, VS Code, Gemini CLI — the common
  case): **start BOTH yourself as background tasks and leave them running** (skip whichever is
  already up). Never start them in the foreground — they don't return and your turn will hang. Then
  the human just opens their site.
- **If you're a cloud / container agent** (`font_lab_start` detects this and returns an
  `environment` block — trust it, or pass `remote: true` if it misses): the human **cannot reach
  this machine's localhost by design**, so the live panel and :7777 are simply not the choosing
  moment here — say so up front, never hand over a localhost URL. You still run the ENTIRE loop
  yourself: install → intake → compose → **`font_lab_screenshot_directions`** (it starts the dev
  server itself — see below — and returns chat-sized `heroShot` images to show the human) →
  `font_lab_select` → `apply` → `font_lab_verify`. Copy edits: make the source edits yourself —
  the panel's double-click-to-edit needs the human on this machine's localhost. Only when the
  human wants to flip live do you offer `font_lab_live_instructions` — framed as commands for
  THEIR machine after pulling the branch (the tool words it correctly when remote).
- **Only the human can:** reload the session once after install (so the MCP tools load — the `run`
  CLI covers you until then) and make the actual pick.

**Dev servers in containers** — `font_lab_screenshot_directions` and `font_lab_verify` manage this
for you (spawn the project's dev command bound to **127.0.0.1**, health-check, capture, stop). If
you must start one by hand anyway: bind `127.0.0.1` explicitly (template configs pinning
`host: "::"` die with EAFNOSUPPORT on IPv4-only containers), use a harness-managed background
task (a plain `&` in a sandboxed shell is reaped between calls), and health-check with an HTTP
request — a `curl` exit code alone can't distinguish "server dead" from "sandbox blocked it".

The goal is that the human does nothing you could have done for them — you handle setup, scaffolding,
and shipping; they keep the taste decision.

**Upgrading Font Lab is one command: `npx font-lab upgrade`.** It installs the new package,
re-pins the MCP registration to the project's own install, re-stamps the panel (keeping the
directions the human already has), and shuts down a stale `:7777` endpoint (the new `serve`
also takes the port over from a stale one automatically). The only step it can't do: the human
reloads the agent session so the MCP server restarts. `font_lab_status` reports every drift
(endpoint, panel, MCP vs installed package, dev server) — check it after any version bump, and
act on the `mcpVersionDrift` warning if it rides your tool results.

## The loop

Use the `font-lab` MCP tools (or their identical CLI form, `npx font-lab run <tool> '<json>'`)
in this order:

1. **Start & intake** — `font_lab_start({ projectDir })`. This analyzes the project AND returns
   an `environment` block (local vs remote/container, with the workflow consequences — trust it,
   or pass `remote: true/false` to override detection), a `context` block (the project's existing
   **color palette**, any **brand/design docs**, and a **sample of the real copy**) plus Font
   Lab's *design brief*: the framing questions to **ask the human first** (what feeling? how bold
   a departure? any brand to evoke or avoid?), a strategy scaffold, the overexposed default fonts
   to avoid, and distinctive references to reach for. **Read the `context` so your options fit THIS project, then ask the intake questions and
   wait for the answers before proposing any fonts** — this is what makes the result tailored to
   *them* instead of a generic default. (`font_lab_start` runs the analysis for you. **Route by
   its `capabilities`, never by framework name** — a non-Next stack is a different route through
   the same loop, not a reason to stop: `livePanel: true` → the live-panel path (`init`);
   `autoApply: true` with `livePanel: false` — Vite / Astro / Remix / SvelteKit / TanStack /
   Tailwind v3 / var-wired plain CSS — → same loop, but skip `init` and preview on the REAL site
   with `font_lab_screenshot_directions` (needs only the dev server — no panel; the portable
   `font_lab_preview` is the no-dev-server fallback); `apply` still ships, via self-hosted
   `@font-face` through the project's own
   seam. Only `manualApply: true` (no seam: hardcoded `font-family`, CSS-in-JS) means no
   auto-ship — still compose + preview + record the pick, then hand the human the generated block
   for `capabilities.applyTarget`. `shipNote` names the path in one line — relay it to the user.)
2. **Compose the menu for their brief** — using the intake answers and the brief's references,
   assemble tailored directions with `font_lab_compose_directions({ projectDir, directions: [...] })`.
   **`projectDir` is required**: the composed set persists as the project's default menu
   (`.font-lab/preview.json`), which is what `screenshot_directions` / `preview` / `select`
   resolve against on every framework — the tool refuses without it so a later capture can
   never dead-end on "no composed set". Its result names your `nextStep` for this stack.
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
   > (TanStack / Vite / Astro / Remix / SvelteKit / … — `livePanel: false`), the panel can't mount:
   > **skip `init`** — preview with **`font_lab_screenshot_directions`** (their real site, any
   > framework, dev server running) or the portable **`font_lab_preview`** (no dev server) in
   > step 4. Either way the
   > pick ships with `font_lab_apply` (next/font on Next; self-hosted `@font-face` elsewhere —
   > routed through Tailwind v4's `@theme`, Tailwind v3's config utilities + Preflight base, or
   > the project's own CSS font vars, whichever the stack actually uses).
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
     field — fulfill it before moving on. When you exist but nothing is parked, the panel hands the
     human a ready-to-paste **wake-up prompt** instead of pretending you're composing — receiving one
     (it starts "In this project… the human wants MORE font options") means exactly: compose for the
     brief it carries, then `font_lab_more_directions`.
4. **The choosing moment** — pick the path that fits where you're running. The ladder, best
   first: the human's own browser beats screenshots, and their **real site** beats specimen
   cards. **Never present specimen cards as "the preview" while a dev server is running or
   startable** — the human is choosing fonts for THEIR pages, so show them their pages.

   The live path needs Next's live panel (`init`) + a running dev server — start it in the
   background first (`<dev command>`); note its URL (e.g. `http://localhost:3000`).

   - **Live (best — Next only, when the human has a real browser on this machine):** you're in a local
     terminal / IDE (Mac or Linux terminal, VS Code, Cursor, the Claude Code IDE extension).
     Also start the pick endpoint. Then **ARM FIRST, INVITE SECOND**: the LAST thing you do
     before telling the human to open their site is enter the listen state (table below).
     Setting everything up, saying "open your site and pick!", and ending your turn unarmed is
     exactly how picks get missed — the human browses for 10–20 minutes; your turn is long over.
     Once armed, tell them to open the site and flip the panel (← →, `↑↓`+`[ ]` to mix, `B` for
     before/after) and **pick one**.

     **How to receive panel events — turn-based agents can't poll while idle, so pick ONE
     mechanism (never "check back later"):**
     | Your harness | Do this |
     |---|---|
     | Background-task exit WAKES you (Claude Code, …) | Run `npx font-lab serve --once --project <dir>` as a **background task**, then end your turn. It **exits on the first panel event** — a pick, a "Get more" request, or the human's **done ✓** — with the event JSON as its final stdout line (`{ event: "pick", selection }`, `{ event: "request", request }`, or `{ event: "done" }`); the exit wakes you. On a pick → `font_lab_apply`. On a request → compose directions for `request.brief`, call `font_lab_more_directions`, **then relaunch `serve --once` and end your turn** so the next event reaches you too. On done → `font_lab_finish` (step 6). |
     | Exit does NOT wake you (Cursor, MCP-only, …) | Start the endpoint (`npx font-lab serve`; the panel needs it), then park on **`font_lab_wait`** — it blocks up to 240s for a pick, a request, or done ✓ (whichever comes first) and lights up "agent listening" in the panel. On `{ event: "timeout" }`, **call it again immediately**, for as long as your harness allows. |

     **If the timing misses anyway, nothing is lost.** The pick is durable: it piggybacks on
     every `font_lab_*` result as `pendingHumanPick` — with its ship scope (which roles
     auto-ship, which you wire, which island clusters need a human call) — until an apply
     postdates it. When you see one, act on it: offer `font_lab_apply`, then `font_lab_verify`.
     The human may also just say "apply my font pick" — the panel tells them to.

     Resuming a session, or unsure where things stand? **`font_lab_status`** returns the pick,
     whether it shipped, and whether the endpoint is up. The endpoint binds to **127.0.0.1** by
     default; pass `--host 0.0.0.0` only if the human wants to flip from another device.

   - **Headless real-site screenshots (ANY framework — THE choosing moment off Next, and the
     right path for web/cloud/phone sessions):** call
     `font_lab_screenshot_directions({ projectDir })`. **It manages the dev server itself**: if
     none is reachable (nothing passed, nothing recorded, or dead), it starts the project's own
     dev command — bound to 127.0.0.1, health-checked, stopped after the capture — so you never
     fight sandboxed-shell backgrounding or IPv6 binds; pass `baseUrl` to use a server you
     already run, or `ensureServer: false` to forbid the spawn. On Next (panel init'd) it drives
     the real panel; on **every other framework** it paints the rendered page through the census
     — the same machinery the panel flips with — with the parity fonts injected inline (no
     `init`, no project writes: preview woff2 cache under `.font-lab/fonts/`, never `public/`).
     Directions default to your composed set; with none composed it **errors** rather than
     silently capturing the starter menu. Either way the images are the human's **actual pages**
     in each direction, faithful to what ships. Each direction returns a `heroShot`
     (viewport JPEG, chat/phone-sized) and a `screenshot` (full-page PNG, for detail) — and over
     MCP the heroShots **ride the tool result as inline images**: show them to the human in the
     SAME turn, never send them hunting through `.font-lab/previews/` in a file manager. Ask the
     human to pick an id and record it with
     `font_lab_select({ projectDir, directionId })` (supports a mixed pick via `roles`; it
     resolves ids against the same composed set the human saw). You are still only preparing the
     menu — **the human makes the call.** If it errors on a missing Playwright driver, `npm i -D
     playwright-core` **in the project** and retry the same call — the install is picked up
     immediately (MCP and CLI alike, no session reload).

   - **Portable sheet (LOCKED last resort — the tool enforces the ladder):**
     `font_lab_preview({ projectDir })` builds a self-contained HTML sheet of **generic specimen
     cards** — real faces, honest render-check badge (a real width-diff — it flags a font that
     silently fell back, unlike `document.fonts.check`), but **not the human's pages**. Because a
     dev server that isn't running is NOT a reason (screenshot_directions starts one itself), this
     tool **refuses until a real `font_lab_screenshot_directions` attempt has failed on
     infrastructure** (no Chromium could launch, the dev server wouldn't serve — Font Lab records
     the failure and unlocks the sheet automatically, echoing why as `unlockedBecause`). Don't
     try to lead with it, and never present `.font-lab/preview.html` as "the preview" — if you're
     ever unsure which surface is right, `font_lab_status`'s `preview` block says where things
     stand. The only other unlock is `force: true`, for when the human **explicitly** wants an
     offline artifact to keep. `font_lab_preview_screenshots` (same lock) renders the sheet's
     cards headlessly for chat; record the pick with `font_lab_select`.

   - **No browser anywhere?** (headless capture can't launch a Chromium and the human can't open
     an HTML file): every css-entry apply is fenced and byte-reversible, so a scripted
     `font_lab_select → font_lab_apply → human looks at the dev server → font_lab_undo`, one
     direction at a time, is a sanctioned last resort. Verify `git status` is clean when
     finished, and never leave a direction applied without the human's explicit pick.

   Always offer the live escape hatch: if the screenshots aren't enough and the human wants to
   flip/mix/compare themselves, give them `font_lab_live_instructions({ projectDir })` —
   ready-to-run commands to launch the full editor locally (works in any terminal / IDE / Cursor).
5. **Ship it** — once a selection exists (from any path), `font_lab_apply({ projectDir })`. On Next
   it writes next/font + Tailwind — Google faces via `next/font/google`, open-foundry faces via
   `next/font/local` (the parity woff2 self-hosted into `app/fonts/`; every family is verified
   buildable **before** any file is written, so apply refuses with a reason rather than leaving a
   build that breaks later). Elsewhere it self-hosts the parity `@font-face` and routes it
   through the project's own seam — Tailwind `@theme` (TW v4), the config-generated `font-*`
   utilities + Preflight base (TW v3), or the project's own CSS font vars (`--font-*`, `--fd`, …)
   when it's var-wired, Tailwind or not. It refuses only when there's no
   seam (hardcoded `font-family`, CSS-in-JS); `font_lab_analyze.capabilities` says which, and you
   can still hand the human the generated block to paste. Reversible via `font_lab_undo`.
   **After applying, verify before declaring success:** run the project's build (`next build`, or
   at minimum let the dev server recompile cleanly) and report the result honestly — apply verifies
   structure; the build verifies the fonts resolve.
6. **Finish — hand the repo back clean** — the loop isn't done until `font_lab_finish` has run.
   The signal is the panel's **done ✓** button (it arrives like a pick: a `serve --once` exit
   with `{ event: "done" }`, a `font_lab_wait` return, a `pendingHumanDone` note riding any tool
   result, or the turn-start hook) — or the human just saying they're done. One call does the
   whole handoff: it strips the dev-panel scaffolding (the `layout.tsx` mount, `app/_fontlab/`,
   `public/fontlab/` preview fonts — **applied fonts and copy edits stay**) and returns the
   git-verified **`commitPlan`**:
   - **`ship`** — the human's work (`text-edit` copy, the `font-apply` / `rewire`), cross-checked
     against `git status` so a file that was undone (or already committed) is never re-staged.
     Comes with ready-to-run `git add` / `git commit` commands and a suggested message.
   - **`verify`** — rewritten-then-restored files that still differ from HEAD: hand the human
     the "check `git diff`" list, don't stage them.
   - **`installHooks`** — the `.mcp.json` / AGENTS.md-block wiring: keep it committed if the team
     should have Font Lab ready; `finish` with `uninstall:true` removes it all (MCP registrations,
     skill, hooks) when the human is done with Font Lab entirely.
   - **`notFontLab`** — dirty files Font Lab never wrote: the human's own parallel work. Named so
     you don't stage it by accident; never yours to commit.
   Relay the commands and let THEM run them — **never `git commit` / `git push` yourself unless
   they explicitly ask.** The scaffolding and `.font-lab/` are **self-ignoring** (a nested `*`
   .gitignore, dropped at init), so `git status` shows the product diff only; on a repo that
   predates the self-ignore, the plan detects tracked scaffold paths and includes the one-time
   `git rm -r --cached` fix. `keepScaffold:true` finishes without unmounting — for a human who
   wants the panel around next session (or `font_lab_init` with `tracked:true` for a team that
   commits it deliberately).
   **Ephemeral workspace exception:** in a remote container that loses uncommitted work when
   reclaimed (`font_lab_start`'s `environment` says so), committing IS how work survives — run
   `finish` first (scaffolding out), then make the ship-pile commit yourself with the plan's
   commands on the branch you're already working on, and tell the human exactly what you
   committed. Never push anywhere they didn't designate, and never merge.

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
- **Finish before the commit moment.** `apply → verify → font_lab_finish` is the whole loop:
  finish strips the dev-panel scaffolding and returns the git-verified `commitPlan` — relay its
  commands, and never run `git commit` or `git push` yourself unless the human explicitly asks.
  The one exception: an EPHEMERAL remote workspace (see the environment block), where
  uncommitted work is lost on reclaim — there, run finish, make the ship-pile commit yourself on
  your working branch with the plan's commands, and report it; pushing anywhere the human didn't
  designate stays off the table.
- **Headless needs a Chromium.** Font Lab ships a light Playwright driver (`playwright-core`, an
  optional dependency), so `font_lab_screenshot_directions` works out of the box — it drives
  **whatever Chromium is already on the machine** (the user's system Chrome/Edge, a pre-installed
  cloud build, or a full `playwright` bundle); no exact version match required (pass `executablePath`
  to force one). Driver resolution is **project-first**: if the tool reports no driver, `npm i -D
  playwright-core` in the project and **retry the same call** — the running MCP server picks the
  install up immediately, no session reload (the CLI resolves identically, so the two can't
  disagree). If no browser can launch, the one-time fix is `npx playwright install chromium` (or
  install a system Chrome). If it still won't, don't fake a pick — the failure has unlocked the
  portable sheet (`font_lab_preview`) for a human who can open HTML, and
  `font_lab_live_instructions` lets them choose in a real browser. The live, local path is always
  the highest-fidelity option.
