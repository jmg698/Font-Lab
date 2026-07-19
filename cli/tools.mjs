// The Font Lab tool table — ONE definition of every font_lab_* tool (name, description, schema,
// handler), consumed by TWO transports that must never drift:
//
//   • cli/mcp.mjs           — the MCP stdio server (what agents normally call)
//   • `font-lab run <tool>` — the same tools as one-shot CLI calls (font-lab.mjs)
//
// The CLI form exists because MCP registration has a dead zone: right after `font-lab install`
// the tools aren't live until the human reloads the agent session — and on cloud harnesses the
// server can also drop mid-session. An agent should never have to hand-write a stdio client or
// stall on a reload: every tool here is `npx font-lab run <name> '<json-args>'` with identical
// behavior and identical JSON out, because it IS the same table.
//
// Discoverability ("SEO for agents") lives in the tool descriptions: they're written so an agent
// reaches for Font Lab the moment a user wants to choose, change, or improve fonts — and so it
// understands the contract (the HUMAN picks; the agent curates and ships).

import { readFileSync } from "node:fs";
import path from "node:path";
import * as engine from "./engine.mjs";
import { pendingPick } from "./state.mjs";
import { VERSION, cmpVersions, isRealVersion } from "./version.mjs";

const proj = { type: "string", description: "Absolute path to the user's project root (any framework — Next.js, Vite, Astro, Remix, SvelteKit, TanStack, …)." };
const remoteParam = {
  type: "boolean",
  description:
    "Set true if you're a cloud/container agent whose human CANNOT open localhost URLs on this machine (auto-detected for common clouds — Claude Code on the web, Codespaces, Gitpod, Codex cloud; pass explicitly to override either way).",
};

export const TOOLS = [
  {
    name: "font_lab_start",
    description:
      "START HERE when a user wants to choose, change, or improve fonts — on ANY framework (Next.js, Vite, Astro, Remix, SvelteKit, TanStack, …). Returns the project analysis (including `capabilities` + `shipNote` — the preview/ship path for THIS stack, so a non-Next project is a different route, never a dead end), an `environment` block (local vs remote/container session — with the workflow consequences spelled out, e.g. screenshots ARE the choosing moment when the human can't reach this machine's localhost), a `context` block (the project's existing color palette, brand/design docs, and a sample of the real copy — so your options fit THIS project), PLUS Font Lab's design brief: the framing questions to ASK THE HUMAN FIRST (what feeling? how bold a departure? any brand to evoke or avoid?), a strategy scaffold (reason about the brief before naming fonts), the overexposed defaults to AVOID (Inter, Geist, Space Grotesk, …), distinctive references to reach for, and the rule that every direction needs a brief-tied rationale. Read the context, ask the intake questions and WAIT for the answers before proposing any fonts — that's what makes the result tailored instead of generic. The HUMAN always makes the final pick.",
    inputSchema: { type: "object", properties: { projectDir: proj, remote: remoteParam }, required: ["projectDir"] },
    handler: (a) => engine.start(a.projectDir, { remote: a.remote }),
  },
  {
    name: "font_lab_analyze",
    description:
      "Audit ANY web project's CURRENT typography before changing it: framework (Next/Vite/Astro/Remix/SvelteKit/TanStack/…), router, Tailwind version, the current display/body/mono fonts, how they're wired, and coverage warnings (e.g. a font that's declared but not actually rendered). The result's `capabilities` + `shipNote` name the right path for THIS stack — live panel on Next App Router, portable preview + css-entry auto-ship elsewhere (Tailwind v4, v3, or var-wired plain CSS), hand-apply only when there's no seam. NEVER treat a non-Next stack as unsupported without reading `capabilities`. Prefer font_lab_start as the front door — it runs this AND returns the design brief (intake questions + what to avoid/reach for). Use this directly only when you just need the raw audit.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.analyze(a.projectDir),
  },
  {
    name: "font_lab_list_catalog",
    description:
      "Browse Font Lab's curated catalog of ship-ready variable Google fonts (each verified for capsize/CLS-safe parity). Filter by role ('display'|'body'|'mono') or vibe tag (e.g. 'editorial','geometric','serif','technical'). Use this to compose your OWN font directions when the default curation isn't what the user asked for.",
    inputSchema: {
      type: "object",
      properties: { role: { type: "string", enum: ["display", "body", "mono"] }, tag: { type: "string" } },
    },
    handler: (a) => engine.listCatalog({ role: a.role, tag: a.tag }),
  },
  {
    name: "font_lab_check_fonts",
    description:
      "Check whether specific fonts can ship with Font Lab's preview==ship guarantee — use this to REACH BEYOND the built-in catalog. Pass family names (any of ~1,500 Google fonts like 'Hedvig Letters Serif', or a curated open-foundry face like 'Cabinet Grotesk' / 'General Sans'). Each returns a verdict: 'guaranteed' (full WYSIWYG), 'best-effort' (shippable, but the preview may not be byte-for-byte — show the human the warnings and let them decide), or 'unavailable' (can't ship, with the reason). The catalog is a floor, not a ceiling: reach for distinctive faces that fit the brief and confirm them here before composing.",
    inputSchema: {
      type: "object",
      properties: { projectDir: proj, families: { type: "array", items: { type: "string" }, description: "Font family names to check." } },
      required: ["families"],
    },
    handler: async (a) => {
      const out = {};
      for (const f of a.families || []) out[f] = await engine.admit(f, { projectDir: a.projectDir });
      return out;
    },
  },
  {
    name: "font_lab_curate",
    description:
      "FALLBACK menu — ~5 font directions (display+body+mono pairings) that move off the project's current fonts, no LLM. Seeded to THIS project (its name + palette + copy), so the spread differs from project to project instead of being the same five everywhere — but it is still a generic starting point, NOT tailored to the user's brief. Use it only when you have NO brief. When you DO have a brief (from font_lab_start's intake questions), prefer font_lab_compose_directions and tailor the options to what they asked for — that's the better experience. Pass an optional 'vibe' to steer the fallback.",
    inputSchema: {
      type: "object",
      properties: { projectDir: proj, vibe: { type: "string" }, count: { type: "number" } },
      required: ["projectDir"],
    },
    handler: (a) => engine.curate(a.projectDir, { vibe: a.vibe, count: a.count }).directions,
  },
  {
    name: "font_lab_compose_directions",
    description:
      "The PRIMARY way to build the menu: assemble tailored font directions for the user's brief (from font_lab_start's intake answers). Pass the user's stated direction as `brief` — if you omit it, the result is INFERRED rather than tailored, and you'll get a warning telling you to ask first. Reach PAST the overexposed defaults — give each direction a distinctive face and a one-line rationale tying it to what they asked for. Each direction needs display, body, and mono families. Families can be ANY shippable font (catalog, ~1,500 Google fonts, or a curated open-foundry face) — the gate admits them; check uncertain ones first with font_lab_check_fonts. REJECTS a menu that's too generic (any direction overexposed in both display and body, or a set whose every display is an overexposed default) — fix it with distinctive faces, or pass force:true only if the user explicitly wants the default look. Returns validated, preview-ready directions plus warnings (overexposed-default flags, and a best-effort fidelity note when a font can't be guaranteed byte-for-byte). ALWAYS pass projectDir: the composed set is then persisted (.font-lab/preview.json) as the project's default menu, so font_lab_screenshot_directions / font_lab_preview / font_lab_select resolve against EXACTLY these directions on every framework.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { ...proj, description: "The project root — pass it: admitted fonts are cached for the preview build AND the composed set persists as the project's default preview menu (what screenshots/select resolve against)." },
        brief: { type: "string", description: "The user's stated direction from intake (what feeling / how bold / brand). Omitting it warns you to ask first." },
        force: { type: "boolean", description: "Override the anti-generic gate (use only when the user explicitly wants overexposed default fonts)." },
        directions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              vibe: { type: "string" },
              rationale: { type: "string" },
              display: { type: "string" },
              body: { type: "string" },
              mono: { type: "string" },
            },
            required: ["display", "body", "mono"],
          },
        },
      },
      required: ["directions"],
    },
    handler: (a) => engine.composeDirections(a.directions, { projectDir: a.projectDir, force: a.force, brief: a.brief }),
  },
  {
    name: "font_lab_init",
    description:
      "SET UP the live preview panel in the project, built from the directions YOU composed for the user's brief — self-hosts the bundles, installs the dev panel, mounts it (dev-only). NEXT.JS APP ROUTER ONLY (the panel mounts in layout.tsx): on any other framework (Vite/Astro/Remix/SvelteKit/TanStack/…) SKIP this and use font_lab_preview instead — the pick still ships via font_lab_apply. Pass the `directions` from font_lab_compose_directions; the panel shows exactly those. This REFUSES without directions (so the generic default menu can't be mounted without asking the user first) — only pass allowFallback:true if the user explicitly wants the deterministic default. Run after start → intake → compose. Idempotent + reversible (font_lab_uninit). Reported dead roles are SHIP scope, not a preview problem: the panel previews every role by painting the rendered page; a dead chain just means shipping that role needs font_lab_rewire_dead_roles or an agent edit (the pick declares this scope).",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        directions: { type: "array", items: { type: "object" }, description: "The brief-driven directions to show in the panel (from compose_directions)." },
        allowFallback: { type: "boolean", description: "Mount the deterministic default menu without a brief — only if the user explicitly wants it." },
        vibe: { type: "string" },
        count: { type: "number" },
      },
      required: ["projectDir"],
    },
    handler: (a, { log }) => engine.init(a.projectDir, { directions: a.directions, allowFallback: a.allowFallback === true, vibe: a.vibe, count: a.count, log }),
  },
  {
    name: "font_lab_more_directions",
    description:
      "Add MORE options to the live panel — when the human wants to keep exploring beyond the current set. Compose additional tailored directions first (font_lab_compose_directions), then pass them here; they're admitted and APPENDED to the panel (existing options are kept), and the panel updates live. Use this whenever the user asks 'what else?' / 'show me more' — the menu is never capped. This ALSO fulfills an in-panel 'more options' request (from font_lab_wait_for_request): appending clears the pending request and flips the menu from provisional 'starter' to tailored. Honor the request's brief and reach past its exclude list so the new options are genuinely different.",
    inputSchema: {
      type: "object",
      properties: { projectDir: proj, directions: { type: "array", items: { type: "object" }, description: "The new directions to append (from compose_directions)." } },
      required: ["projectDir", "directions"],
    },
    handler: (a, { log }) => engine.expandPreview(a.projectDir, { directions: a.directions, log }),
  },
  {
    name: "font_lab_uninit",
    description: "Remove Font Lab's panel scaffolding from the project (restores the layout, removes the generated panel + self-hosted fonts). Use to clean up if the user doesn't want to keep previewing.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.uninit(a.projectDir),
  },
  {
    name: "font_lab_prepare_preview",
    description:
      "Rebuild the LIVE preview bundle for the directions YOU composed for the user's brief (self-hosted woff2 + exact next/font fallbacks), so the HUMAN can flip through them and pick. Pass the `directions` from compose_directions. REFUSES without directions (don't rebuild the generic default menu without asking the user) — only pass allowFallback:true if they explicitly want the default. Use font_lab_init for first setup; use this to rebuild after changing the options. Never auto-selects. (Fetches fonts.)",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        directions: { type: "array", items: { type: "object" }, description: "The brief-driven directions to build (from compose_directions)." },
        allowFallback: { type: "boolean", description: "Build the deterministic default menu without a brief — only if the user explicitly wants it." },
        vibe: { type: "string" },
        count: { type: "number" },
      },
      required: ["projectDir"],
    },
    handler: (a, { log }) => engine.preparePreview(a.projectDir, { directions: a.directions, allowFallback: a.allowFallback === true, vibe: a.vibe, count: a.count, log }),
  },
  {
    name: "font_lab_wait",
    description:
      "BLOCK until the human EITHER picks a direction OR asks for more options in the panel — whichever comes first. This is the unified event loop: one call covers both paths, so you never miss a request because you were waiting for the wrong event. While blocked, the panel shows 'agent listening' and the human's clicks reach you instead of the copy-a-prompt off-ramp.\n\nReturns one of:\n  { event: 'pick', selection }     — the human picked. Call font_lab_apply to ship it.\n  { event: 'request', request }    — the human wants MORE options. request.brief has their mini-brief (feeling, departure, brand, note); request.exclude lists families already shown. Compose new directions honoring that brief, call font_lab_more_directions, then call font_lab_wait again.\n  { event: 'timeout', timedOut }   — no activity yet. Call font_lab_wait again to keep listening.\n\nTypical loop: compose → prepare_preview → font_lab_wait → handle pick or request → font_lab_wait → …",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        timeoutSec: { type: "number", description: "Max seconds to block (default 240). Re-call on timeout." },
        ignoreExistingPick: { type: "boolean", description: "Wait for a NEW pick even if a previous selection.json exists." },
      },
      required: ["projectDir"],
    },
    handler: (a) => engine.waitForEvent(a.projectDir, { timeoutMs: (a.timeoutSec ?? 240) * 1000, ignoreExistingPick: a.ignoreExistingPick === true }),
  },
  {
    name: "font_lab_wait_for_pick",
    description:
      "BLOCK until the human picks in the live panel (or timeoutSec elapses). Prefer font_lab_wait (unified) — it covers both picks AND 'more options' requests in one call. This single-event variant is still useful when you ONLY want picks (e.g. after the panel is fully stocked and no more rounds are expected). Returns { picked: true, selection } or { picked: false, timedOut: true } — on timeout, call it again to keep waiting. Alternative for harnesses with background terminals: run `npx font-lab serve --once` as a background task — it exits the moment the pick lands, with the selection as its final stdout line.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        timeoutSec: { type: "number", description: "Max seconds to block (default 240). Re-call on timeout." },
        ignoreExisting: { type: "boolean", description: "Wait for a NEW pick even if a previous selection.json exists." },
      },
      required: ["projectDir"],
    },
    handler: (a) => engine.waitForPick(a.projectDir, { timeoutMs: (a.timeoutSec ?? 240) * 1000, ignoreExisting: a.ignoreExisting === true }),
  },
  {
    name: "font_lab_wait_for_request",
    description:
      "BLOCK until the human clicks 'more options / none of these' in the live panel (or timeoutSec elapses). Prefer font_lab_wait (unified) — it covers both picks AND requests in one call. This single-event variant is still useful when you specifically want to wait ONLY for a request. Returns { requested: true, request } — where request.brief is the mini-brief (feeling / departure / brand / note) and request.exclude lists families already shown. On a request: compose new directions, call font_lab_more_directions, then switch to font_lab_wait. Returns { requested: false, timedOut: true } on timeout — call again.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        timeoutSec: { type: "number", description: "Max seconds to block (default 240). Re-call on timeout." },
      },
      required: ["projectDir"],
    },
    handler: (a) => engine.waitForRequest(a.projectDir, { timeoutMs: (a.timeoutSec ?? 240) * 1000 }),
  },
  {
    name: "font_lab_status",
    description:
      "One snapshot of the whole handoff: the current pick (if any), whether it's been shipped (applied), whether an agent is waiting, whether the pick endpoint is up, the environment (local vs remote/container — with the workflow consequences), and the latest backup. Call this when resuming a session, before apply, or whenever you need to know where the loop stands. Its `devServer` field health-checks the dev server the panel last reported — if `devServer.up` is false, either RESTART it or just call font_lab_screenshot_directions / font_lab_verify, which start the project's dev server themselves when none is reachable. Its `sourceChanges` field lists every SOURCE file Font Lab wrote this session (copy edits, font applies, rewires, undos, panel scaffolding) — read it when the human is done to tell them exactly what to commit, keeping their content edits separate from Font Lab's own scaffolding.",
    inputSchema: { type: "object", properties: { projectDir: proj, port: { type: "number", description: "Pick-endpoint port (default 7777)." } }, required: ["projectDir"] },
    handler: (a) => engine.status(a.projectDir, { port: a.port ?? 7777 }),
  },
  {
    name: "font_lab_read_pick",
    description:
      "One-shot read of the human's pick (.font-lab/selection.json); null until they've chosen. Prefer font_lab_wait_for_pick (it blocks and shows the human 'agent listening') — use read_pick for a quick non-blocking check.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.readSelection(a.projectDir),
  },
  {
    name: "font_lab_apply",
    description:
      "Ship the human's pick, idempotently and reversibly (backup-first). On Next.js App Router it writes next/font + Tailwind — Google faces via next/font/google, open-foundry faces via next/font/local with the woff2 self-hosted into the source tree (every family is verified buildable BEFORE any file is written; unverifiable families refuse with the reason). On ANY OTHER framework (TanStack/Vite/Astro/Remix/SvelteKit/…) it self-hosts the parity @font-face into the CSS entry and routes it through the project's own seam — Tailwind v4 @theme, Tailwind v3's config-generated font-* utilities + Preflight base, or the project's own CSS font vars — no next/font needed. Refuses only when there's no auto-ship branch (hardcoded font-family, CSS-in-JS), with a clear reason (check font_lab_analyze.capabilities). After applying on Next, run the project's build (or dev-server compile) to confirm it compiles — then close the loop with font_lab_verify (it starts the dev server itself if needed): apply edits files, the receipt proves pixels. Run after wait_for_pick/read_pick returns a selection.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.apply(a.projectDir),
  },
  {
    name: "font_lab_verify",
    description:
      "THE SHIP RECEIPT — after font_lab_apply (and any rewires or hand edits), re-render the RUNNING site headlessly and MEASURE whether the pick actually reached the pixels: per route, the % of heading/body/label text whose computed font now matches the picked families. Files written is not the same as fonts changed — never declare a font ship done without a converged receipt. If no dev server is reachable it STARTS the project's own dev command itself (managed, bound to 127.0.0.1, stopped after) — pass ensureServer:false to forbid that. Pass the routes the human cares about (include per-route pages — brand islands live there). Returns {converged, receipt, workOrder}: `residue` names every cluster that still renders the old font, WITH provenance (route, inline-style vs stylesheet, sample text). If workOrder is non-null it is written for YOU, the coding agent — execute it: run font_lab_rewire_dead_roles when it says so, ask the human before touching intentional per-route font islands, edit the named spots, then re-run this tool until converged:true. Makes no edits itself; writes .font-lab/receipt.json.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        baseUrl: { type: "string", description: "The running dev server URL, e.g. http://localhost:3000. Optional: defaults to the recorded dev server, else a managed one is started." },
        routes: { type: "array", items: { type: "string" }, description: "Routes to measure; default ['/']. Include island routes (e.g. '/fontlab')." },
        targets: {
          type: "object",
          description: "Optional explicit families to verify against (defaults to the pick in selection.json).",
          properties: { display: { type: "string" }, body: { type: "string" }, mono: { type: "string" } },
        },
        ensureServer: { type: "boolean", description: "Default true: start the project's dev server (managed, 127.0.0.1, stopped after) when none is reachable. false forbids starting processes." },
        executablePath: { type: "string", description: "Optional Chrome/Chromium binary path (usually unnecessary)." },
      },
      required: ["projectDir"],
    },
    handler: (a, { log }) => engine.verifyShip(a.projectDir, { baseUrl: a.baseUrl, routes: a.routes, targets: a.targets, ensureServer: a.ensureServer, executablePath: a.executablePath, log }),
  },
  {
    name: "font_lab_rewire_dead_roles",
    description:
      "Fix a role that font_lab_analyze flags as DEAD — declared but not actually rendered (common with Tailwind v4 @theme inline + a hand-written `font-family: var(--font-display)`, which resolves to nothing). Points those raw usages at the published leaf variable so the font renders, making the swap visible. Reversible via font_lab_undo. Offer this when analyze reports dead roles and the user wants that role to actually change.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.rewire(a.projectDir),
  },
  {
    name: "font_lab_undo",
    description: "Revert Font Lab's last apply or rewire, restoring the edited files byte-for-byte from the backup.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.undo(a.projectDir),
  },
  {
    name: "font_lab_screenshot_directions",
    description:
      "Screenshot the human's REAL RUNNING SITE in each curated direction — the headless choosing moment, and it works on ANY framework. On Next.js with the panel init'd it drives the panel; on every other stack (Vite / Astro / Remix / SvelteKit / TanStack / plain CSS) it paints the rendered page directly through the census — the same machinery the panel flips with — after injecting the parity @font-face inline (no init, no project writes: preview fonts cache under .font-lab/, never public/). If NO dev server is reachable it STARTS the project's own dev command itself (managed: bound to 127.0.0.1 — sidesteps IPv6-only binds and sandboxed-shell backgrounding — health-checked, and stopped after the capture); pass ensureServer:false to forbid that, or baseUrl to use a server you already run. Directions default to the composed set persisted by font_lab_compose_directions (.font-lab/preview.json) — with none, it ERRORS rather than silently capturing the untailored starter menu (allowFallback:true opts in deliberately). Returns a manifest per direction {id, name, vibe, rationale, fonts, screenshot (full-page PNG), heroShot (viewport JPEG — chat/phone-sized, SHOW THESE)} plus a 'current' before-shot — show the hero shots to the human and ask them to pick an id. PREFER THIS over font_lab_preview whenever a dev server exists or can be started: these are their actual pages, not specimen cards. Makes no edits.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        baseUrl: { type: "string", description: "A dev server you already run, e.g. http://localhost:3000 or :5173. Optional — with none reachable, Font Lab starts the project's dev command itself (see ensureServer)." },
        directions: { type: "array", items: { type: "object" }, description: "The directions to capture (from compose_directions). Defaults to the persisted composed set (.font-lab/preview.json); with neither, this ERRORS instead of silently using the starter menu." },
        allowFallback: { type: "boolean", description: "Capture the deterministic starter menu when nothing was composed — only if the user explicitly wants the untailored default." },
        ensureServer: { type: "boolean", description: "Default true: start the project's dev server (managed, 127.0.0.1, stopped after) when none is reachable. false forbids starting processes." },
        routes: { type: "array", items: { type: "string" }, description: "Route(s) to capture; defaults to ['/']." },
        outDir: { type: "string", description: "Where to write images; defaults to <project>/.font-lab/previews." },
        executablePath: { type: "string", description: "Optional path to a Chrome/Chromium binary. Usually unnecessary — it finds a system/pre-installed browser automatically." },
      },
      required: ["projectDir"],
    },
    handler: (a, { log }) =>
      engine.captureDirections(a.projectDir, {
        baseUrl: a.baseUrl,
        directions: a.directions,
        allowFallback: a.allowFallback === true,
        ensureServer: a.ensureServer,
        routes: a.routes,
        outDir: a.outDir,
        executablePath: a.executablePath,
        log,
      }),
  },
  {
    name: "font_lab_preview",
    description:
      "Build a self-contained HTML 'choosing sheet' — one card per direction, the parity fonts EMBEDDED (opens offline), rendered on the project's own palette and copy (when found; the sheet labels itself honestly when it had to fall back to stock specimen text). This is the NO-DEV-SERVER fallback: it works on ANY framework and needs nothing running — the right choice when no dev server can start, or the human wants an offline artifact. These are SPECIMEN CARDS, not the human's pages: when a dev server exists or can be started (any framework), prefer font_lab_screenshot_directions — it screenshots their REAL site per direction. Directions default to the composed set persisted by font_lab_compose_directions; with none, it ERRORS rather than silently rendering the untailored starter menu (allowFallback:true opts in deliberately). Returns the HTML file path — SHOW it to the human (or open it) and have them pick an id. Each card carries a live render-check badge: a real width-diff that catches a font that silently failed to load, NOT a fonts.check false-positive. Fetches + inlines the fonts. Then select_direction → apply.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        directions: { type: "array", items: { type: "object" }, description: "The brief-driven directions to render (from compose_directions). Defaults to the persisted composed set." },
        allowFallback: { type: "boolean", description: "Render the deterministic starter menu when nothing was composed — only if the user explicitly wants the untailored default." },
        vibe: { type: "string" },
        count: { type: "number" },
      },
      required: ["projectDir"],
    },
    handler: (a, { log }) => engine.previewSpecimen(a.projectDir, { directions: a.directions, allowFallback: a.allowFallback === true, vibe: a.vibe, count: a.count, log }),
  },
  {
    name: "font_lab_preview_screenshots",
    description:
      "VERIFIED screenshots of the portable preview sheet (font_lab_preview) — one PNG per direction card, each render-checked (a real width-diff catches a font that silently fell back; a failed load is reported, never passed off as the real face). Works on ANY framework, no dev server and no panel needed — the headless companion to font_lab_preview for cloud/web/phone sessions where the human can't open the HTML themselves. SHOW the images to the human and ask them to pick an id, then record it with font_lab_select. Directions default to the persisted composed set (or pass a prior sheet's htmlPath) — builds the sheet first if needed; with nothing composed it ERRORS rather than silently using the starter menu.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        directions: { type: "array", items: { type: "object" }, description: "The brief-driven directions to render (from compose_directions). Omit if passing htmlPath; defaults to the persisted composed set." },
        htmlPath: { type: "string", description: "Path to an already-built preview sheet (from font_lab_preview) to screenshot as-is." },
        allowFallback: { type: "boolean", description: "Render the deterministic starter menu when nothing was composed — only if the user explicitly wants the untailored default." },
        outDir: { type: "string", description: "Where to write PNGs; defaults to <project>/.font-lab/previews." },
        executablePath: { type: "string", description: "Optional Chrome/Chromium binary path (usually unnecessary)." },
      },
      required: ["projectDir"],
    },
    handler: (a) => engine.screenshotSpecimen(a.projectDir, { htmlPath: a.htmlPath, outDir: a.outDir, executablePath: a.executablePath, directions: a.directions, allowFallback: a.allowFallback === true }),
  },
  {
    name: "font_lab_select",
    description:
      "Record the human's pick by direction id — the HEADLESS counterpart to clicking Pick in the panel. Use AFTER the human has chosen from the screenshots (you must still let the HUMAN make the call — never auto-select). The id resolves against the SAME set the human was shown: explicit `directions` if passed, else the composed set persisted by font_lab_compose_directions. Writes the same selection.json the panel writes, so font_lab_apply ships it identically. Supports a mixed pick: pass roles {display, body, mono} as direction ids to take each role from a different direction.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        directionId: { type: "string", description: "The id the human picked (from compose/screenshots)." },
        roles: {
          type: "object",
          description: "Optional mixed pick — per-role direction ids, e.g. {display:'editorial-serif', body:'modern-grotesque'}.",
          properties: { display: { type: "string" }, body: { type: "string" }, mono: { type: "string" } },
        },
      },
      required: ["projectDir", "directionId"],
    },
    handler: (a) => engine.selectDirection(a.projectDir, { directionId: a.directionId, roles: a.roles }),
  },
  {
    name: "font_lab_live_instructions",
    description:
      "Get ready-to-run commands to launch the FULL live editor (flip / mix / compare directions in a real browser) — for when the headless screenshots aren't enough and the human wants to drive it themselves. Detects the project's dev command. In a LOCAL session these run in the agent's/human's terminal here; in a REMOTE/container session the result reframes them as commands for the human's OWN machine after pulling the branch (never a localhost URL handoff the human can't reach — pass `remote` to override detection).",
    inputSchema: { type: "object", properties: { projectDir: proj, remote: remoteParam }, required: ["projectDir"] },
    handler: (a) => engine.liveInstructions(a.projectDir, { remote: a.remote }),
  },
];

// Resolve a tool by its full name or its short form ("start" → font_lab_start).
export function findTool(name) {
  const n = String(name || "").trim();
  return TOOLS.find((t) => t.name === n) || TOOLS.find((t) => t.name === `font_lab_${n}`) || null;
}

// Enforce the schema's required args with a clear message — otherwise a missing projectDir
// reaches the handler as `undefined` and crashes with a cryptic path error. Returns the error
// STRING (both transports prefix/route it their own way) or null when valid.
export function missingArgsError(tool, args) {
  const missing = (tool.inputSchema?.required || []).filter((k) => args[k] === undefined || args[k] === null);
  return missing.length ? `Error: missing required argument(s) for ${tool.name}: ${missing.join(", ")}` : null;
}

// Run a tool's handler. `log` goes to stderr on both transports (stdout is the protocol/result).
export async function invokeTool(tool, args, { log } = {}) {
  return tool.handler(args, { log: log || (() => {}) });
}

// ---- delivery notes: state that must reach the agent on EVERY result --------------------
// Piggyback delivery (the dogfood's lost-pick fix): an unfulfilled in-panel "more options" ask
// and an unapplied human pick ride every tool result until handled — an agent that never parks
// on a wait still finds out the next time it touches Font Lab, whichever transport it used.

// Noise control for the pick piggyback: the FULL nudge (scope + next steps) rides once per
// pick per process; after that a one-liner keeps the reminder cheap. Keyed by pickedAt so a
// NEW pick gets the full treatment again.
let lastNudgedPick = null;

// Compare this process's version against the project's own node_modules install — the npx cache
// serves whatever it froze at first run, so the two drift after `npm install font-lab@latest`.
// Cached per project: the answer can't change within one process (both versions are fixed for
// its lifetime).
const driftCache = new Map();
function versionDrift(projectDir) {
  if (driftCache.has(projectDir)) return driftCache.get(projectDir);
  let warn = null;
  try {
    const local = JSON.parse(readFileSync(path.join(projectDir, "node_modules", "font-lab", "package.json"), "utf8"));
    if (isRealVersion(local.version) && isRealVersion(VERSION) && cmpVersions(local.version, VERSION) > 0)
      warn = `This font-lab process is running ${VERSION}, but the project has ${local.version} installed — tools and fixes are missing. Have the human reload the agent session so the MCP server restarts on the new version, and run \`npx font-lab install\` once to pin the registration to the project's own install. (Until then, \`npx font-lab@latest run <tool>\` always runs the newest version.)`;
  } catch {} // font-lab isn't a project-local dep here — nothing to compare against
  driftCache.set(projectDir, warn);
  return warn;
}

// Annotate a successful tool payload with the pending-work notes. Only plain objects can carry
// notes; arrays/strings pass through untouched. `toolName` gates which tools skip which note
// (the tools that receive or fulfill that state themselves).
export function withDeliveryNotes(toolName, args, payload) {
  const piggybackable = args.projectDir && payload && typeof payload === "object" && !Array.isArray(payload);
  if (!piggybackable) return payload;
  let out = payload;
  if (!/wait|more_directions/.test(toolName)) {
    try {
      const pending = engine.readMoreRequest(args.projectDir);
      if (pending)
        out = {
          ...out,
          pendingHumanRequest: {
            note: "UNFULFILLED: the human clicked 'Get more' in the panel and is waiting. Compose new directions honoring request.brief (avoiding request.exclude), then call font_lab_more_directions.",
            request: pending,
          },
        };
    } catch {}
  }
  if (!/wait|more_directions|read_pick|select|apply|undo|verify/.test(toolName)) {
    try {
      const pick = pendingPick(args.projectDir);
      if (pick) {
        out = {
          ...out,
          pendingHumanPick:
            lastNudgedPick === pick.pickedAt
              ? { note: `Reminder: the human's pick "${pick.direction?.name ?? "?"}" (${pick.age} ago) is still unapplied — offer font_lab_apply.`, pickedAt: pick.pickedAt }
              : {
                  note:
                    `UNDELIVERED PICK: the human picked "${pick.direction?.name ?? "?"}" ${pick.age} ago in the live panel and it has NOT been applied.` +
                    (pick.stale ? " The pick is old — confirm with the human that it still stands before applying." : "") +
                    (pick.scope ? ` Ship scope: ${pick.scope}.` : "") +
                    " Offer font_lab_apply; after applying, run font_lab_verify for the convergence receipt — anything apply can't reach comes back as a ready-to-execute work order.",
                  direction: pick.direction,
                  pickedAt: pick.pickedAt,
                  roles: pick.roles,
                },
        };
        lastNudgedPick = pick.pickedAt;
      }
    } catch {}
  }
  const drift = versionDrift(args.projectDir);
  if (drift) out = { ...out, mcpVersionDrift: drift };
  return out;
}
