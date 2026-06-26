// init verification — `font-lab init` scaffolds a real project (panel + parity module +
// dev-only mount) and `--undo` restores it byte-for-byte. Offline (--no-fetch).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = HERE + "out/";
const TMP = HERE + ".init-tmp/";
mkdirSync(OUT, { recursive: true });
const CLEAN = path.join(ROOT, "examples/clean-next-site");

const results = [];
const assert = (n, c, e = "") => { results.push({ name: n, pass: !!c }); console.log((c ? "PASS" : "FAIL").padEnd(5), n, e && !c ? `(${e})` : ""); };

try {
  rmSync(TMP, { recursive: true, force: true });
  const dir = path.join(TMP, "proj");
  mkdirSync(path.join(dir, "app"), { recursive: true });
  for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) cpSync(path.join(CLEAN, f), path.join(dir, f));
  const layoutPath = path.join(dir, "app/layout.tsx");
  const orig = readFileSync(layoutPath, "utf8");

  execFileSync("node", [HERE + "init.mjs", "--project", dir, "--no-fetch"], { stdio: "pipe" });
  const layout = readFileSync(layoutPath, "utf8");
  assert("init: catalog.generated.ts written", existsSync(path.join(dir, "app/_fontlab/catalog.generated.ts")));
  assert("init: generated module carries wiring", /export const wiring/.test(readFileSync(path.join(dir, "app/_fontlab/catalog.generated.ts"), "utf8")));
  assert("init: portable panel copied", existsSync(path.join(dir, "app/_fontlab/FontLabDevPanel.tsx")));
  assert("init: layout imports next/dynamic", /from\s+["']next\/dynamic["']/.test(layout));
  assert("init: layout declares the dev-only panel", /font-lab:init:start/.test(layout) && /NODE_ENV === "development"/.test(layout));
  assert("init: panel mounted in <body>", /<FontLabDevPanel \/>/.test(layout));

  // idempotent: re-init doesn't double-mount
  execFileSync("node", [HERE + "init.mjs", "--project", dir, "--no-fetch"], { stdio: "pipe" });
  const layout2 = readFileSync(layoutPath, "utf8");
  assert("init: re-init doesn't duplicate the mount", (layout2.match(/font-lab:init:start/g) || []).length === 1);

  execFileSync("node", [HERE + "init.mjs", "--project", dir, "--undo"], { stdio: "pipe" });
  assert("undo: layout restored byte-identical", readFileSync(layoutPath, "utf8") === orig);
  assert("undo: _fontlab removed", !existsSync(path.join(dir, "app/_fontlab")));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "init-report.json", JSON.stringify({ results }, null, 2));
console.log(`\ninit: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) { console.error("FAILED:", failed.map((f) => f.name).join(", ")); process.exit(5); }
console.log("init PASS");
