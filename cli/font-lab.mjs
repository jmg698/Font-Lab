#!/usr/bin/env node
// Font Lab CLI — entry point.
//
// Subcommands:
//   install            wire Font Lab into your machine + project (skill + MCP server)
//   uninstall          undo the above
//   mcp                run the MCP server (stdio) — what `.mcp.json` launches
//   serve  (default)   run the localhost write-back endpoint the dev panel POSTs a pick to,
//                      persist it to `.font-lab/selection.json` (+ append picks.log.jsonl).
//                      This is the seam where codegen hooks in: pick lands here -> agent ships it.
//
// Usage:
//   npx font-lab install [--project <dir>] [--no-mcp] [--local] [--dry-run]
//   npx font-lab uninstall [--project <dir>]
//   node cli/font-lab.mjs [serve] [--project <dir>] [--port <n>] [--apply]

import http from "node:http";
import path from "node:path";
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";

// ---- subcommand dispatch ---------------------------------------------------
// CRITICAL: a metadata probe must NEVER boot the long-running server. Agents routinely run
// `font-lab --version` / `-v` to sanity-check an install; the old dispatch treated ANY leading
// flag as `serve`, so `--version` silently started the pick endpoint on :7777 and hung (or got
// pkill'd). Only KNOWN serve flags mean serve; every other flag/unknown word prints help.
const first = process.argv[2];
const isServeFlag = (a) => ["--project", "--port", "--host", "--once", "--apply", "-p"].includes(a);
let SUB;
if (!first || ["help", "--help", "-h"].includes(first)) SUB = "help";
else if (["--version", "-v", "version"].includes(first)) SUB = "version";
else if (["install", "uninstall", "mcp", "serve"].includes(first)) SUB = first;
else if (isServeFlag(first)) SUB = "serve";
else SUB = "help"; // unknown word or flag -> help; never surprise-boot the server

if (SUB === "install" || SUB === "uninstall") {
  const { runInstall, runUninstall } = await import("./install.mjs");
  if (SUB === "install") runInstall();
  else runUninstall();
} else if (SUB === "mcp") {
  await import("./mcp.mjs"); // self-runs the stdio server on import
} else if (SUB === "version") {
  try {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
  } catch {
    console.log("unknown");
  }
} else if (SUB === "help") {
  console.log(
    [
      "Font Lab",
      "  font-lab install [--host <list|all>] [--project <dir>] [--no-mcp] [--no-skill] [--local] [--dry-run]",
      "  font-lab uninstall [--project <dir>]",
      "  font-lab mcp                      run the MCP server (stdio)",
      "  font-lab serve [--project <dir>] [--port <n>] [--host <ip>] [--once] [--apply]",
      "                 pick write-back endpoint (loopback-only by default; --once exits",
      "                 after the first pick so a background task wakes your agent)",
      "  font-lab --version                print the version and exit (never starts a server)",
    ].join("\n"),
  );
} else {
  runServe();
}

async function runServe() {

const { readHandoffState, writeAppliedStamp } = await import("./state.mjs");
const { VERSION } = await import("./version.mjs");
const { watch } = await import("node:fs");

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const PORT = Number(arg("--port", "7777"));
// Loopback by default: the panel always POSTs from a browser on this machine, and the
// endpoint accepts writes — no reason to listen on the LAN. `--host 0.0.0.0` opts back in
// (e.g. flipping directions from a phone on the same network).
const HOST = arg("--host", "127.0.0.1");
const PROJECT = path.resolve(arg("--project", process.cwd()));
const AUTO_APPLY = process.argv.includes("--apply"); // pick -> ship, in one step
// --once: exit after the first pick, with the selection as the final stdout line. This turns
// the pick into a process-exit event — the one signal every agent harness reliably watches.
// (An agent runs `font-lab serve --once` as a background task and is woken when it exits.)
const ONCE = process.argv.includes("--once");
const FLDIR = path.join(PROJECT, ".font-lab");
const SELECTION = path.join(FLDIR, "selection.json");
const PICKLOG = path.join(FLDIR, "picks.log.jsonl");

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
};

// ---- SSE: the panel's live view of the handoff -----------------------------------------
// GET /events streams status snapshots so the panel can show, without polling: endpoint up,
// agent waiting (or --once armed), pick received, apply landed. Watching .font-lab/ means
// out-of-band writers (font_lab_select, apply from another terminal) surface here too.
const sseClients = new Set();
const statusPayload = () => ({
  ok: true,
  once: ONCE,
  autoApply: AUTO_APPLY,
  version: VERSION, // running tool version — the panel compares it against its own stamp
  ...readHandoffState(PROJECT),
  // --once means an agent parked a process on this pick; count it as a listening agent.
  agentWaiting: ONCE || readHandoffState(PROJECT).agentWaiting,
});
const broadcast = (event, data) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(frame);
};
mkdirSync(FLDIR, { recursive: true });
let watchDebounce = null;
try {
  watch(FLDIR, () => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => broadcast("status", statusPayload()), 60);
  });
} catch {} // fs.watch is advisory here — POST /select broadcasts directly regardless

function printPick(sel) {
  const r = sel.roles || {};
  const fam = (x) => (x && x.family) || "?";
  console.log(`\n  ✓ picked "${sel.direction?.name ?? "?"}" (${sel.direction?.vibe ?? "?"})`);
  console.log(`      display ${fam(r.display)}   body ${fam(r.body)}   mono ${fam(r.mono)}`);
  console.log(`      wrote ${path.relative(process.cwd(), SELECTION)}`);
  console.log(`      → run \`npx font-lab-apply\` to ship it (next/font on Next; self-hosted @font-face elsewhere).\n`);
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(statusPayload()));
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`event: status\ndata: ${JSON.stringify(statusPayload())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.method === "GET" && req.url === "/selection") {
    const cur = existsSync(SELECTION) ? readFileSync(SELECTION, "utf8") : "{}";
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(cur);
  }
  if (req.method === "POST" && req.url === "/select") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const sel = JSON.parse(body);
        // Capture presence BEFORE the write: a blocked waiter resolves (and clears its flag)
        // the instant selection.json lands, so sampling afterwards would tell the human
        // "no agent" right as their agent takes delivery.
        const wasWaiting = ONCE || statusPayload().agentWaiting;
        mkdirSync(FLDIR, { recursive: true });
        writeFileSync(SELECTION, JSON.stringify(sel, null, 2) + "\n");
        appendFileSync(
          PICKLOG,
          JSON.stringify({ at: sel.pickedAt, direction: sel.direction?.id, roles: sel.roles }) + "\n",
        );
        printPick(sel);
        // Ack tells the panel what happens next, so it can narrate honestly:
        // an agent is parked on this pick (--once), it'll auto-ship (--apply), or the
        // human should hand it to their agent.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, once: ONCE, autoApply: AUTO_APPLY, agentWaiting: wasWaiting }));
        broadcast("picked", { direction: sel.direction ?? null, pickedAt: sel.pickedAt ?? null });
        broadcast("status", statusPayload());

        const finish = async () => {
          if (AUTO_APPLY) {
            try {
              const { applySelection } = await import("./codegen.mjs");
              const r = await applySelection(PROJECT);
              writeAppliedStamp(PROJECT, r);
              console.log(`  → applied to project: ${r.edited.join(", ")} (\`font-lab undo\` to revert)\n`);
              broadcast("applied", { edited: r.edited, runId: r.runId });
              broadcast("status", statusPayload());
            } catch (e) {
              console.error(`  apply failed: ${e.message}\n`);
              broadcast("error", { message: `apply failed: ${e.message}` });
            }
          }
          if (ONCE) {
            // The selection as the final stdout line — the harness hands this to the agent.
            console.log(JSON.stringify({ picked: true, selection: sel }));
            // Give the ack + SSE frames a beat to flush, then exit-on-pick. Exit must be
            // unconditional: an attached SSE client would otherwise hold server.close open.
            setTimeout(() => {
              for (const c of sseClients) {
                try { c.destroy(); } catch {}
              }
              try { server.close(); } catch {}
              setTimeout(() => process.exit(0), 120);
            }, 80);
          }
        };
        void finish();
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

  server.listen(PORT, HOST, () => {
    console.log(`Font Lab — pick endpoint`);
    console.log(`  endpoint  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (POST /select · GET /selection /status /events)`);
    console.log(`  project   ${PROJECT}`);
    if (HOST !== "127.0.0.1") console.log(`  binding   ${HOST} (non-loopback — anything on your network can post a pick)`);
    if (ONCE) console.log(`  mode      --once: exits after the first pick (the exit is your wake-up signal)`);
    if (AUTO_APPLY) console.log(`  mode      --apply: pick ships immediately (reversible via font-lab undo)`);
    console.log(`  Open your dev site, flip directions in the panel (← →), and hit Pick.`);
    console.log(`  Waiting for a pick…`);
  });
}
