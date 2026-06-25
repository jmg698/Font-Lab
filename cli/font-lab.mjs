#!/usr/bin/env node
// Font Lab CLI — M1 walking skeleton.
//
// Runs the localhost write-back endpoint the dev panel POSTs a pick to, persists it to
// `.font-lab/selection.json` (+ appends `.font-lab/picks.log.jsonl`), and prints the pick.
// This is the seam where M4's codegen will hook in: pick lands here -> agent ships it.
//
// Usage: node cli/font-lab.mjs [--project <dir>] [--port <n>]

import http from "node:http";
import path from "node:path";
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const PORT = Number(arg("--port", "7777"));
const PROJECT = path.resolve(arg("--project", process.cwd()));
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
