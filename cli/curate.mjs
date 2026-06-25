#!/usr/bin/env node
// `font-lab curate` — preview the directions Font Lab would offer a project (M4). Read-only.
//   node cli/curate.mjs [--project <dir>] [--vibe <vibe>] [--count <n>] [--json]
import path from "node:path";
import { analyzeProject } from "./analyzer.mjs";
import { curate } from "./curator.mjs";

const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const project = path.resolve(arg("--project", process.cwd()));
const analysis = analyzeProject(project);
const dirs = curate(analysis, { vibe: arg("--vibe", undefined), count: Number(arg("--count", "5")) });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(dirs, null, 2));
} else {
  const cur = analysis.replaces;
  console.log(`Font Lab — ${dirs.length} directions for ${path.relative(process.cwd(), project) || "."}`);
  console.log(`  current: ${cur.display ?? "—"} / ${cur.body ?? "—"} / ${cur.mono ?? "—"}\n`);
  for (const d of dirs) {
    console.log(`  ${d.name}  ·  ${d.vibe}`);
    console.log(`    ${d.roles.display.family} / ${d.roles.body.family} / ${d.roles.mono.family}`);
    console.log(`    ${d.rationale}\n`);
  }
}
