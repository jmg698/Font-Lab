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
const SERVER = { name: "font-lab", version: "0.7.0" };
const log = (...a) => process.stderr.write("[font-lab mcp] " + a.join(" ") + "\n");

const proj = { type: "string", description: "Absolute path to the user's Next.js + Tailwind project root." };

const TOOLS = [
  {
    name: "font_lab_analyze",
    description:
      "Audit a Next.js + Tailwind project's CURRENT typography before changing it: framework, App/Pages router, Tailwind version, the current display/body/mono fonts, how they're wired, and coverage warnings (e.g. a font that's declared but not actually rendered). ALWAYS run this first when a user wants to pick, change, or improve fonts.",
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
    name: "font_lab_curate",
    description:
      "Get ~5 tasteful, ready-to-preview font directions for a project (display+body+mono pairings with a name, vibe, and rationale). Deterministic, no LLM — a strong DEFAULT menu that moves off the project's current fonts. Pass an optional 'vibe' to steer it. You can also ignore this and compose your own with list_catalog + compose_directions.",
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
      "Assemble your OWN font directions from catalog fonts when you want to tailor the options to the user's request (this is how the agent takes the wheel on the menu). Each direction needs display, body, and mono families. Every family MUST be a catalog member (run list_catalog) — that's what guarantees the preview matches what ships. Returns validated, preview-ready directions (and warnings for unusual role choices).",
    inputSchema: {
      type: "object",
      properties: {
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
    handler: (a) => engine.composeDirections(a.directions),
  },
  {
    name: "font_lab_init",
    description:
      "SET UP Font Lab in the project so the human can preview live — self-hosts the parity bundles, installs the dev panel, and mounts it (dev-only) in the layout. This is the one-shot setup: run it after font_lab_analyze, then start the dev server and tell the human to flip fonts in the panel (bottom-right) and Pick. Idempotent and reversible (font_lab_uninit). Reports any dead roles (offer font_lab_rewire_dead_roles).",
    inputSchema: {
      type: "object",
      properties: { projectDir: proj, vibe: { type: "string" }, count: { type: "number" } },
      required: ["projectDir"],
    },
    handler: (a) => engine.init(a.projectDir, { vibe: a.vibe, count: a.count, log }),
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
      "Build the LIVE preview bundle (self-hosted woff2 + exact next/font fallbacks) into the user's project so the HUMAN can flip through the directions on their real running site and pick one. Pass either curated/composed 'directions' or a 'vibe'. Font Lab keeps the taste decision with the human — this never auto-selects. (Fetches fonts from Google.)",
    inputSchema: {
      type: "object",
      properties: { projectDir: proj, directions: { type: "array", items: { type: "object" } }, vibe: { type: "string" }, count: { type: "number" } },
      required: ["projectDir"],
    },
    handler: (a) => engine.preparePreview(a.projectDir, { directions: a.directions, vibe: a.vibe, count: a.count, log }),
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
      },
      required: ["projectDir", "baseUrl"],
    },
    handler: (a) => engine.captureDirections(a.projectDir, { baseUrl: a.baseUrl, routes: a.routes, outDir: a.outDir }),
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
      try {
        const out = await tool.handler(params.arguments || {});
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
