#!/usr/bin/env node
// Font Lab MCP server (M5) — wraps the engine so an agent can drive the whole loop:
//   analyze → (curate OR list_catalog + compose_directions) → prepare_preview → read_pick → apply
//
// Minimal, dependency-free JSON-RPC 2.0 over stdio (newline-delimited messages, per the MCP
// stdio transport). Protocol on stdout; all logging on stderr.
//
// Discoverability ("SEO for agents") lives in the tool descriptions below: they're written so
// an agent reaches for Font Lab the moment a user wants to choose, change, or improve fonts —
// and so it understands the contract (the HUMAN picks; the agent curates and ships).

import * as engine from "./engine.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER = { name: "font-lab", version: "0.8.2" };
const log = (...a) => process.stderr.write("[font-lab mcp] " + a.join(" ") + "\n");

const proj = { type: "string", description: "Absolute path to the user's Next.js + Tailwind project root." };

const TOOLS = [
  {
    name: "font_lab_start",
    description:
      "START HERE when a user wants to choose, change, or improve fonts. Returns the project analysis, a `context` block (the project's existing color palette, brand/design docs, and a sample of the real copy — so your options fit THIS project), PLUS Font Lab's design brief: the framing questions to ASK THE HUMAN FIRST (what feeling? how bold a departure? any brand to evoke or avoid?), a strategy scaffold (reason about the brief before naming fonts), the overexposed defaults to AVOID (Inter, Geist, Space Grotesk, …), distinctive references to reach for, and the rule that every direction needs a brief-tied rationale. Read the context, ask the intake questions and WAIT for the answers before proposing any fonts — that's what makes the result tailored instead of generic. The HUMAN always makes the final pick.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.start(a.projectDir),
  },
  {
    name: "font_lab_analyze",
    description:
      "Audit a Next.js + Tailwind project's CURRENT typography before changing it: framework, App/Pages router, Tailwind version, the current display/body/mono fonts, how they're wired, and coverage warnings (e.g. a font that's declared but not actually rendered). Prefer font_lab_start as the front door — it runs this AND returns the design brief (intake questions + what to avoid/reach for). Use this directly only when you just need the raw audit.",
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
      "FALLBACK menu — ~5 deterministic font directions (display+body+mono pairings) that move off the project's current fonts, no LLM. Use this when you have NO brief from the user. When you DO have a brief (from font_lab_start's intake questions), prefer font_lab_compose_directions and tailor the options to what they asked for — that's the better experience. Pass an optional 'vibe' to steer the fallback.",
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
      "The PRIMARY way to build the menu: assemble tailored font directions for the user's brief (from font_lab_start's intake answers). Pass the user's stated direction as `brief` — if you omit it, the result is INFERRED rather than tailored, and you'll get a warning telling you to ask first. Reach PAST the overexposed defaults — give each direction a distinctive face and a one-line rationale tying it to what they asked for. Each direction needs display, body, and mono families. Families can be ANY shippable font (catalog, ~1,500 Google fonts, or a curated open-foundry face) — the gate admits them; check uncertain ones first with font_lab_check_fonts. REJECTS a menu that's too generic (any direction overexposed in both display and body, or a set whose every display is an overexposed default) — fix it with distinctive faces, or pass force:true only if the user explicitly wants the default look. Returns validated, preview-ready directions plus warnings (overexposed-default flags, and a best-effort fidelity note when a font can't be guaranteed byte-for-byte).",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { ...proj, description: "Optional: the project root, so admitted fonts are cached for the preview build." },
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
      "SET UP the live preview panel in the project, built from the directions YOU composed for the user's brief — self-hosts the bundles, installs the dev panel, mounts it (dev-only). Pass the `directions` from font_lab_compose_directions; the panel shows exactly those. This REFUSES without directions (so the generic default menu can't be mounted without asking the user first) — only pass allowFallback:true if the user explicitly wants the deterministic default. Run after start → intake → compose. Idempotent + reversible (font_lab_uninit). Reports dead roles (offer font_lab_rewire_dead_roles).",
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
    handler: (a) => engine.init(a.projectDir, { directions: a.directions, allowFallback: a.allowFallback === true, vibe: a.vibe, count: a.count, log }),
  },
  {
    name: "font_lab_more_directions",
    description:
      "Add MORE options to the live panel — when the human wants to keep exploring beyond the current set. Compose additional tailored directions first (font_lab_compose_directions), then pass them here; they're admitted and APPENDED to the panel (existing options are kept), and the panel updates live. Use this whenever the user asks 'what else?' / 'show me more' — the menu is never capped.",
    inputSchema: {
      type: "object",
      properties: { projectDir: proj, directions: { type: "array", items: { type: "object" }, description: "The new directions to append (from compose_directions)." } },
      required: ["projectDir", "directions"],
    },
    handler: (a) => engine.expandPreview(a.projectDir, { directions: a.directions, log }),
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
    handler: (a) => engine.preparePreview(a.projectDir, { directions: a.directions, allowFallback: a.allowFallback === true, vibe: a.vibe, count: a.count, log }),
  },
  {
    name: "font_lab_read_pick",
    description:
      "Read the human's pick (.font-lab/selection.json). Returns null until they've chosen in the panel. Poll this after prepare_preview; ship it with font_lab_apply once present.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.readSelection(a.projectDir),
  },
  {
    name: "font_lab_apply",
    description:
      "Ship the human's pick: apply the exact next/font + Tailwind edits to the project, idempotently and reversibly (backup-first). Refuses out-of-branch projects with a clear reason. Run after read_pick returns a selection.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.apply(a.projectDir),
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
      "HEADLESS pick mode — when the human has no live browser to flip in (a web/cloud session, or they're on a phone), screenshot the running site in each curated direction so they can pick from IMAGES instead of a live panel. Requires font_lab_init done and the project's dev server running; pass its baseUrl (e.g. http://localhost:3000). Returns a manifest of {id, name, vibe, rationale, fonts, screenshot path} per direction (plus a 'current' before-shot) — SHOW these images to the human and ask them to pick an id. The screenshots are driven through the real preview panel, so they are faithful to what ships. Makes no edits.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        baseUrl: { type: "string", description: "The running dev server URL, e.g. http://localhost:3000." },
        routes: { type: "array", items: { type: "string" }, description: "Route(s) to capture; defaults to ['/']." },
        outDir: { type: "string", description: "Where to write PNGs; defaults to <project>/.font-lab/previews." },
        executablePath: { type: "string", description: "Optional path to a Chrome/Chromium binary. Usually unnecessary — it finds a system/pre-installed browser automatically." },
      },
      required: ["projectDir", "baseUrl"],
    },
    handler: (a) => engine.captureDirections(a.projectDir, { baseUrl: a.baseUrl, routes: a.routes, outDir: a.outDir, executablePath: a.executablePath }),
  },
  {
    name: "font_lab_select",
    description:
      "Record the human's pick by direction id — the HEADLESS counterpart to clicking Pick in the panel. Use AFTER the human has chosen from the screenshots (you must still let the HUMAN make the call — never auto-select). Writes the same selection.json the panel writes, so font_lab_apply ships it identically. Supports a mixed pick: pass roles {display, body, mono} as direction ids to take each role from a different direction.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: proj,
        directionId: { type: "string", description: "The id the human picked (from curate/screenshots)." },
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
      "Get ready-to-run commands to launch the FULL live editor (flip / mix / compare directions in a real browser) — for when the headless screenshots aren't enough and the human wants to drive it themselves. Detects the project's dev command. These run in a local terminal: a Mac/Linux terminal or the integrated terminal in VS Code / Cursor / the Claude Code IDE extension.",
    inputSchema: { type: "object", properties: { projectDir: proj }, required: ["projectDir"] },
    handler: (a) => engine.liveInstructions(a.projectDir),
  },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    if (method === "initialize") {
      return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return; // notifications
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    }
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
      const args = params.arguments || {};
      // Enforce the schema's required args with a clear in-band message — otherwise a missing
      // projectDir reaches the handler as `undefined` and crashes with a cryptic path error.
      const missing = (tool.inputSchema?.required || []).filter((k) => args[k] === undefined || args[k] === null);
      if (missing.length) {
        return reply(id, { content: [{ type: "text", text: `Error: missing required argument(s) for ${tool.name}: ${missing.join(", ")}` }], isError: true });
      }
      try {
        const out = await tool.handler(args);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // tool-level errors are reported in-band so the agent can react
        return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    if (!isNotification) fail(id, -32601, `method not found: ${method}`);
  } catch (e) {
    if (!isNotification) fail(id, -32603, e.message);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log("parse error:", line.slice(0, 120));
      continue;
    }
    handle(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready — ${TOOLS.length} tools, protocol ${PROTOCOL_VERSION}`);
