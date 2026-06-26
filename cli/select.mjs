#!/usr/bin/env node
// `font-lab-select` — record the human's pick by direction id (the HEADLESS path: no panel
// click needed). Writes the same .font-lab/selection.json the live panel writes, so `apply`
// ships it identically. Supports a mixed pick via per-role flags.
//
//   node select.mjs --project <dir> --direction <id>
//   node select.mjs --project <dir> --direction <id> --display <id> --body <id> --mono <id>

import path from "node:path";
import * as engine from "./engine.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const project = path.resolve(arg("--project", process.cwd()));
const directionId = arg("--direction", arg("--id", undefined));
const rel = (p) => path.relative(process.cwd(), p) || ".";

if (!directionId) {
  console.error("usage: font-lab-select --project <dir> --direction <id> [--display <id> --body <id> --mono <id>]");
  process.exit(1);
}

const roles = {};
for (const r of ["display", "body", "mono"]) {
  const v = arg(`--${r}`, undefined);
  if (v) roles[r] = v;
}

try {
  const sel = engine.selectDirection(project, { directionId, roles: Object.keys(roles).length ? roles : undefined });
  console.log(`Font Lab — recorded pick: ${sel.direction.name} (${sel.direction.vibe})`);
  console.log(`  display ${sel.roles.display.family}   body ${sel.roles.body.family}   mono ${sel.roles.mono.family}`);
  console.log(`  → ship it:  node apply.mjs --project ${rel(project)}   (reversible: node undo.mjs --project ${rel(project)})`);
} catch (e) {
  console.error("select failed:", e.message);
  process.exit(1);
}
