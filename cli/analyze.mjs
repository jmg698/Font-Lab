#!/usr/bin/env node
// `font-lab analyze` — print what Font Lab sees in a project (M3). Read-only.
//   node cli/analyze.mjs [--project <dir>] [--json]
import path from "node:path";
import { analyzeProject, summarize } from "./analyzer.mjs";

const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const project = path.resolve(arg("--project", process.cwd()));
const a = analyzeProject(project);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(a, null, 2));
} else {
  console.log(`Font Lab — analysis of ${path.relative(process.cwd(), project) || "."}`);
  console.log(summarize(a));
}
