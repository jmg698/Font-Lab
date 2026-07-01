#!/usr/bin/env node
// `font-lab-preview` — build the portable, self-contained HTML choosing sheet for the project.
// Works on ANY framework (no dev server, no in-app panel): the parity fonts are embedded, so the
// human just opens the file and compares. Optionally screenshot it headlessly (--shots).
//
//   node preview.mjs --project <dir> [--shots] [--no-inline] [--no-fetch]

import path from "node:path";
import * as engine from "./engine.mjs";

const has = (f) => process.argv.includes(f);
const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const project = path.resolve(arg("--project", process.cwd()));
const fetch = !has("--no-fetch");
const inline = !has("--no-inline");
const rel = (p) => path.relative(process.cwd(), p) || ".";

try {
  const r = await engine.previewSpecimen(project, { fetch, inline, log: (m) => process.stderr.write(m + "\n") });
  console.log(`Font Lab — preview sheet for ${r.framework} → ${r.rel}`);
  console.log(`  ${r.directions.length} direction(s), ${r.fonts.length} font(s)${r.inline ? ", embedded (opens offline)" : ""}`);
  console.log(`  open it: file://${r.path}`);
  if (has("--shots")) {
    const s = await engine.screenshotSpecimen(project, { htmlPath: r.path });
    console.log(`  screenshots → ${rel(s.outDir)}  [${s.browser}]  ${s.summary}${s.verified ? " ✓" : " ⚠"}`);
    for (const shot of s.shots) console.log(`    ${shot.check.startsWith("⚠") ? "⚠" : "✓"} ${String(shot.id).padEnd(22)} ${rel(shot.screenshot)}`);
  }
  console.log(`\n  Show it to the human, let them pick an id, then:`);
  console.log(`    node select.mjs --project ${rel(project)} --direction <id>  &&  node apply.mjs --project ${rel(project)}`);
} catch (e) {
  console.error("preview failed:", e.message);
  process.exit(1);
}
