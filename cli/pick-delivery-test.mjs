#!/usr/bin/env node
// Pick-delivery acceptance test — the standup contract, verbatim:
//
//   "Agent sets up and ends its turn without waiting. Human browses 15 minutes, picks.
//    Human asks 'did you get it?' Agent must surface the pick — with ship scope — without
//    the user pasting anything from the panel."
//
// Driven against the REAL MCP server over stdio (no mocks): a selection.json written
// out-of-band (as the panel endpoint writes it) must piggyback on the next tool result as
// pendingHumanPick — full note with scope first, one-line reminder after, gone once an apply
// stamp postdates it, full again for a NEW pick. Also covers the mcpVersionDrift warning
// (fake newer node_modules install) and that the request piggyback still works. Offline.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const assert = (name, ok, extra = "") => {
  if (ok) { passed++; console.log(`PASS  ${name} ${extra}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
};

// ---- fixture project: a pick the panel just saved, and a "newer" local install -------------
const PROJECT = mkdtempSync(path.join(os.tmpdir(), "fl-pickdelivery-"));
const FLDIR = path.join(PROJECT, ".font-lab");
mkdirSync(FLDIR, { recursive: true });

const writeSelection = (name, pickedAt) =>
  writeFileSync(
    path.join(FLDIR, "selection.json"),
    JSON.stringify({
      version: 1,
      pickedAt,
      direction: { id: name.toLowerCase().replace(/\s+/g, "-"), name, vibe: "editorial", rationale: "test" },
      roles: {
        display: { family: "Fraunces", source: "google" },
        body: { family: "Hanken Grotesk", source: "google" },
        mono: { family: "Spline Sans Mono", source: "google" },
      },
      preview: {
        mechanism: "cluster-paint",
        route: "/fontlab",
        census: [],
        scope: [
          { role: "display", voice: "heading", autoShipSeam: null, clusters: [], islands: [{ label: "Headline serif", prov: "inline@/fontlab" }] },
          { role: "body", voice: "body", autoShipSeam: { kind: "variable", var: "--font-hanken" }, clusters: [], islands: [] },
          { role: "mono", voice: "label", autoShipSeam: null, clusters: [], islands: [] },
        ],
      },
    }, null, 2),
  );

const T0 = Date.now();
writeSelection("Elegant Contrast", new Date(T0 - 15 * 60_000).toISOString()); // picked "15 minutes ago"
// a NEWER font-lab in the project's node_modules than the server we spawn → drift must warn
mkdirSync(path.join(PROJECT, "node_modules", "font-lab"), { recursive: true });
writeFileSync(path.join(PROJECT, "node_modules", "font-lab", "package.json"), JSON.stringify({ name: "font-lab", version: "99.0.0" }));

// ---- the real MCP server over stdio ---------------------------------------------------------
const server = spawn(process.execPath, [path.join(HERE, "mcp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waiters = new Map();
server.stdout.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
    } catch {}
  }
});
let nextId = 1;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiters.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); reject(new Error(`rpc timeout: ${method}`)); } }, 30_000);
  });
// tool results carry the payload as JSON text in content[0]
const call = async (name, args) => {
  const res = await rpc("tools/call", { name, arguments: args });
  const text = res.result?.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return { __text: text }; }
};

try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "pick-delivery-test", version: "0" } });

  // 1) "did you get it?" — the FIRST tool touch after the pick must surface it, with scope
  const s1 = await call("font_lab_status", { projectDir: PROJECT });
  const pick1 = s1.pendingHumanPick;
  assert("first result piggybacks the pick", !!pick1, pick1 ? "" : JSON.stringify(Object.keys(s1)));
  assert("full note names the direction", !!pick1?.note?.includes("Elegant Contrast"));
  assert("full note carries auto-ship scope", !!pick1?.note?.includes("auto-ships: body"));
  assert("full note carries agent-wires scope", !!pick1?.note?.includes("agent wires: display, mono"));
  assert("full note names the island route", !!pick1?.note?.includes("/fontlab") && !!pick1?.note?.includes("Headline serif"));
  assert("full note points at apply → verify", !!pick1?.note?.includes("font_lab_apply") && !!pick1?.note?.includes("font_lab_verify"));

  // 2) drift: project node_modules has 99.0.0, this server doesn't → warn on every result
  assert("mcpVersionDrift warns against newer local install", !!s1.mcpVersionDrift && s1.mcpVersionDrift.includes("99.0.0"));

  // 3) noise control: second touch gets the one-line reminder, not the full note again
  const s2 = await call("font_lab_status", { projectDir: PROJECT });
  assert("second result is a one-line reminder", !!s2.pendingHumanPick?.note?.startsWith("Reminder") && !s2.pendingHumanPick.note.includes("auto-ships"));

  // 4) skip list: the tools that receive/fulfill the pick themselves stay clean
  const rp = await call("font_lab_read_pick", { projectDir: PROJECT });
  assert("read_pick result carries no piggyback", rp.pendingHumanPick === undefined && rp.direction?.name === "Elegant Contrast");

  // 5) an apply stamp that postdates the pick clears it
  writeFileSync(path.join(FLDIR, "applied.json"), JSON.stringify({ at: new Date(T0 + 1000).toISOString(), runId: "test" }));
  const s3 = await call("font_lab_status", { projectDir: PROJECT });
  assert("applied pick stops piggybacking", s3.pendingHumanPick === undefined);

  // 6) a NEW pick (newer than the stamp) gets the full treatment again
  writeSelection("Bold Editorial", new Date(T0 + 2000).toISOString());
  const s4 = await call("font_lab_status", { projectDir: PROJECT });
  assert("new pick piggybacks in full again", !!s4.pendingHumanPick?.note?.includes("Bold Editorial") && !!s4.pendingHumanPick?.note?.includes("auto-ships"));

  // 7) regression: the request piggyback still rides alongside
  writeFileSync(path.join(FLDIR, "request.json"), JSON.stringify({ status: "pending", brief: { note: "warmer" }, exclude: [], at: new Date().toISOString() }));
  const s5 = await call("font_lab_status", { projectDir: PROJECT });
  assert("request piggyback unaffected", !!s5.pendingHumanRequest?.request?.brief);
} finally {
  server.kill();
  rmSync(PROJECT, { recursive: true, force: true });
}

console.log(`\npick-delivery: ${passed}/${passed + failed} assertions passed`);
process.exit(failed ? 1 : 0);
