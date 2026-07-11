// `font-lab gen` — build the parity catalog the dev panel previews from. Thin CLI over the
// full analyzer → curator → generateCatalog pipeline:
//   1. analyze the project (M3) → target + the real current fonts;
//   2. curate ~5 directions for it (M4, deterministic, no LLM);
//   3. self-host each font's variable woff2 + compute next/font's exact adjusted fallback
//      (M0-proven parity) and write app/_fontlab/catalog.generated.ts.
//
// --panel additionally refreshes the panel itself (FontLabDevPanel.tsx + fl-census.ts) from
// the CURRENT templates, version-stamped — the fixture runners pass it so the browser gates
// always test today's panel instead of whatever copy was last committed (the drift that
// silently rotted the m1/m6 gates: catalog and panel frozen while the tool moved on).
//
// Uses curl (which honors the sandbox HTTPS proxy) to fetch from Google.

import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { curate } from "./curator.mjs";
import { analyzeProject, toTarget, wiringFor } from "./analyzer.mjs";
import { generateCatalog } from "./catalog-build.mjs";
import { VERSION } from "./version.mjs";

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const APP = arg("--project", fileURLToPath(new URL("../examples/sample-next-site/", import.meta.url))).replace(/\/+$/, "");
const HERE = path.dirname(fileURLToPath(import.meta.url));

const analysis = analyzeProject(APP);
const target = toTarget(analysis);
const replaces = analysis.replaces;
const directions = curate(analysis, { vibe: arg("--vibe", undefined), count: Number(arg("--count", "5")) });
console.log(
  `  analyzed ${analysis.router}/${target.framework} · tailwind v${target.tailwindVersion} · ${target.fontWiring}` +
    ` · current: ${replaces.display ?? "—"} / ${replaces.body ?? "—"} / ${replaces.mono ?? "—"}`,
);
console.log(`  curated ${directions.length} directions: ${directions.map((d) => d.name).join(", ")}`);

const r = await generateCatalog(APP, directions, { target, replaces, wiring: wiringFor(analysis) }, { log: (m) => console.log(m) });
console.log(`\nwrote app/_fontlab/catalog.generated.ts (${r.fonts.length} fonts, ${r.directions.length} directions)`);

if (process.argv.includes("--panel")) {
  const appDir = ["app", "src/app"].map((d) => path.join(APP, d)).find((d) => existsSync(path.join(d, "_fontlab")));
  if (!appDir) {
    console.error("  --panel: no app/_fontlab dir found to refresh");
    process.exit(1);
  }
  const panelSrc = readFileSync(path.join(HERE, "templates", "font-lab-panel.tsx"), "utf8").replace(/__FONTLAB_VERSION__/g, VERSION);
  writeFileSync(path.join(appDir, "_fontlab", "FontLabDevPanel.tsx"), panelSrc);
  writeFileSync(path.join(appDir, "_fontlab", "fl-census.ts"), readFileSync(path.join(HERE, "templates", "fl-census.ts"), "utf8"));
  console.log(`synced panel + census from templates (v${VERSION}) into ${path.relative(APP, appDir)}/_fontlab/`);
}
