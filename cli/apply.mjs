#!/usr/bin/env node
// `font-lab apply` — apply .font-lab/selection.json into the project (next/font + Tailwind).
import path from "node:path";
import { applySelection } from "./codegen.mjs";

const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const project = path.resolve(arg("--project", process.cwd()));

try {
  const r = applySelection(project);
  console.log(`Font Lab — applied "${r.direction?.name ?? "?"}"`);
  for (const x of r.roles) console.log(`  ${x.role.padEnd(8)} ${x.family}`);
  if (r.replaced.length) console.log(`  replaced: ${r.replaced.map((x) => `${x.font} @ ${x.variable}`).join(", ")}`);
  console.log(`  edited  ${r.edited.join(", ")}`);
  console.log(`  backup  ${r.backupDir}  →  \`font-lab undo\` to revert`);
} catch (e) {
  console.error("apply failed:", e.message);
  process.exit(1);
}
