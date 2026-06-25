#!/usr/bin/env node
// `font-lab undo` — restore the files Font Lab last edited, from the backup-first snapshot.
import path from "node:path";
import { undo } from "./codegen.mjs";

const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const project = path.resolve(arg("--project", process.cwd()));

try {
  const r = undo(project);
  for (const w of r.warnings) console.warn(`  ! ${w}`);
  console.log(`Font Lab — reverted ${r.runId}; restored ${r.restored.join(", ")}`);
} catch (e) {
  console.error("undo failed:", e.message);
  process.exit(1);
}
