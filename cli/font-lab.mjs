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
// Bare `font-lab` (no args) prints help — it must NOT silently boot a long-running server, which
// an agent exploring the CLI would hang on. A leading flag (`--project …`) still means `serve`
// for back-compat; an explicit word selects that subcommand.
const first = process.argv[2];
const SUB = !first ? "help" : first.startsWith("-") ? "serve" : first;
if (SUB === "install" || SUB === "uninstall") {
  const { runInstall, runUninstall } = await import("./install.mjs");
  if (SUB === "install") runInstall();
  else runUninstall();
} else if (SUB === "mcp") {
  await import("./mcp.mjs"); // self-runs the stdio server on import
} else if (SUB === "help" || SUB === "--help" || SUB === "-h") {
  console.log(
    [
      "Font Lab",
      "  font-lab install [--host <list|all>] [--project <dir>] [--no-mcp] [--no-skill] [--local] [--dry-run]",
      "  font-lab uninstall [--project <dir>]",
      "  font-lab mcp                      run the MCP server (stdio)",
      "  font-lab serve [--project <dir>] [--port <n>] [--apply]   pick write-back endpoint",
    ].join("\n"),
  );
} else {
  runServe();
}

function runServe() {

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const PORT = Number(arg("--port", "7777"));
const PROJECT = path.resolve(arg("--project", process.cwd()));
const AUTO_APPLY = process.argv.includes("--apply"); // pick -> ship, in one step
const FLDIR = path.join(PROJECT, ".font-lab");
const SELECTION = path.join(FLDIR, "selection.json");
const PICKLOG = path.join(FLDIR, "picks.log.jsonl");

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
};

function printPick(sel) {
  const r = sel.roles || {};
  const fam = (x) => (x && x.family) || "?";
  console.log(`\n  ✓ picked "${sel.direction?.name ?? "?"}" (${sel.direction?.vibe ?? "?"})`);
  console.log(`      display ${fam(r.display)}   body ${fam(r.body)}   mono ${fam(r.mono)}`);
  console.log(`      wrote ${path.relative(process.cwd(), SELECTION)}`);
  console.log(`      → next milestone (M4) turns this into next/font + Tailwind edits.\n`);
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
        mkdirSync(FLDIR, { recursive: true });
        writeFileSync(SELECTION, JSON.stringify(sel, null, 2) + "\n");
        appendFileSync(
          PICKLOG,
          JSON.stringify({ at: sel.pickedAt, direction: sel.direction?.id, roles: sel.roles }) + "\n",
        );
        printPick(sel);
        if (AUTO_APPLY) {
          import("./codegen.mjs")
            .then(({ applySelection }) => {
              const r = applySelection(PROJECT);
              console.log(`  → applied to project: ${r.edited.join(", ")} (\`font-lab undo\` to revert)\n`);
            })
            .catch((e) => console.error(`  apply failed: ${e.message}\n`));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
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

  server.listen(PORT, () => {
    console.log(`Font Lab — walking skeleton`);
    console.log(`  endpoint  http://localhost:${PORT}  (POST /select, GET /selection)`);
    console.log(`  project   ${PROJECT}`);
    console.log(`  Open your dev site, flip directions in the panel (← →), and hit Pick.`);
    console.log(`  Waiting for a pick…`);
  });
}
