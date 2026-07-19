#!/usr/bin/env node
// `font-lab-screenshots` — HEADLESS pick mode. Render the running site in each direction and
// screenshot it, so a human with no live browser (web/cloud/phone) can pick from images.
// Directions default to the composed set persisted by compose_directions (.font-lab/preview.json);
// pass --starter to deliberately capture the untailored starter menu. With no reachable dev
// server, the project's own dev command is started (managed, 127.0.0.1, stopped after) — pass
// --no-server-start to forbid that and require --base.
//
//   node screenshots.mjs --project <dir> [--base http://localhost:3000] [--route /] [--out <dir>] [--starter] [--no-server-start]

import path from "node:path";
import * as engine from "./engine.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const project = path.resolve(arg("--project", process.cwd()));
const baseUrl = arg("--base", arg("--base-url", undefined));
const out = arg("--out", undefined);
const routes = arg("--route", "/").split(",");
const executablePath = arg("--chromium", undefined); // optional: point at any Chrome/Chromium
const rel = (p) => path.relative(process.cwd(), p) || ".";

try {
  const r = await engine.captureDirections(project, {
    baseUrl,
    outDir: out,
    routes,
    executablePath,
    allowFallback: has("--starter"),
    ensureServer: has("--no-server-start") ? false : undefined,
    log: (m) => process.stderr.write(m + "\n"),
  });
  console.log(`Font Lab — captured ${r.shots.length} preview(s) from ${r.baseUrl}${r.route} → ${rel(r.outDir)}  [${r.browser}]`);
  if (r.serverNote) console.log(`  ${r.serverNote}`);
  if (r.menuWarning) console.log(`  ⚠ ${r.menuWarning}`);
  for (const s of r.shots) {
    console.log(`  ${s.error ? "✗" : "✓"} ${s.id.padEnd(22)} ${s.error || `${rel(s.heroShot || s.screenshot)}  (full page: ${rel(s.screenshot)})`}`);
  }
  console.log(`\n  Show the hero shots to the human, let them pick an id, then:`);
  console.log(`    node select.mjs --project ${rel(project)} --direction <id>   &&   node apply.mjs --project ${rel(project)}`);
  console.log(`\n  Prefer to flip live instead? ${r.live.note}`);
} catch (e) {
  console.error("screenshots failed:", e.message);
  process.exit(1);
}
