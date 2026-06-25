// `font-lab gen` — build the parity catalog the dev panel previews from. Thin CLI over the
// full analyzer → curator → generateCatalog pipeline:
//   1. analyze the project (M3) → target + the real current fonts;
//   2. curate ~5 directions for it (M4, deterministic, no LLM);
//   3. self-host each font's variable woff2 + compute next/font's exact adjusted fallback
//      (M0-proven parity) and write app/_fontlab/catalog.generated.ts.
//
// Uses curl (which honors the sandbox HTTPS proxy) to fetch from Google.

import { fileURLToPath } from "node:url";
import { curate } from "./curator.mjs";
import { analyzeProject, toTarget } from "./analyzer.mjs";
import { generateCatalog } from "./catalog-build.mjs";

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const APP = arg("--project", fileURLToPath(new URL("../examples/sample-next-site/", import.meta.url))).replace(/\/+$/, "");

const analysis = analyzeProject(APP);
const target = toTarget(analysis);
const replaces = analysis.replaces;
const directions = curate(analysis, { vibe: arg("--vibe", undefined), count: Number(arg("--count", "5")) });
console.log(
  `  analyzed ${analysis.router}/${target.framework} · tailwind v${target.tailwindVersion} · ${target.fontWiring}` +
    ` · current: ${replaces.display ?? "—"} / ${replaces.body ?? "—"} / ${replaces.mono ?? "—"}`,
);
console.log(`  curated ${directions.length} directions: ${directions.map((d) => d.name).join(", ")}`);

const r = await generateCatalog(APP, directions, { target, replaces }, { log: (m) => console.log(m) });
console.log(`\nwrote app/_fontlab/catalog.generated.ts (${r.fonts.length} fonts, ${r.directions.length} directions)`);
