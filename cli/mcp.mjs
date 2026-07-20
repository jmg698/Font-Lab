#!/usr/bin/env node
// Font Lab MCP server — the stdio transport over the SHARED tool table (tools.mjs), so an agent
// can drive the whole loop:
//   start → intake → compose_directions → (init | screenshot_directions | preview) → select/pick → apply → verify
//
// Minimal, dependency-free JSON-RPC 2.0 over stdio (newline-delimited messages, per the MCP
// stdio transport). Protocol on stdout; all logging on stderr.
//
// The tool definitions, arg validation, and the piggyback delivery notes all live in tools.mjs —
// `npx font-lab run <tool>` dispatches the SAME table, so the two surfaces cannot drift. That CLI
// twin is the bridge for the MCP dead zones: right after install (tools not live until the
// session reloads) and mid-session server drops on cloud harnesses.

import { readFileSync } from "node:fs";
import { TOOLS, missingArgsError, invokeTool, withDeliveryNotes } from "./tools.mjs";
import { refreshAgentHeartbeat, clearAgentHeartbeat } from "./state.mjs";
import { VERSION } from "./version.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER = { name: "font-lab", version: VERSION };
const log = (...a) => process.stderr.write("[font-lab mcp] " + a.join(" ") + "\n");

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

// ---- inline images: the choosing moment reaches the CHAT, not a hidden folder --------------
// The Vite dogfood's sharpest friction: screenshots of the human's real site landed as file
// paths under .font-lab/previews/ and the human had to ask twice just to SEE them. MCP results
// carry image content blocks, so the capture tools attach their shots directly — heroShot
// (chat-sized JPEG) preferred, the specimen tool's card PNGs otherwise; the JSON text block
// keeps the full-page paths for detail. `inlineImages: false` opts out; size caps keep a huge
// run from flooding the transport (anything skipped is named so the agent reads it from disk).
const IMAGE_TOOLS = new Set(["font_lab_screenshot_directions", "font_lab_preview_screenshots"]);
const IMG_MAX_ONE = 4 * 1024 * 1024; // per-file cap, pre-base64
const IMG_MAX_TOTAL = 24 * 1024 * 1024; // whole-result cap, pre-base64

function shotImageBlocks(toolName, args, payload) {
  if (!IMAGE_TOOLS.has(toolName) || args.inlineImages === false) return [];
  const shots = Array.isArray(payload?.shots) ? payload.shots : [];
  const blocks = [];
  const skipped = [];
  let total = 0;
  for (const s of shots) {
    const file = s?.heroShot || s?.screenshot;
    if (!file) continue;
    const label = [s.id, s.name && s.name !== s.id ? s.name : null].filter(Boolean).join(" — ");
    try {
      const bytes = readFileSync(file);
      if (bytes.length > IMG_MAX_ONE || total + bytes.length > IMG_MAX_TOTAL) {
        skipped.push(label || String(file));
        continue;
      }
      total += bytes.length;
      const fonts = s.fonts ? `  (${["display", "body", "mono"].map((r) => s.fonts[r]).filter(Boolean).join(" · ")})` : "";
      blocks.push({ type: "text", text: `↓ ${label}${fonts}` });
      blocks.push({ type: "image", data: bytes.toString("base64"), mimeType: /\.png$/i.test(file) ? "image/png" : "image/jpeg" });
    } catch {
      skipped.push(`${label || file} (unreadable)`);
    }
  }
  if (blocks.length)
    blocks.unshift({
      type: "text",
      text: "The direction images are attached below — SHOW THEM to the human now, in this same turn, and ask for a pick. Full-page PNGs live at the `screenshot` paths in the JSON above for detail.",
    });
  if (skipped.length) blocks.push({ type: "text", text: `Not inlined (size caps): ${skipped.join(", ")} — read those from their paths instead.` });
  return blocks;
}

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
      const missing = missingArgsError(tool, args);
      if (missing) return reply(id, { content: [{ type: "text", text: missing }], isError: true });
      if (args.projectDir) {
        trackProject(args.projectDir);
        refreshAgentHeartbeat(args.projectDir);
      }
      try {
        const out = await invokeTool(tool, args, { log });
        const payload = withDeliveryNotes(tool.name, args, out);
        const content = [{ type: "text", text: JSON.stringify(payload, null, 2) }, ...shotImageBlocks(tool.name, args, payload)];
        return reply(id, { content });
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

let lastProjectDir = null;
const trackProject = (dir) => { if (dir) lastProjectDir = dir; };
const cleanupHeartbeat = () => { if (lastProjectDir) { try { clearAgentHeartbeat(lastProjectDir); } catch {} } };
process.on("exit", cleanupHeartbeat);
process.on("SIGINT", () => { cleanupHeartbeat(); process.exit(0); });
process.on("SIGTERM", () => { cleanupHeartbeat(); process.exit(0); });

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
