#!/usr/bin/env node
// `font-lab init` — make a real project previewable: scaffold the dev panel + parity bundles
// and mount the panel (dev-only) in the layout, so a human can flip fonts live on their own
// running site. Reversible: `--undo` restores the layout and removes the scaffolding.
//
//   node cli/init.mjs --project <dir> [--vibe <v>] [--count <n>] [--no-fetch]
//   node cli/init.mjs --project <dir> --undo
//
// Scope gate: App Router + Tailwind v4 + CSS-variable wiring (the analyzer enforces it).

import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeProject, toTarget, wiringFor } from "./analyzer.mjs";
import { curate } from "./curator.mjs";
import { generateCatalog } from "./catalog-build.mjs";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PROJECT = path.resolve(arg("--project", process.cwd()));
const UNDO = process.argv.includes("--undo");
const FETCH = !process.argv.includes("--no-fetch");

function resolveAppDir(projectDir) {
  const d = ["app", "src/app"].map((x) => path.join(projectDir, x)).find((x) => existsSync(path.join(x, "layout.tsx")));
  if (!d) throw new Error("could not find app/layout.tsx (App Router only)");
  return d;
}
const BACKUP = path.join(PROJECT, ".font-lab", "init-backup");

// ---- layout edits (string + fenced, backup-protected, semicolon-agnostic) ----

const START = "// font-lab:init:start";
const END = "// font-lab:init:end";

function mountPanel(layoutPath) {
  let src = readFileSync(layoutPath, "utf8");
  if (src.includes(START)) return false; // already mounted

  // 1) ensure `import dynamic from "next/dynamic"`
  if (!/from\s+["']next\/dynamic["']/.test(src)) {
    src = insertAfterImports(src, `import dynamic from "next/dynamic"`);
  }
  // 2) fenced const declaring the dev-only panel (dead-code-eliminated in prod)
  const block = [
    START,
    `const FontLabDevPanel =`,
    `  process.env.NODE_ENV === "development"`,
    `    ? dynamic(() => import("./_fontlab/FontLabDevPanel").then((m) => m.FontLabDevPanel))`,
    `    : () => null;`,
    END,
  ].join("\n");
  src = insertAfterImports(src, block);
  // 3) mount before </body>
  if (!/<FontLabDevPanel\s*\/>/.test(src)) {
    src = src.replace(/<\/body>/, `  {process.env.NODE_ENV === "development" && <FontLabDevPanel />}\n      </body>`);
  }
  writeFileSync(layoutPath, src);
  return true;
}

function insertAfterImports(text, snippet) {
  const importRe = /^import\s[^\n]*$/gm;
  let last = 0, m;
  while ((m = importRe.exec(text))) last = m.index + m[0].length;
  const before = text.slice(0, last).replace(/\s*$/, "");
  const after = text.slice(last).replace(/^\s*/, "");
  return `${before}\n\n${snippet}\n\n${after}`;
}

// ---- undo ------------------------------------------------------------------

function undo() {
  const appDir = resolveAppDir(PROJECT);
  const layout = path.join(appDir, "layout.tsx");
  const backupLayout = path.join(BACKUP, "layout.tsx");
  if (existsSync(backupLayout)) copyFileSync(backupLayout, layout);
  rmSync(path.join(appDir, "_fontlab"), { recursive: true, force: true });
  rmSync(path.join(PROJECT, "public", "fontlab"), { recursive: true, force: true });
  rmSync(BACKUP, { recursive: true, force: true });
  console.log(`Font Lab — uninstalled (restored ${path.relative(PROJECT, layout)}, removed _fontlab + public/fontlab)`);
}

// ---- install ---------------------------------------------------------------

async function init() {
  const analysis = analyzeProject(PROJECT);
  if (!analysis.supported) throw new Error(`project not supported yet: ${analysis.reasons.join("; ")}`);
  const appDir = resolveAppDir(PROJECT);
  const layout = path.join(appDir, "layout.tsx");

  // backup layout before touching it — never clobber the original on re-init.
  mkdirSync(BACKUP, { recursive: true });
  const backupLayout = path.join(BACKUP, "layout.tsx");
  if (!existsSync(backupLayout)) copyFileSync(layout, backupLayout);

  // 1) parity bundles + generated module (with wiring) into the project
  const directions = curate(analysis, { vibe: arg("--vibe", undefined), count: Number(arg("--count", "5")) });
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis) };
  const built = await generateCatalog(PROJECT, directions, meta, { fetch: FETCH, log: (m) => console.log(m) });

  // 2) drop the portable panel next to the generated module
  copyFileSync(path.join(HERE, "templates", "font-lab-panel.tsx"), path.join(appDir, "_fontlab", "FontLabDevPanel.tsx"));

  // 3) mount it (dev-only) in the layout
  const mounted = mountPanel(layout);

  console.log(`\nFont Lab — initialized ${path.relative(process.cwd(), PROJECT) || "."}`);
  console.log(`  directions  ${directions.map((d) => d.name).join(", ")}`);
  console.log(`  wiring      ${["display", "body", "mono"].map((r) => `${r}:${meta.wiring[r] ? meta.wiring[r].var + "@" + meta.wiring[r].el : "—"}`).join("  ")}`);
  const dead = analysis.coverage?.deadRoles || [];
  if (dead.length) console.log(`  note        ${dead.join(", ")} won't preview (dead on this site — see \`font-lab analyze\`)`);
  console.log(`  panel       ${mounted ? "mounted in" : "already in"} ${path.relative(PROJECT, layout)} (dev only)`);
  console.log(`\n  next:  run your dev server, then \`node cli/font-lab.mjs --project ${path.relative(process.cwd(), PROJECT) || "."}\``);
  console.log(`         flip in the panel, Pick, then \`node cli/apply.mjs --project …\`.  Undo: \`node cli/init.mjs --project … --undo\``);
  return built;
}

try {
  if (UNDO) undo();
  else await init();
} catch (e) {
  console.error("init failed:", e.message);
  process.exit(1);
}
