// Font Lab engine (M5) — the stable programmatic facade the MCP server and CLIs wrap. One
// import surface over the whole pipeline so the agent can drive the loop:
//
//   analyze → (curate  OR  listCatalog + composeDirections) → preparePreview → readSelection → apply
//
// The taste split is enforced here, not just documented:
//   • the HUMAN makes the final pick (we only ever prepare a preview; we never auto-select);
//   • the AGENT may take the wheel on the *menu* — compose its own directions — but every
//     font it chooses must be a catalog member, so the parity / ship guarantee always holds.
//   • the curator is the strong default the agent gets for free.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { catalog, get as catalogGet, inCatalog } from "./catalog.mjs";
import { curate as curateDirections } from "./curator.mjs";
import { analyzeProject, toTarget, wiringFor } from "./analyzer.mjs";
import { generateCatalog } from "./catalog-build.mjs";
import { applySelection, undo as undoApply, rewireCoverage } from "./codegen.mjs";

const PANEL_TEMPLATE = fileURLToPath(new URL("./templates/font-lab-panel.tsx", import.meta.url));

const ROLES = ["display", "body", "mono"];
const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── read ────────────────────────────────────────────────────────────────────

export function analyze(projectDir) {
  return analyzeProject(path.resolve(projectDir));
}

// Browse the catalog so the agent can compose its own directions. Filter by role/tag.
export function listCatalog({ role, tag } = {}) {
  return Object.entries(catalog)
    .filter(([, e]) => (!role || e.roles.includes(role)) && (!tag || e.tags.includes(tag)))
    .map(([family, e]) => ({ family, roles: e.roles, tags: e.tags }));
}

// The default menu: ~5 deterministic directions for this project.
export function curate(projectDir, opts = {}) {
  const analysis = analyzeProject(path.resolve(projectDir));
  return { analysis, directions: curateDirections(analysis, opts) };
}

// ── option 3: the agent composes its own directions ──────────────────────────
// specs: [{ name, vibe?, rationale?, display, body, mono, weights? }]
// Parity guard: every family must be a catalog member; otherwise throw with suggestions.
export function composeDirections(specs) {
  if (!Array.isArray(specs) || !specs.length) throw new Error("composeDirections: provide a non-empty array of directions");
  const warnings = [];
  const directions = specs.map((s, i) => {
    if (!s || !s.display || !s.body || !s.mono) throw new Error(`direction[${i}]: needs display, body, and mono families`);
    for (const role of ROLES) {
      const fam = s[role];
      if (!inCatalog(fam)) {
        const near = suggest(fam, role);
        throw new Error(`direction[${i}].${role}: "${fam}" is not in the Font Lab catalog${near ? ` — did you mean ${near}?` : ""}`);
      }
      if (!catalogGet(fam).roles.includes(role)) warnings.push(`"${fam}" isn't a typical ${role} font (allowed, but check it reads well)`);
    }
    const name = s.name || `${s.display} / ${s.body}`;
    return {
      id: s.id || slugId(name),
      name,
      vibe: s.vibe || "custom",
      rationale: s.rationale || `${s.display} headings over ${s.body}.`,
      roles: {
        display: { family: s.display, weights: s.weights?.display || [400, 700] },
        body: { family: s.body, weights: s.weights?.body || [400, 600] },
        mono: { family: s.mono, weights: s.weights?.mono || [400, 700] },
      },
    };
  });
  return { directions, warnings };
}

function suggest(fam, role) {
  const f = (fam || "").toLowerCase();
  const hit = Object.keys(catalog).find((k) => k.toLowerCase().includes(f) || f.includes(k.toLowerCase()));
  if (hit) return `"${hit}"`;
  const someInRole = Object.entries(catalog).filter(([, e]) => e.roles.includes(role)).slice(0, 3).map(([k]) => `"${k}"`);
  return someInRole.length ? someInRole.join(", ") : null;
}

// ── prepare the live preview (build parity bundles into the project) ──────────
// directions: optional agent-composed/curated directions; if omitted, curate for the project.
export async function preparePreview(projectDir, { directions, vibe, count, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const dirs = directions && directions.length ? directions : curateDirections(analysis, { vibe, count });
  const meta = { target: toTarget(analysis), replaces: analysis.replaces };
  const result = await generateCatalog(dir, dirs, meta, { fetch, log });
  return { analysis, prepared: result.fonts, directions: result.directions, outPath: result.outPath };
}

// ── the human's pick, and shipping it ────────────────────────────────────────

export function readSelection(projectDir) {
  const p = path.join(path.resolve(projectDir), ".font-lab", "selection.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function apply(projectDir) {
  return applySelection(path.resolve(projectDir));
}

// Fix a role the analyzer flags as dead (declared but not actually rendered). Reversible.
export function rewire(projectDir) {
  return rewireCoverage(path.resolve(projectDir));
}

// ── install / uninstall the live panel (the agent's "setup" step) ────────────

const INIT_START = "// font-lab:init:start";
const INIT_END = "// font-lab:init:end";

function resolveAppDir(projectDir) {
  const d = ["app", "src/app"].map((x) => path.join(projectDir, x)).find((x) => existsSync(path.join(x, "layout.tsx")));
  if (!d) throw new Error("could not find app/layout.tsx (App Router only)");
  return d;
}
function insertAfterImports(text, snippet) {
  const re = /^import\s[^\n]*$/gm;
  let last = 0, m;
  while ((m = re.exec(text))) last = m.index + m[0].length;
  return `${text.slice(0, last).replace(/\s*$/, "")}\n\n${snippet}\n\n${text.slice(last).replace(/^\s*/, "")}`;
}
function mountPanel(layoutPath) {
  let src = readFileSync(layoutPath, "utf8");
  if (src.includes(INIT_START)) return false;
  if (!/from\s+["']next\/dynamic["']/.test(src)) src = insertAfterImports(src, `import dynamic from "next/dynamic"`);
  const block = [
    INIT_START,
    `const FontLabDevPanel =`,
    `  process.env.NODE_ENV === "development"`,
    `    ? dynamic(() => import("./_fontlab/FontLabDevPanel").then((m) => m.FontLabDevPanel))`,
    `    : () => null;`,
    INIT_END,
  ].join("\n");
  src = insertAfterImports(src, block);
  if (!/<FontLabDevPanel\s*\/>/.test(src)) src = src.replace(/<\/body>/, `  {process.env.NODE_ENV === "development" && <FontLabDevPanel />}\n      </body>`);
  writeFileSync(layoutPath, src);
  return true;
}

// Set the project up so the human can preview live: self-host the parity bundles, drop in the
// portable dev panel, and mount it (dev-only) in the layout. Idempotent + reversible (uninit).
export async function init(projectDir, { vibe, count, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  if (!analysis.supported) throw new Error(`project not supported yet: ${analysis.reasons.join("; ")}`);
  const appDir = resolveAppDir(dir);
  const layout = path.join(appDir, "layout.tsx");

  const backupDir = path.join(dir, ".font-lab", "init-backup");
  mkdirSync(backupDir, { recursive: true });
  const backupLayout = path.join(backupDir, "layout.tsx");
  if (!existsSync(backupLayout)) copyFileSync(layout, backupLayout); // never clobber the original

  const directions = curateDirections(analysis, { vibe, count });
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis) };
  const built = await generateCatalog(dir, directions, meta, { fetch, log });

  mkdirSync(path.join(appDir, "_fontlab"), { recursive: true });
  copyFileSync(PANEL_TEMPLATE, path.join(appDir, "_fontlab", "FontLabDevPanel.tsx"));
  const mounted = mountPanel(layout);

  return {
    analysis,
    directions: directions.map((d) => ({ id: d.id, name: d.name, vibe: d.vibe })),
    wiring: meta.wiring,
    deadRoles: analysis.coverage?.deadRoles || [],
    otherSubsystems: analysis.coverage?.otherSubsystems || [],
    prepared: built.fonts,
    mounted,
    layout: path.relative(dir, layout),
    nextStep: "Start your dev server, then have the human flip fonts in the panel (bottom-right) and Pick. Then read_pick → apply.",
  };
}

export function uninit(projectDir) {
  const dir = path.resolve(projectDir);
  const appDir = resolveAppDir(dir);
  const layout = path.join(appDir, "layout.tsx");
  const backupLayout = path.join(dir, ".font-lab", "init-backup", "layout.tsx");
  if (existsSync(backupLayout)) copyFileSync(backupLayout, layout);
  rmSync(path.join(appDir, "_fontlab"), { recursive: true, force: true });
  rmSync(path.join(dir, "public", "fontlab"), { recursive: true, force: true });
  rmSync(path.join(dir, ".font-lab", "init-backup"), { recursive: true, force: true });
  return { restored: path.relative(dir, layout), removed: ["app/_fontlab", "public/fontlab"] };
}

export function undo(projectDir) {
  return undoApply(path.resolve(projectDir));
}

// ── headless pick mode ────────────────────────────────────────────────────────
// When there's no live browser for the human to flip in (web/cloud sessions, phones), the
// agent screenshots the site in each direction, shows the images, the human picks by id, and
// we record that pick — the SAME selection.json the panel writes, so `apply` ships it
// identically. The taste decision still belongs to the human; only the surface changes.

// Record the human's pick from a chosen direction id — no panel click needed. Supports a mixed
// pick: each role can be sourced from a different direction (heading from one, body from another).
export function selectDirection(projectDir, { directionId, directions, vibe, count, roles: roleSrc } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const dirs = directions && directions.length ? directions : curateDirections(analysis, { vibe, count });
  const byId = (id) => dirs.find((d) => d.id === id || slugId(d.name) === id);
  const chosen = byId(directionId);
  if (!chosen) throw new Error(`no direction "${directionId}" — available: ${dirs.map((d) => d.id).join(", ")}`);
  const roles = {};
  for (const role of ROLES) {
    const src = roleSrc?.[role] ? byId(roleSrc[role]) : chosen;
    if (!src) throw new Error(`no direction "${roleSrc[role]}" for role ${role}`);
    roles[role] = src.roles[role];
  }
  const selection = {
    direction: { id: chosen.id, name: chosen.name, vibe: chosen.vibe },
    roles,
    pickedAt: new Date().toISOString(),
    via: "headless",
  };
  const flDir = path.join(dir, ".font-lab");
  mkdirSync(flDir, { recursive: true });
  writeFileSync(path.join(flDir, "selection.json"), JSON.stringify(selection, null, 2) + "\n");
  return selection;
}

// Ready-to-run commands to launch the FULL live editor (flip / mix / compare in a real browser),
// for when the screenshots aren't enough. Detects the project's dev command + package manager.
export function liveInstructions(projectDir) {
  const dir = path.resolve(projectDir);
  let devCmd = "npm run dev";
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg.scripts?.dev) {
      const pm = existsSync(path.join(dir, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(path.join(dir, "yarn.lock"))
          ? "yarn"
          : existsSync(path.join(dir, "bun.lockb"))
            ? "bun"
            : "npm run";
      devCmd = `${pm} dev`;
    }
  } catch {}
  return {
    note: "Run these in a local terminal — your Mac/Linux terminal, or the integrated terminal in VS Code / Cursor / the Claude Code IDE extension — to flip, mix, and compare the directions live on your real site.",
    steps: [
      "npx font-lab init --project .          # scaffold the live panel + parity bundles (reversible)",
      `${devCmd}                              # start your dev server`,
      "npx font-lab --project . &             # the pick endpoint on :7777 (records your choice)",
      "# open your site (e.g. http://localhost:3000): ← → flip · [ ] mix a role · B before/after · Pick",
      "npx font-lab-apply --project .         # the agent ships exactly what you picked",
    ],
    teardown: "npx font-lab init --project . --undo   # remove the panel scaffolding when done",
  };
}

// Headless capture: drive the REAL live panel through each direction and screenshot the site, so
// the images are faithful to what ships. Requires init() done and a dev server running at baseUrl.
// Makes no project edits — it only reads the running site. Returns a manifest the agent shows.
export async function captureDirections(projectDir, { baseUrl, routes = ["/"], outDir, directions, viewport, fullPage = true } = {}) {
  if (!baseUrl) throw new Error("captureDirections: baseUrl is required (your running dev server, e.g. http://localhost:3000)");
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "Playwright/Chromium isn't available for screenshots. Install it (`npm i -D playwright && npx playwright install chromium`), or use the live editor instead — see liveInstructions().",
    );
  }
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const dirs = directions && directions.length ? directions : curateDirections(analysis, {});
  const out = outDir ? path.resolve(outDir) : path.join(dir, ".font-lab", "previews");
  mkdirSync(out, { recursive: true });
  const base = baseUrl.replace(/\/+$/, "");
  const route = routes[0] || "/";

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.waitForSelector("#fontlab-panel-host", { timeout: 20000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const setPanel = (v) =>
      page.evaluate((vis) => {
        const h = document.getElementById("fontlab-panel-host");
        if (h) h.style.visibility = vis;
      }, v);

    const shots = [];
    // current / before
    await setPanel("hidden");
    const curPath = path.join(out, "current.png");
    await page.screenshot({ path: curPath, fullPage });
    await setPanel("visible");
    shots.push({ id: "current", name: "Current (before)", vibe: "—", rationale: "the site as it is today", screenshot: curPath });

    for (const d of dirs) {
      const clicked = await page.evaluate((id) => {
        const host = document.getElementById("fontlab-panel-host");
        const btn = host?.shadowRoot?.querySelector(`button[data-fl-id="${id}"]`);
        if (!btn) return false;
        btn.click();
        return true;
      }, d.id);
      if (!clicked) {
        shots.push({ id: d.id, name: d.name, vibe: d.vibe, rationale: d.rationale, error: "no panel chip — direction not in the preview build (re-run init/preparePreview with these directions)" });
        continue;
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(350);
      await setPanel("hidden");
      const file = path.join(out, `${d.id}.png`);
      await page.screenshot({ path: file, fullPage });
      await setPanel("visible");
      shots.push({
        id: d.id,
        name: d.name,
        vibe: d.vibe,
        rationale: d.rationale,
        fonts: { display: d.roles.display.family, body: d.roles.body.family, mono: d.roles.mono.family },
        screenshot: file,
      });
    }
    return { baseUrl: base, route, outDir: out, shots, live: liveInstructions(dir) };
  } finally {
    await browser.close();
  }
}
