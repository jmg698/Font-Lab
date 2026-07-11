#!/usr/bin/env node
// Port self-healing test — EADDRINUSE is triaged, never thrown at the human:
//   same project + current endpoint  → idempotent success (exit 0)
//   same project + current + --once  → park on .font-lab event files (exit contract preserved)
//   same project + STALE endpoint    → POST /shutdown, take the port over
//   different project                → named error
//   not a Font Lab endpoint          → named error
// Offline; drives the real `serve` as a child process.

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "font-lab.mjs");
const PROJ = mkdtempSync(path.join(os.tmpdir(), "fl-heal-"));
const PORT = 7823;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const assert = (name, ok, extra = "") => {
  if (ok) { passed++; console.log(`PASS  ${name} ${extra}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
};

// run serve, capture output; resolves on exit or after holdMs (for the ones that keep running)
const runServe = (args, { holdMs = 8000 } = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => resolve({ child, out: () => out, code: null }), holdMs);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ child, out: () => out, code }); });
  });

const kill = (child) => { try { child.kill("SIGTERM"); } catch {} };

try {
  // ---- 1) stale same-project squatter → graceful takeover --------------------------------
  // A fake pre-existing endpoint that speaks just enough /status + /shutdown, at version 0.0.1.
  let fakeDown = false;
  const fake = http.createServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, version: "0.0.1", project: PROJ }));
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      fakeDown = true;
      setTimeout(() => fake.close(), 50);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(PORT, "127.0.0.1", r));
  const takeover = await runServe(["--project", PROJ, "--port", String(PORT)], { holdMs: 8000 });
  assert("stale squatter: shutdown requested", fakeDown);
  assert("stale squatter: takeover narrated", takeover.out().includes("taking over"));
  assert("stale squatter: new endpoint bound", takeover.out().includes("Waiting for a pick"), takeover.code !== null ? `(exited ${takeover.code}: ${takeover.out().slice(-200)})` : "");

  // ---- 2) same project + current version → idempotent success ----------------------------
  const dup = await runServe(["--project", PROJ, "--port", String(PORT)]);
  assert("current same-project: exits 0", dup.code === 0, `(code ${dup.code})`);
  assert("current same-project: says already running", dup.out().includes("already running"));

  // ---- 3) same project + current + --once → parks on event files -------------------------
  const once = await runServe(["--project", PROJ, "--port", String(PORT), "--once"], { holdMs: 2500 });
  assert("--once park: narrates parking", once.out().includes("parking on .font-lab events"));
  // a pick lands on disk (as the healthy endpoint would write it) → the parked process exits
  // with the event JSON as its final stdout line
  mkdirSync(path.join(PROJ, ".font-lab"), { recursive: true });
  writeFileSync(path.join(PROJ, ".font-lab", "selection.json"),
    JSON.stringify({ version: 1, pickedAt: new Date().toISOString(), direction: { id: "t", name: "Takeover Test" }, roles: {} }));
  const onceExit = await new Promise((resolve) => {
    once.child.on("exit", (code) => resolve(code));
    setTimeout(() => resolve("timeout"), 10_000);
  });
  assert("--once park: exits on the pick", onceExit === 0, `(${onceExit})`);
  const lastLine = once.out().trim().split("\n").pop() || "";
  let ev = null;
  try { ev = JSON.parse(lastLine); } catch {}
  assert("--once park: last stdout line is the event JSON", ev?.event === "pick" && ev?.selection?.direction?.name === "Takeover Test", `(${lastLine.slice(0, 80)})`);

  // ---- 4) different project → named error -------------------------------------------------
  const other = mkdtempSync(path.join(os.tmpdir(), "fl-heal-other-"));
  const diff = await runServe(["--project", other, "--port", String(PORT)]);
  assert("different project: exits 1 naming the owner", diff.code === 1 && diff.out().includes("DIFFERENT project") && diff.out().includes(PROJ));
  rmSync(other, { recursive: true, force: true });

  kill(takeover.child);
  await sleep(300);

  // ---- 5) not a Font Lab endpoint → named error -------------------------------------------
  const foreign = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("hi"); });
  await new Promise((r) => foreign.listen(PORT, "127.0.0.1", r));
  const stranger = await runServe(["--project", PROJ, "--port", String(PORT)]);
  assert("foreign squatter: exits 1 with a named reason", stranger.code === 1 && stranger.out().includes("isn't a Font Lab endpoint"));
  foreign.close();
} finally {
  rmSync(PROJ, { recursive: true, force: true });
}

console.log(`\nserve-heal: ${passed}/${passed + failed} assertions passed`);
process.exit(failed ? 1 : 0);
