#!/usr/bin/env node
// `font-lab init` — make a real project previewable: scaffold the dev panel + parity bundles
// and mount the panel (dev-only) in the layout. Reversible with `--undo`. Thin CLI over
// engine.init / engine.uninit (the same code the MCP server's font_lab_init tool uses).
//
//   node cli/init.mjs --project <dir> [--vibe <v>] [--count <n>] [--no-fetch]
//   node cli/init.mjs --project <dir> --undo

import path from "node:path";
import * as engine from "./engine.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PROJECT = path.resolve(arg("--project", process.cwd()));
const rel = (p) => path.relative(process.cwd(), p) || ".";

try {
  if (process.argv.includes("--undo")) {
    const r = engine.uninit(PROJECT);
    console.log(`Font Lab — uninstalled (restored ${r.restored}, removed ${r.removed.join(" + ")})`);
  } else {
    const r = await engine.init(PROJECT, {
      vibe: arg("--vibe", undefined),
      count: Number(arg("--count", "5")),
      fetch: !process.argv.includes("--no-fetch"),
      allowVersionSkew: process.argv.includes("--allow-version-skew"),
      log: (m) => console.log(m),
    });
    console.log(`\nFont Lab — initialized ${rel(PROJECT)}`);
    console.log(`  directions  ${r.directions.map((d) => d.name).join(", ")}`);
    console.log(`  wiring      ${["display", "body", "mono"].map((role) => `${role}:${r.wiring[role] ? r.wiring[role].var + "@" + r.wiring[role].el : "—"}`).join("  ")}`);
    // Dead wiring is SHIP scope, not a preview gate — the panel previews every role by painting
    // the rendered page (v2.0); what a dead chain changes is how the pick ships.
    if (r.deadRoles.length) console.log(`  note        ${r.deadRoles.join(", ")}: previews fine (painted on the rendered page), but the source wiring is dead — shipping is wired by your agent, or \`font-lab rewire\` repairs the chain (reversible)`);
    console.log(`  panel       ${r.mounted ? "mounted in" : "already in"} ${r.layout} (dev only)`);
    console.log(`\n  next:  run your dev server, then \`node cli/font-lab.mjs --project ${rel(PROJECT)}\` — flip, Pick, then \`node cli/apply.mjs\`.`);
    console.log(`         undo:  \`node cli/init.mjs --project ${rel(PROJECT)} --undo\``);
  }
} catch (e) {
  console.error("init failed:", e.message);
  process.exit(1);
}
