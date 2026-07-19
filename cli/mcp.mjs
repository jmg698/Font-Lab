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

import { TOOLS, missingArgsError, invokeTool, withDeliveryNotes } from "./tools.mjs";
import { refreshAgentHeartbeat, clearAgentHeartbeat } from "./state.mjs";
import { VERSION } from "./version.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER = { name: "font-lab", version: VERSION };
const log = (...a) => process.stderr.write("[font-lab mcp] " + a.join(" ") + "\n");

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
      const missing = missingArgsError(tool, args);
      if (missing) return reply(id, { content: [{ type: "text", text: missing }], isError: true });
      if (args.projectDir) {
        trackProject(args.projectDir);
        refreshAgentHeartbeat(args.projectDir);
      }
      try {
        const out = await invokeTool(tool, args, { log });
        const payload = withDeliveryNotes(tool.name, args, out);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
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
