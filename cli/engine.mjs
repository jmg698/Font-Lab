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

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, readdirSync, watch as fsWatch, statSync } from "node:fs";
import { catalog, get as catalogGet, inCatalog } from "./catalog.mjs";
import { curate as curateDirections } from "./curator.mjs";
import { designBrief, isOverexposed, antiGenericViolations, pickWarnings } from "./design-brain.mjs";
import { gatherContext, extractColors } from "./context.mjs";
import { resolveDirectionsMode, mergeDirections } from "./flow.mjs";
import { buildSpecimenHtml } from "./specimen.mjs";
import { admit as admitFont, normalize as normFamily, isShippable } from "./admit.mjs";
import { analyzeProject, toTarget, wiringFor } from "./analyzer.mjs";
import { generateCatalog, buildParityBundles } from "./catalog-build.mjs";
import { applySelection, undo as undoApply, rewireCoverage } from "./codegen.mjs";
import { readHandoffState, writeAppliedStamp, clearAppliedStamp, setAgentWaiting, selectionPath } from "./state.mjs";
import { VERSION, cmpVersions, isRealVersion } from "./version.mjs";

const PANEL_TEMPLATE = fileURLToPath(new URL("./templates/font-lab-panel.tsx", import.meta.url));

const ROLES = ["display", "body", "mono"];
const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── read ────────────────────────────────────────────────────────────────────

export function analyze(projectDir) {
  return analyzeProject(path.resolve(projectDir));
}

// ── the front door: analyze + the portable design brain ───────────────────────
// Returns the project analysis PLUS Font Lab's design brief as DATA the agent applies: the
// intake questions to ask the human first, the strategy scaffold, the overexposed defaults to
// avoid, the distinctive references to reach for, and the rationale rule. This is how the
// "ask what they're going for, then reach past the defaults" experience reaches every agent —
// including ones that never read the skill. The HUMAN still makes the final pick.
export function start(projectDir) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const cap = analysis.capabilities;
  // The intake + taste steps are identical on every stack; only HOW the human previews and how
  // the pick ships differ. Hand the agent the right path for THIS project instead of assuming Next.
  const previewShip = cap.livePanel
    ? "`init` the live in-app panel, have the human flip/mix/pick in the browser, then `read_pick` → `apply`."
    : cap.autoApply
      ? `the live in-app panel is Next-only, so screenshot the directions for the human (\`capture_directions\`), record their pick (\`select_direction\`), then \`apply\` — it self-hosts the parity woff2 and rewires ${cap.applyTarget} (${analysis.framework}, no next/font), reversibly.`
      : `no auto-ship branch here (${analysis.reasons.join("; ") || "unsupported stack"}); screenshot the directions, record the pick, then the human pastes Font Lab's generated @font-face + role mapping into ${cap.applyTarget || "their CSS entry"} by hand.`;
  return {
    analysis,
    capabilities: cap, // what an agent can actually do here — a paved path, not a refusal
    shipNote: analysis.shipNote,
    context: gatherContext(dir), // the project's own palette, brand docs, and copy voice (B2)
    brief: designBrief(),
    nextStep:
      "Read `context` (the project's palette, brand docs, and copy) — your options must fit THIS " +
      "project, not a generic default. Then ask the human the intake questions in `brief.intake` " +
      "and wait for the answers, compose tailored directions for their brief (reach past " +
      "`brief.avoid`; draw on `brief.references`), and let the HUMAN pick. `curate` is the " +
      "fallback when there's no brief. To preview + ship: " + previewShip,
  };
}

// ── the dynamic shippability gate (A2): reach beyond the catalog, honestly ────
// The catalog is the verified cache (an instant "guaranteed"); anything else is admitted on
// demand (Google / open foundry) and persisted to .font-lab/admitted.json so repeat picks are
// fast and the preview build can self-host it. Strive for WYSIWYG; surface best-effort with a
// warning rather than refusing — only a genuinely unshippable font is rejected.

function admittedCache(projectDir) {
  if (!projectDir) return undefined;
  const p = path.join(path.resolve(projectDir), ".font-lab", "admitted.json");
  const map = new Map();
  if (existsSync(p)) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(p, "utf8")))) map.set(k, v); } catch {}
  }
  return {
    get: (k) => map.get(k),
    set: (k, v) => {
      map.set(k, v);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(Object.fromEntries(map), null, 2) + "\n");
    },
  };
}

// Can this font ship with preview == ship? → verdict (guaranteed | best-effort | unavailable).
export async function admit(family, { projectDir } = {}) {
  return admitFont(family, { cache: admittedCache(projectDir) });
}

// Admit every family across a set of directions; annotate each direction with its (worst-case)
// parity and return the per-family verdicts.
export async function admitDirections(directions, { projectDir } = {}) {
  const cache = admittedCache(projectDir);
  const verdicts = new Map();
  const verdictFor = async (fam) => {
    const n = normFamily(fam);
    if (verdicts.has(n)) return verdicts.get(n);
    const v = await admitFont(fam, { cache });
    verdicts.set(n, v);
    return v;
  };
  const out = [];
  for (const d of directions) {
    const roles = {};
    for (const role of ROLES) {
      const fam = d.roles?.[role]?.family ?? d[role];
      if (fam) roles[role] = await verdictFor(fam);
    }
    const ps = Object.values(roles).map((v) => v.parity);
    const parity = ps.includes("unavailable") ? "unavailable" : ps.includes("best-effort") ? "best-effort" : "guaranteed";
    out.push({ id: d.id ?? null, name: d.name ?? null, parity, roles });
  }
  return { directions: out, verdicts: Object.fromEntries(verdicts) };
}

// Turn an admitted verdict into a generateCatalog-compatible spec (so a non-catalog font is
// self-hosted by the SAME build path the catalog uses).
function specFromVerdict(v) {
  if (!isShippable(v)) return null;
  return {
    css2: v.css2 || null,
    capsize: v.capsize || null,
    woff2Url: v.woff2Url || null,
    category: v.category || null,
    roles: v.roles || ROLES,
    // Honesty metadata for the panel + apply: where the face ships from and whether the
    // preview is byte-for-byte (catalog specs omit these; generateCatalog defaults them).
    source: v.source || "google",
    parity: v.parity || "best-effort",
  };
}

// Spec resolver for generateCatalog: catalog members first (the proven path, byte-identical),
// then the project's admitted cache. Throws only when a family was never admitted.
function mergedSpecFor(projectDir) {
  const cache = admittedCache(projectDir);
  return (family) => {
    if (inCatalog(family)) return catalogGet(family);
    const spec = specFromVerdict(cache?.get(normFamily(family)));
    if (!spec) throw new Error(`"${family}" hasn't been admitted yet — check it with admit()/check_fonts first (it isn't a catalog member)`);
    return spec;
  };
}

// Ensure every non-catalog family in `directions` is admitted + cached before a preview build.
async function ensureAdmitted(projectDir, directions) {
  const cache = admittedCache(projectDir);
  for (const d of directions) {
    for (const role of ROLES) {
      const fam = d.roles?.[role]?.family ?? d[role];
      if (fam && !inCatalog(fam)) {
        const v = await admitFont(fam, { cache });
        if (!isShippable(v)) throw new Error(`cannot preview "${fam}": ${v.reason}`);
      }
    }
  }
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
export async function composeDirections(specs, { projectDir, force = false, brief } = {}) {
  if (!Array.isArray(specs) || !specs.length) throw new Error("composeDirections: provide a non-empty array of directions");
  const cache = admittedCache(projectDir);
  const warnings = [];
  const directions = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (!s || !s.display || !s.body || !s.mono) throw new Error(`direction[${i}]: needs display, body, and mono families`);
    const roleParity = {};
    for (const role of ROLES) {
      const fam = s[role];
      // The gate, not a catalog whitelist: reach for any Google/foundry font and ship what's
      // shippable. Only a genuinely unshippable font is rejected; best-effort is allowed + warned.
      const v = await admitFont(fam, { cache });
      if (!isShippable(v)) {
        const near = suggest(fam, role);
        throw new Error(`direction[${i}].${role}: "${fam}" can't be shipped (${v.reason})${near ? ` — try ${near}` : ""}`);
      }
      if (v.source === "catalog" && !catalogGet(v.family).roles.includes(role))
        warnings.push(`"${v.family}" isn't a typical ${role} font (allowed, but check it reads well)`);
      if (isOverexposed(fam))
        warnings.push(`"${fam}" is an overexposed default — prefer a more distinctive face unless the brief specifically calls for maximum neutrality`);
      if (v.parity === "best-effort")
        warnings.push(`"${fam}": ${v.warnings.join("; ")} — shippable, but the preview may not be byte-for-byte; tell the human before they pick`);
      roleParity[role] = v.parity;
    }
    const name = s.name || `${s.display} / ${s.body}`;
    directions.push({
      id: s.id || slugId(name),
      name,
      vibe: s.vibe || "custom",
      rationale: s.rationale || `${s.display} headings over ${s.body}.`,
      parity: Object.values(roleParity).includes("best-effort") ? "best-effort" : "guaranteed",
      roles: {
        display: { family: s.display, weights: s.weights?.display || [400, 700] },
        body: { family: s.body, weights: s.weights?.body || [400, 600] },
        mono: { family: s.mono, weights: s.weights?.mono || [400, 700] },
      },
    });
  }
  // B1: the hard anti-generic gate on the agent-composed MENU. A shippable-but-generic menu
  // recreates the exact AI-default look Font Lab exists to escape, so we refuse it — unless the
  // caller deliberately overrides (e.g. the user explicitly asked for the default look). The
  // human's own final pick is never blocked this way (see selectDirection).
  if (!force) {
    const violations = antiGenericViolations(directions);
    if (violations.length)
      throw new Error(
        "compose rejected — this menu is too generic to escape the AI-default look:\n  - " +
          violations.join("\n  - ") +
          "\nReach for distinctive faces (use font_lab_check_fonts and the design brief's references), or pass force:true to override deliberately.",
      );
  }
  // Nudge toward the intake conversation: if no brief was gathered, the menu is inferred rather
  // than tailored to what the user actually asked for. Not a block (autonomous use is valid).
  if (!brief || !String(brief).trim())
    warnings.push("No `brief` was provided — if the user is present, ask them the intake questions (font_lab_start) and pass their answers as `brief`, so the options are tailored to what they actually want rather than inferred.");
  return { directions, warnings };
}

function suggest(fam, role) {
  const f = (fam || "").toLowerCase();
  const hit = Object.keys(catalog).find((k) => k.toLowerCase().includes(f) || f.includes(k.toLowerCase()));
  if (hit) return `"${hit}"`;
  const someInRole = Object.entries(catalog).filter(([, e]) => e.roles.includes(role)).slice(0, 3).map(([k]) => `"${k}"`);
  return someInRole.length ? someInRole.join(", ") : null;
}

// The live preview is built from the panel's direction set, persisted so "show me more" can grow it.
function previewSetPath(dir) {
  return path.join(path.resolve(dir), ".font-lab", "preview.json");
}
function writePreviewSet(dir, dirs) {
  const p = previewSetPath(dir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(dirs, null, 2) + "\n");
}
function readPreviewSet(dir) {
  const p = previewSetPath(dir);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

// ── prepare the live preview (build parity bundles into the project) ──────────
// Builds from the agent-composed `directions` (the tasteful, brief-driven path). With none, refuse
// unless allowFallback — so the generic default menu isn't mounted without the agent asking first.
// The MCP layer passes allowFallback:false (forcing intake); direct/CLI callers default to true.
export async function preparePreview(projectDir, { directions, vibe, count, allowFallback = true, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const mode = resolveDirectionsMode({ directions, allowFallback });
  const dirs = mode === "composed" ? directions : curateDirections(analysis, { vibe, count });
  await ensureAdmitted(dir, dirs); // admit any non-catalog (Google/foundry) families before building
  // Include `wiring` so the panel knows which leaf var to override per role — without it every
  // role renders "not wired" and the live swap is a no-op (must match init's meta).
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis) };
  const result = await generateCatalog(dir, dirs, meta, { fetch, log, specFor: mergedSpecFor(dir) });
  writePreviewSet(dir, dirs);
  return { analysis, mode, prepared: result.fonts, directions: result.directions, outPath: result.outPath };
}

// ── the portable "choosing moment" (framework-agnostic, no dev server) ────────
// Build a single self-contained HTML sheet — the parity fonts embedded (base64 when inlined) —
// that renders each direction on the project's own palette. Works on ANY project (it's just a
// file the human opens), which is what the live in-app panel can't be. Carries a real width-diff
// render check so a silently-fallen-back font is badged, not trusted (the fonts.check trap).

function resolvePalette(colors = []) {
  const by = {};
  for (const { name, value } of colors) by[name.toLowerCase()] = value;
  const pick = (...names) => names.map((n) => by[n]).find(Boolean) || null;
  const pal = {};
  const map = {
    bg: ["--background", "--bg", "--color-background", "--surface", "--paper", "--color-bg"],
    fg: ["--foreground", "--fg", "--text", "--color-foreground", "--ink", "--color-text"],
    muted: ["--muted", "--muted-foreground", "--subtle", "--color-muted"],
    accent: ["--accent", "--primary", "--brand", "--color-accent", "--color-primary", "--ring"],
    rule: ["--border", "--rule", "--divider", "--color-border"],
  };
  for (const [k, names] of Object.entries(map)) {
    const v = pick(...names);
    if (v) pal[k] = v;
  }
  return pal;
}

// Directions -> render-ready shape { id, name, vibe, rationale, parity, roles:{role:{family,stack}} }.
function specimenDirections(directions, stacks) {
  return directions.map((d) => ({
    id: d.id,
    name: d.name,
    vibe: d.vibe,
    rationale: d.rationale,
    parity: d.parity || null,
    roles: Object.fromEntries(
      ROLES.map((role) => {
        const fam = d.roles?.[role]?.family ?? d[role];
        return [role, fam ? { family: fam, stack: stacks[fam] || fam } : { family: null, stack: "inherit" }];
      }),
    ),
  }));
}

export async function previewSpecimen(projectDir, { directions, vibe, count, inline = true, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const dirs = directions && directions.length ? directions : curateDirections(analysis, { vibe, count });
  await ensureAdmitted(dir, dirs);

  const families = [...new Set(dirs.flatMap((d) => ROLES.map((r) => d.roles?.[r]?.family ?? d[r]).filter(Boolean)))];
  const { faceCss, stacks } = await buildParityBundles(dir, families, { fetch, inline, staticDir: analysis.staticDir, specFor: mergedSpecFor(dir), log });

  const ctx = gatherContext(dir);
  const cssText = analysis.cssFile ? (() => { try { return readFileSync(path.join(dir, analysis.cssFile), "utf8"); } catch { return ""; } })() : "";
  const palette = resolvePalette([...extractColors(cssText), ...(ctx.colors || [])]);
  const copy = ctx.copySample?.length ? { headline: ctx.copySample[0], paragraph: ctx.copySample.slice(1, 4).join(" ") || undefined } : {};
  const title = path.basename(dir);

  const html = buildSpecimenHtml({ directions: specimenDirections(dirs, stacks), faceCss, palette, copy, title });
  const outPath = path.join(dir, ".font-lab", "preview.html");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);

  return {
    path: outPath,
    rel: path.relative(dir, outPath),
    framework: analysis.framework,
    inline: !!inline && fetch !== false,
    fonts: families,
    directions: dirs.map((d) => ({ id: d.id, name: d.name, vibe: d.vibe })),
    nextStep:
      "Open the HTML (it's self-contained — fonts embedded, opens offline) and have the human compare. " +
      "Each card has a live render-check badge. Then record the pick with select_direction and ship with apply.",
  };
}

// Headless capture of the specimen sheet: open the local HTML, wait for the embedded render check
// to run, screenshot each card, and report per-face load verdicts — a VERIFIED capture (never a
// silent Times-in-disguise shot). No dev server, no init, no panel; works on any framework.
export async function screenshotSpecimen(projectDir, { htmlPath, outDir, executablePath, directions, vibe, count, fetch = true, inline = true } = {}) {
  const dir = path.resolve(projectDir);
  let html = htmlPath;
  if (!html) html = (await previewSpecimen(dir, { directions, vibe, count, fetch, inline })).path;
  const chromium = await loadChromium();
  const out = outDir ? path.resolve(outDir) : path.join(dir, ".font-lab", "previews");
  mkdirSync(out, { recursive: true });
  const { browser, via } = await launchBrowser(chromium, { executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 1400 }, deviceScaleFactor: 2 });
    await page.goto("file://" + html, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-fl-verified") === "1", { timeout: 15000 }).catch(() => {});
    const verdicts = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("[data-fl-card]")];
      return {
        summary: document.getElementById("fl-render-summary")?.textContent || "",
        allLoaded: document.getElementById("fl-render-summary")?.getAttribute("data-fl-all") === "1",
        cards: cards.map((c) => ({ id: c.getAttribute("data-fl-card"), check: c.querySelector(".fl-check")?.textContent || "" })),
      };
    });
    const shots = [];
    const cards = await page.$$("[data-fl-card]");
    for (const el of cards) {
      const id = await el.getAttribute("data-fl-card");
      const file = path.join(out, `${id}.png`);
      await el.screenshot({ path: file });
      shots.push({ id, screenshot: file, check: verdicts.cards.find((c) => c.id === id)?.check || "" });
    }
    return { html, outDir: out, browser: via, verified: verdicts.allLoaded, summary: verdicts.summary, shots };
  } finally {
    await browser.close();
  }
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

export async function apply(projectDir, opts = {}) {
  const dir = path.resolve(projectDir);
  const result = await applySelection(dir, opts);
  // Stamp the ship so the panel (via the endpoint's SSE) and font_lab_status can show
  // "shipped" for the current pick without guessing from file mtimes.
  writeAppliedStamp(dir, result);
  return result;
}

// Block until the human picks (or timeoutMs elapses) — the MCP-native handoff. While waiting,
// an agent-waiting marker makes the presence visible to the panel ("agent listening"), so the
// human knows their pick lands somewhere. fs.watch is advisory on some platforms; a 1s poll
// backstops it. Returns { picked, selection?, timedOut?, waitedMs }.
export async function waitForPick(projectDir, { timeoutMs = 240_000, ignoreExisting = false } = {}) {
  const dir = path.resolve(projectDir);
  const selPath = selectionPath(dir);
  const startedAt = Date.now();
  const baseline = ignoreExisting && existsSync(selPath) ? statSafe(selPath) : null;

  const current = () => {
    if (!existsSync(selPath)) return null;
    if (baseline) {
      const st = statSafe(selPath);
      if (st && st.mtimeMs <= baseline.mtimeMs) return null; // same stale pick — keep waiting
    }
    return readSelection(dir);
  };

  const immediate = current();
  if (immediate) return { picked: true, selection: immediate, waitedMs: 0 };

  mkdirSync(path.join(dir, ".font-lab"), { recursive: true });
  setAgentWaiting(dir, true);
  try {
    const selection = await new Promise((resolve) => {
      let watcher = null;
      let poller = null;
      let deadline = null;
      const settle = (v) => {
        try { watcher?.close(); } catch {}
        clearInterval(poller);
        clearTimeout(deadline);
        resolve(v);
      };
      const check = () => {
        const sel = current();
        if (sel) settle(sel);
      };
      try {
        watcher = fsWatch(path.join(dir, ".font-lab"), (_ev, name) => {
          if (!name || name === "selection.json") check();
        });
      } catch {}
      poller = setInterval(check, 1000);
      deadline = setTimeout(() => settle(null), timeoutMs);
      check();
    });
    if (selection) return { picked: true, selection, waitedMs: Date.now() - startedAt };
    return {
      picked: false,
      timedOut: true,
      waitedMs: Date.now() - startedAt,
      hint: "No pick yet. Call font_lab_wait_for_pick again to keep waiting, or check in with the human.",
    };
  } finally {
    setAgentWaiting(dir, false);
  }
}

// One snapshot of the whole handoff: the pick, the ship, agent presence, the endpoint, and
// the latest backup. The cheap "where are we?" for a resumed or interrupted session.
export async function status(projectDir, { port = 7777 } = {}) {
  const dir = path.resolve(projectDir);
  const state = readHandoffState(dir);
  let endpoint = { up: false, port };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 500);
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) {
      const body = await res.json();
      endpoint = { up: true, port, once: !!body.once, autoApply: !!body.autoApply };
      if (body.agentWaiting) state.agentWaiting = true;
    }
  } catch {}
  let backups = null;
  try {
    const runId = readFileSync(path.join(dir, ".font-lab", "backups", "latest.txt"), "utf8").trim();
    backups = { latestRunId: runId };
  } catch {}
  return { ...state, endpoint, backups, versions: panelDrift(dir) };
}

// Compare the version that installed the project's panel against the running tool. Surfaces the
// exact npx-cache trap to the AGENT — even when the panel is too old to render its own notice
// (a pre-stamp panel reads as stale, which is correct: it predates this feature).
function panelDrift(dir) {
  const panelPath = ["app", "src/app"]
    .map((d) => path.join(dir, d, "_fontlab", "FontLabDevPanel.tsx"))
    .find((p) => existsSync(p));
  const drift = { tool: VERSION, panel: null, stale: false };
  if (!panelPath) return drift; // no panel installed — nothing to warn about
  let installed = null;
  try {
    const m = readFileSync(panelPath, "utf8").match(/PANEL_VERSION\s*=\s*["']([^"']+)["']/);
    if (m && isRealVersion(m[1])) installed = m[1];
  } catch {}
  drift.panel = installed;
  // A real older stamp, or a panel with no stamp at all (predates the feature) => stale.
  drift.stale = installed ? cmpVersions(VERSION, installed) > 0 : true;
  if (drift.stale)
    drift.hint = `The Font Lab panel in this project ${installed ? `is v${installed}` : "predates version stamping"}, but ${VERSION} is running. Re-run font_lab_init to refresh the panel.`;
  return drift;
}

const statSafe = (p) => {
  try {
    return statSync(p);
  } catch {
    return null;
  }
};

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The exact inverse of mountPanel — surgically strips ONLY the dev-panel scaffolding so an
// intervening `apply` (which edits the same file) is preserved. Never restores from a backup.
function unmountPanel(src) {
  let out = src;
  // 1) the fenced dev-panel const block (+ the blank lines insertAfterImports padded it with)
  out = out.replace(new RegExp(`\\n*${escapeRe(INIT_START)}[\\s\\S]*?${escapeRe(INIT_END)}\\n*`, "g"), "\n");
  // 2) the dev-only render expression (loose match, robust to reformatting)
  out = out.replace(/[ \t]*\{[^\n}]*<FontLabDevPanel\b[^\n}]*\}\n?/g, "");
  // 3) the next/dynamic import we may have added — only if nothing else uses dynamic()
  if (/from\s+["']next\/dynamic["']/.test(out) && !/\bdynamic\s*\(/.test(out)) {
    out = out.replace(/^[ \t]*import\s+dynamic\s+from\s+["']next\/dynamic["'];?[ \t]*\n/m, "");
  }
  return out;
}

// Set the project up so the human can preview live: self-host the parity bundles, drop in the
// portable dev panel, and mount it (dev-only) in the layout. Idempotent + reversible (uninit).
export async function init(projectDir, { directions, vibe, count, allowFallback = true, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  if (!analysis.supported)
    throw new Error(
      analysis.applyMode === "css-entry"
        ? `the live in-app panel is Next-only, but this ${analysis.framework} project still ships: compose → capture_directions (screenshot preview) → select_direction → apply (self-hosted @font-face into ${analysis.capabilities.applyTarget}). Skip init.`
        : `project not supported yet: ${analysis.reasons.join("; ")}`,
    );
  const appDir = resolveAppDir(dir);
  const layout = path.join(appDir, "layout.tsx");

  const backupDir = path.join(dir, ".font-lab", "init-backup");
  mkdirSync(backupDir, { recursive: true });
  const backupLayout = path.join(backupDir, "layout.tsx");
  if (!existsSync(backupLayout)) copyFileSync(layout, backupLayout); // never clobber the original

  // Build the panel from the agent's brief-driven directions (the tasteful path). Refuse to mount
  // the generic default menu without a brief unless allowFallback is set (see flow.resolveDirectionsMode).
  const mode = resolveDirectionsMode({ directions, allowFallback });
  const dirs = mode === "composed" ? directions : curateDirections(analysis, { vibe, count });
  await ensureAdmitted(dir, dirs); // self-host any non-catalog (Google/foundry) faces the agent composed
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis) };
  const built = await generateCatalog(dir, dirs, meta, { fetch, log, specFor: mergedSpecFor(dir) });

  mkdirSync(path.join(appDir, "_fontlab"), { recursive: true });
  // Stamp the installing tool's version into the panel so it can later notice when it's stale.
  const panelSrc = readFileSync(PANEL_TEMPLATE, "utf8").replace(/__FONTLAB_VERSION__/g, VERSION);
  writeFileSync(path.join(appDir, "_fontlab", "FontLabDevPanel.tsx"), panelSrc);
  const mounted = mountPanel(layout);
  writePreviewSet(dir, dirs);

  return {
    analysis,
    mode,
    directions: dirs.map((d) => ({ id: d.id, name: d.name, vibe: d.vibe })),
    wiring: meta.wiring,
    deadRoles: analysis.coverage?.deadRoles || [],
    otherSubsystems: analysis.coverage?.otherSubsystems || [],
    prepared: built.fonts,
    mounted,
    layout: path.relative(dir, layout),
    nextStep:
      "Start your dev server, then have the human flip fonts in the panel (bottom-right) and Pick. " +
      "Want more options? compose additional directions and call font_lab_more_directions. Then read_pick → apply.",
  };
}

// Grow the live panel (#4): admit + APPEND newly-composed directions to the current preview set and
// rebuild, so the human can keep exploring without losing what's already there.
export async function expandPreview(projectDir, { directions, fetch = true, log } = {}) {
  if (!Array.isArray(directions) || !directions.length)
    throw new Error("expandPreview: provide the new `directions` to add (compose them first with compose_directions)");
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const merged = mergeDirections(readPreviewSet(dir), directions);
  await ensureAdmitted(dir, directions);
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis) };
  const result = await generateCatalog(dir, merged, meta, { fetch, log, specFor: mergedSpecFor(dir) });
  writePreviewSet(dir, merged);
  return { added: directions.length, total: merged.length, directions: result.directions };
}

export function uninit(projectDir) {
  const dir = path.resolve(projectDir);
  const appDir = resolveAppDir(dir);
  const layout = path.join(appDir, "layout.tsx");
  // Surgically strip the panel scaffolding — do NOT restore layout.tsx from the init backup,
  // which predates any `apply` and would silently wipe the shipped font change.
  let unmounted = false;
  if (existsSync(layout)) {
    const before = readFileSync(layout, "utf8");
    const after = unmountPanel(before);
    if (after !== before) {
      writeFileSync(layout, after);
      unmounted = true;
    }
  }
  rmSync(path.join(appDir, "_fontlab"), { recursive: true, force: true });
  rmSync(path.join(dir, "public", "fontlab"), { recursive: true, force: true });
  rmSync(path.join(dir, ".font-lab", "init-backup"), { recursive: true, force: true });
  return {
    layout: path.relative(dir, layout),
    unmountedPanel: unmounted,
    removed: ["app/_fontlab", "public/fontlab"],
    note: "Removed only the dev-panel scaffolding; any applied font change is left intact.",
  };
}

export function undo(projectDir) {
  const dir = path.resolve(projectDir);
  const result = undoApply(dir);
  clearAppliedStamp(dir); // state returns to "picked, not shipped"
  return result;
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
  // Never block the human's pick — but hand back an honest heads-up if it reads generic, so the
  // agent can relay it. The selection.json contract on disk stays clean (warnings aren't shipped).
  return { ...selection, warnings: pickWarnings(roles) };
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
    who: "AGENT WITH A LOCAL TERMINAL (Cursor, Claude Code, Windsurf, …): run the dev server and the :7777 endpoint YOURSELF as background tasks and leave them running (skip whichever is already up) — do NOT run them in the foreground, they never exit and your turn will hang. Then tell the human to open the site and pick. CLOUD / CONTAINER AGENT (no reach to the user's localhost): hand these commands to the human to run and tell them which URL to open — you can't start or reach these processes yourself.",
    steps: [
      "npx font-lab init --project .          # scaffold the live panel + parity bundles (reversible)",
      `${devCmd}                              # start your dev server (background task; leave running)`,
      "npx font-lab --project . &             # pick + copy-edit endpoint on :7777 (background; leave running)",
      "# open your site (e.g. http://localhost:3000): ← → flip · [ ] mix a role · B before/after · Pick",
      "#   …and double-click any text to retype it in place — it saves to source via the same endpoint",
      "npx font-lab-apply --project .         # the agent ships exactly what you picked",
    ],
    endpointNote: "The :7777 endpoint both records the pick AND saves in-panel copy edits (double-click text -> retype -> written to source, reversibly). Start it from the site's own root and keep it up the whole time the human is choosing or editing.",
    teardown: "npx font-lab init --project . --undo   # remove the panel scaffolding when done",
  };
}

// Find any already-installed Chromium on the machine, across Playwright's version-specific
// download layouts (old `chrome-linux/chrome` + headless_shell, new `chrome-linux64/...`), so we
// can screenshot with whatever browser exists instead of demanding Playwright's exact bundled
// revision. Returns the newest binary found, or null.
function discoverChromium() {
  const roots = [];
  const pbp = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pbp && pbp !== "0") roots.push(pbp);
  const home = os.homedir();
  roots.push(path.join(home, ".cache", "ms-playwright")); // linux default
  roots.push(path.join(home, "Library", "Caches", "ms-playwright")); // macOS default
  roots.push(path.join(home, "AppData", "Local", "ms-playwright")); // windows default
  const BINS = [
    "chrome-linux/chrome",
    "chrome-linux64/chrome",
    "chrome-linux/headless_shell",
    "chrome-headless-shell-linux64/chrome-headless-shell",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
    "chrome-win/chrome.exe",
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!/^chromium/i.test(e)) continue;
      const rev = Number((e.match(/(\d+)/) || [])[1] || 0);
      for (const b of BINS) {
        const p = path.join(root, e, b);
        if (existsSync(p)) {
          found.push({ rev, p });
          break;
        }
      }
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found[0]?.p || null;
}

// Launch Chromium from whatever the machine actually has — an explicit path, a pre-installed
// build (cloud envs), the user's system Chrome/Edge, or Playwright's own bundle — first one that
// launches wins. This sidesteps Playwright's hard pin to its exact bundled revision.
// Load Playwright's `chromium` driver, tolerating the two ways it can be present. We ship
// `playwright-core` as an OPTIONAL dependency (light — no bundled-browser download), so the
// headless screenshot path works out of the box for `npx font-lab` users instead of throwing on a
// missing devDependency. A full `playwright` (its own browser included) is preferred when present —
// e.g. in this repo's tests. Either driver launches whatever Chromium is on the machine (system
// Chrome/Edge or a pre-installed build; see launchBrowser). Throws ONE actionable error only when
// neither module resolves — a real load error inside an installed driver is re-thrown as-is.
async function loadChromium() {
  for (const mod of ["playwright", "playwright-core"]) {
    try {
      return (await import(mod)).chromium;
    } catch (e) {
      if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    }
  }
  throw new Error(
    "Screenshots need a Playwright driver. Install one — `npm i playwright-core` (light; uses your " +
      "system Chrome) or `npm i -D playwright` (bundles its own browser) — and, if no system Chrome is " +
      "present, `npx playwright install chromium`. Or skip headless and use the live editor (liveInstructions()).",
  );
}

async function launchBrowser(chromium, { executablePath } = {}) {
  const explicit = executablePath || process.env.FONT_LAB_CHROMIUM || process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const discovered = discoverChromium();
  const attempts = [
    explicit && { label: `executablePath ${explicit}`, opts: { executablePath: explicit } },
    { label: "playwright bundled", opts: {} },
    discovered && { label: `pre-installed ${discovered}`, opts: { executablePath: discovered } },
    { label: "system chrome", opts: { channel: "chrome" } },
    { label: "system edge", opts: { channel: "msedge" } },
  ].filter(Boolean);
  const tried = [];
  for (const a of attempts) {
    try {
      return { browser: await chromium.launch(a.opts), via: a.label };
    } catch (e) {
      tried.push(`${a.label}: ${String(e.message).split("\n")[0]}`);
    }
  }
  throw new Error(
    "couldn't launch a Chromium for screenshots. Tried:\n  - " +
      tried.join("\n  - ") +
      "\nFixes: `npx playwright install chromium`, set FONT_LAB_CHROMIUM=/path/to/chrome, or use the live editor (see liveInstructions).",
  );
}

// Headless capture: drive the REAL live panel through each direction and screenshot the site, so
// the images are faithful to what ships. Requires init() done and a dev server running at baseUrl.
// Makes no project edits — it only reads the running site. Returns a manifest the agent shows.
export async function captureDirections(projectDir, { baseUrl, routes = ["/"], outDir, directions, viewport, fullPage = true, executablePath } = {}) {
  if (!baseUrl) throw new Error("captureDirections: baseUrl is required (your running dev server, e.g. http://localhost:3000)");
  const chromium = await loadChromium();
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const dirs = directions && directions.length ? directions : curateDirections(analysis, {});
  const out = outDir ? path.resolve(outDir) : path.join(dir, ".font-lab", "previews");
  mkdirSync(out, { recursive: true });
  const base = baseUrl.replace(/\/+$/, "");
  const route = routes[0] || "/";

  const { browser, via } = await launchBrowser(chromium, { executablePath });
  try {
    const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    // Wait for `load`, not `networkidle`: a persistent third-party live script (e.g. a design
    // skill's live mode, HMR sockets) keeps the network busy so `networkidle` never fires and times
    // out. We gate readiness on the panel mounting + fonts being ready instead, which is what we
    // actually need for a faithful shot.
    await page.goto(base + route, { waitUntil: "load", timeout: 30000 });
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
    return { baseUrl: base, route, outDir: out, browser: via, shots, live: liveInstructions(dir) };
  } finally {
    await browser.close();
  }
}
