#!/usr/bin/env node
// `font-lab rewire` — fix dead roles (a font declared but not actually rendered, e.g. a
// heading rule that reads var(--font-display) under @theme inline). Points those raw usages
// at the published leaf var so the font renders. Reversible via `font-lab undo`.
//   node cli/rewire.mjs --project <dir>
import path from "node:path";
import { rewireCoverage } from "./codegen.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const project = path.resolve(arg("--project", process.cwd()));

try {
  const r = rewireCoverage(project);
  if (!r.rewired.length) {
    console.log(`Font Lab — nothing to rewire (${r.note}).`);
  } else {
    console.log("Font Lab — rewired dead roles");
    for (const x of r.rewired) console.log(`  ${x.role.padEnd(8)} var(${x.from}) → var(${x.to})  (${x.count}×)`);
    console.log(`  edited  ${r.edited.join(", ")}`);
    console.log(`  backup  ${r.backupDir}  →  \`font-lab undo\` to revert`);
  }
} catch (e) {
  console.error("rewire failed:", e.message);
  process.exit(1);
}
