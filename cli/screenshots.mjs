#!/usr/bin/env node
// `font-lab-screenshots` — HEADLESS pick mode. Drive the live panel through each curated
// direction and screenshot the running site, so a human with no live browser (web/cloud/phone)
// can pick from images. Requires `font-lab init` done + your dev server running.
//
//   node screenshots.mjs --project <dir> --base http://localhost:3000 [--route /] [--out <dir>]

import path from "node:path";
import * as engine from "./engine.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const project = path.resolve(arg("--project", process.cwd()));
const baseUrl = arg("--base", arg("--base-url", "http://localhost:3000"));
const out = arg("--out", undefined);
const routes = arg("--route", "/").split(",");
const rel = (p) => path.relative(process.cwd(), p) || ".";

try {
  const r = await engine.captureDirections(project, { baseUrl, outDir: out, routes });
  console.log(`Font Lab — captured ${r.shots.length} preview(s) from ${r.baseUrl}${r.route} → ${rel(r.outDir)}`);
  for (const s of r.shots) {
    console.log(`  ${s.error ? "✗" : "✓"} ${s.id.padEnd(22)} ${s.error || rel(s.screenshot)}`);
  }
  console.log(`\n  Show these to the human, let them pick an id, then:`);
  console.log(`    node select.mjs --project ${rel(project)} --direction <id>   &&   node apply.mjs --project ${rel(project)}`);
  console.log(`\n  Prefer to flip live instead? ${r.live.note}`);
} catch (e) {
  console.error("screenshots failed:", e.message);
  process.exit(1);
}
