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
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, readdirSync, watch as fsWatch, statSync } from "node:fs";
import { catalog, get as catalogGet, inCatalog } from "./catalog.mjs";
import { curate as curateDirections } from "./curator.mjs";
import { designBrief, isOverexposed, antiGenericViolations, pickWarnings } from "./design-brain.mjs";
import { gatherContext, extractColors, deriveSignals } from "./context.mjs";
import { resolveDirectionsMode, mergeDirections } from "./flow.mjs";
import { buildSpecimenHtml } from "./specimen.mjs";
import { admit as admitFont, normalize as normFamily, isShippable } from "./admit.mjs";
import { analyzeProject, toTarget, wiringFor } from "./analyzer.mjs";
import { generateCatalog, buildParityBundles } from "./catalog-build.mjs";
import { applySelection, undo as undoApply, rewireCoverage } from "./codegen.mjs";
import { readHandoffState, writeAppliedStamp, clearAppliedStamp, setAgentWaiting, selectionPath, writeMenuState, readMenuState, readRequest, clearRequest, requestPath, ensureFlDir, appendSourceEdit, readDevServer, ensureSelfIgnoredDir, removeFontLabGitignore, readScaffoldPrefs, writeScaffoldPrefs, scaffoldMounted, readDoneRequest, clearDoneRequest, readInstallManifest, INIT_MARKER, writeCaptureBlocked, readCaptureBlocked, clearCaptureBlocked } from "./state.mjs";
import { buildCommitPlan } from "./commit-plan.mjs";
import { detectEnvironment, remoteWorkflowNote } from "./environ.mjs";
import { startManagedServer, probeHttp, detectDevCommand } from "./dev-server.mjs";
import { VERSION, cmpVersions, isRealVersion, installedVersionIn } from "./version.mjs";
import { scanCsp } from "./csp.mjs";
import { versionSkew, checkScaffold, healthcheck as runHealthcheck } from "./healthcheck.mjs";

const PANEL_TEMPLATE = fileURLToPath(new URL("./templates/font-lab-panel.tsx", import.meta.url));
// The census (render-first classifier) — ONE source, consumed two ways: init copies it next to
// the panel (module import), and verifyShip injects the same file into a headless page (it is
// deliberately plain JS in a .ts wrapper). Panel voices and receipt voices can never drift.
const CENSUS_TEMPLATE = fileURLToPath(new URL("./templates/fl-census.ts", import.meta.url));

const ROLES = ["display", "body", "mono"];
const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Where HEADLESS previews download woff2 bytes: inside the self-ignored state dir, so a
// screenshot/portable-sheet session leaves ZERO untracked files in the repo. Only an actual
// ship (apply / the Next panel bundle) writes fonts under public/ — see buildParityBundles.
const fontCacheDir = (dir) => path.join(ensureFlDir(dir), "fonts");

// The deterministic fallback menu, but SEEDED to this project — the same project always yields the
// same spread, while two different projects yield different (still diverse, still non-generic)
// spreads. This is what stops the fallback from being byte-identical on every site. Every fallback
// call site routes through here so the panel, the screenshots, and a later headless select all
// resolve to the same set.
function fallbackDirections(dir, analysis, { vibe, count } = {}) {
  const { seed, hints } = deriveSignals(path.basename(dir), gatherContext(dir));
  return curateDirections(analysis, { vibe, count, seed, signals: hints });
}

// The in-band heads-up an agent gets when it mounts or ships the deterministic starter menu instead
// of a brief-tailored one — so a menu that was never tailored to the project can't quietly become
// the product. null when the menu was composed for a brief.
function fallbackNotice(mode) {
  if (mode !== "fallback") return null;
  return (
    "You mounted the DETERMINISTIC STARTER MENU (allowFallback) — it's seeded to this project so it " +
    "isn't identical across projects, but it is NOT tailored to the human's brief. Fine for a quick " +
    "smoke-test while wiring things up; before the human picks, run intake (font_lab_start) → " +
    "font_lab_compose_directions → font_lab_prepare_preview so the options actually fit what they asked for."
  );
}

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
export function start(projectDir, { remote } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const context = gatherContext(dir); // the project's own palette, brand docs, and copy voice (B2)
  const { seed } = deriveSignals(path.basename(dir), context); // rotates the brief's references per project
  const cap = analysis.capabilities;
  // Where is the agent running? A cloud/container session changes WHICH choosing moment to lead
  // with (the human can't reach this machine's localhost), never the loop itself.
  const environment = detectEnvironment({ remote });
  const workflowNote = remoteWorkflowNote(environment);
  // The intake + taste steps are identical on every stack; only HOW the human previews and how
  // the pick ships differ. Hand the agent the right path for THIS project instead of assuming Next.
  const previewShip = cap.livePanel
    ? environment.remote && !environment.portForwarded
      ? "this is a Next project (live panel capable), but in THIS remote session the human can't reach the panel — drive the pick with `font_lab_screenshot_directions` (it can start the dev server itself; show the hero shots in chat), then `font_lab_select` → `apply`. Mention the live panel as what they'd get running locally."
      : "`init` the live in-app panel, have the human flip/mix/pick in the browser, then `read_pick` → `apply`."
    : cap.autoApply
      ? `the live in-app panel is Next-only, so SKIP init — the choosing surface here is the human's REAL SITE: \`font_lab_screenshot_directions\` paints each direction onto their actual pages (census paint — no panel, no project writes) and STARTS the dev server itself if none is running (managed, 127.0.0.1, stopped after). Show the returned heroShot images to the human. The generic specimen sheet (\`font_lab_preview\`) is NOT a peer option — it stays locked until a real capture attempt fails on infrastructure, so don't reach for it (or open .font-lab/preview.html) first. Then record the pick (\`font_lab_select\`) and \`apply\` — it self-hosts the parity woff2 and rewires ${cap.applyTarget} (${analysis.framework}, no next/font), reversibly.`
      : `no auto-ship branch here (${analysis.reasons.join("; ") || "unsupported stack"}) — but the REAL-SITE preview works all the same: \`font_lab_screenshot_directions\` paints each direction onto the running site (any framework; it starts the dev server itself) — show the heroShots. (The generic \`font_lab_preview\` sheet stays locked until a real capture attempt fails.) Record the pick (\`font_lab_select\`), then the human pastes Font Lab's generated @font-face + role mapping into ${cap.applyTarget || "their CSS entry"} by hand.`;
  // The same routing as DATA — prose gets skimmed; a named primary/fallback pair survives it.
  const previewPlan = cap.livePanel
    ? environment.remote && !environment.portForwarded
      ? { primary: "font_lab_screenshot_directions", fallback: "font_lab_preview — LOCKED until a real capture attempt fails (or force:true when the human explicitly wants the offline sheet)", note: "remote session: the human can't reach this machine's live panel — screenshots ARE the choosing moment." }
      : { primary: "font_lab_init (live panel)", fallback: "font_lab_screenshot_directions for a headless pass", note: "Next App Router + local human: the in-browser panel is the best surface." }
    : { primary: "font_lab_screenshot_directions", fallback: "font_lab_preview — LOCKED until a real capture attempt fails (or force:true when the human explicitly wants the offline sheet)", note: "non-Next stack: the human's real pages, captured per direction, are THE choosing surface. Never present .font-lab/preview.html as the preview." };
  return {
    analysis,
    capabilities: cap, // what an agent can actually do here — a paved path, not a refusal
    shipNote: analysis.shipNote,
    environment: { ...environment, ...(workflowNote ? { workflowNote } : {}) },
    context, // the project's own palette, brand docs, and copy voice (B2)
    previewPlan,
    brief: designBrief({ seed }),
    nextStep:
      "Read `context` (the project's palette, brand docs, and copy) — your options must fit THIS " +
      "project, not a generic default. Then ask the human the intake questions in `brief.intake` " +
      "and wait for the answers, compose tailored directions for their brief (reach past " +
      "`brief.avoid`; draw on `brief.references`), and let the HUMAN pick. `curate` is the " +
      "fallback when there's no brief. To preview + ship: " + previewShip +
      (workflowNote ? " ENVIRONMENT: " + workflowNote : ""),
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
      ensureFlDir(projectDir);
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

// The default menu: ~5 deterministic directions, seeded to THIS project (so it isn't the same
// spread every site) and leaning on the project's own signals.
export function curate(projectDir, opts = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  return { analysis, directions: fallbackDirections(dir, analysis, opts) };
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
  // Persist the composed set as THE prepared menu on every stack — not just after the Next-only
  // `init`. This is what screenshot_directions and select resolve against by default, so a
  // non-Next flow can never silently drift back to the starter menu (the dogfood's cloud trap),
  // and a pick by id always resolves against the directions the human actually saw.
  let persisted = false;
  let nextStep = null;
  if (projectDir) {
    const dir = path.resolve(projectDir);
    writePreviewSet(dir, directions);
    writeMenuState(dir, { mode: "composed", count: directions.length });
    persisted = true;
    // Steer the very next call from the tool result itself (agents act on the result in front of
    // them more reliably than on a skill read minutes ago — the Vite dogfood's ask): name THE
    // choosing surface for this stack, and warn off the generic sheet where it isn't it.
    try {
      const cap = analyzeProject(dir).capabilities;
      nextStep = cap.livePanel
        ? "Next: font_lab_init({ projectDir, directions }) mounts the live panel with exactly these directions (the human flips/picks in their browser). Headless/remote instead? font_lab_screenshot_directions({ projectDir }) captures the real site per direction."
        : "Next: font_lab_screenshot_directions({ projectDir }) — it starts the dev server itself if none is running, paints these directions onto the human's REAL pages, and returns chat-sized heroShot images. SHOW those to the human and ask for a pick (font_lab_select). Do NOT open or present .font-lab/preview.html — the generic specimen sheet is locked until a real capture attempt fails.";
    } catch {} // steering is best-effort — composition stands even if analysis hiccups
  }
  return {
    directions,
    warnings,
    ...(persisted
      ? { persisted: ".font-lab/preview.json — this set is now the default for font_lab_screenshot_directions / font_lab_preview / font_lab_select on every framework" }
      : { persisted: false, note: "pass projectDir to persist this set as the project's default preview menu (recommended — screenshots and select then resolve against it automatically)" }),
    ...(nextStep ? { nextStep } : {}),
  };
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
  ensureFlDir(dir);
  writeFileSync(p, JSON.stringify(dirs, null, 2) + "\n");
}
// Exported for `font-lab upgrade`: a panel re-stamp must rebuild from the directions the human
// was ALREADY browsing, never replace a tailored menu with the starter one.
export function readPreviewSet(dir) {
  const p = previewSetPath(dir);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

// ONE resolution order for every headless choosing surface (screenshots, the portable sheet,
// select): explicit directions → the persisted composed set → the deterministic starter menu,
// the last ONLY when the caller allows it. Exported for tests. The MCP layer passes
// allowFallback:false, so a tool call can never silently capture a menu nobody composed — the
// exact trap from the cloud dogfood: the doc promised "never silently the starter menu" while
// the non-Next path (which has no init to persist a set) did precisely that.
export function resolveCaptureSet(dir, analysis, { directions, vibe, count, allowFallback = true } = {}) {
  if (directions && directions.length) return { directions, source: "explicit" };
  const prepared = readPreviewSet(dir);
  if (prepared.length) return { directions: prepared, source: "preview-set" };
  if (allowFallback) return { directions: fallbackDirections(dir, analysis, { vibe, count }), source: "fallback" };
  throw new Error(
    "no directions to render: none were passed, and no composed set exists yet (.font-lab/preview.json). " +
      "Run font_lab_compose_directions with projectDir first — it persists the composed menu as the default here — " +
      "or pass allowFallback:true to deliberately use the deterministic starter menu (NOT tailored to this project's brief).",
  );
}

// ── prepare the live preview (build parity bundles into the project) ──────────
// Builds from the agent-composed `directions` (the tasteful, brief-driven path). With none, refuse
// unless allowFallback — so the generic default menu isn't mounted without the agent asking first.
// The MCP layer passes allowFallback:false (forcing intake); direct/CLI callers default to true.
export async function preparePreview(projectDir, { directions, vibe, count, allowFallback = true, fetch = true, allowVersionSkew = false, log } = {}) {
  const dir = path.resolve(projectDir);
  assertNoVersionSkew(dir, { allow: allowVersionSkew, verb: "font_lab_prepare_preview" });
  const analysis = analyzeProject(dir);
  const mode = resolveDirectionsMode({ directions, allowFallback });
  const dirs = mode === "composed" ? directions : fallbackDirections(dir, analysis, { vibe, count });
  await ensureAdmitted(dir, dirs); // admit any non-catalog (Google/foundry) families before building
  // Include `wiring` so the panel knows which leaf var to override per role — without it every
  // role renders "not wired" and the live swap is a no-op (must match init's meta). `menuMode` lets
  // the panel badge a fallback menu as provisional.
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis), menuMode: mode };
  const result = await generateCatalog(dir, dirs, meta, { fetch, log, specFor: mergedSpecFor(dir) });
  writePreviewSet(dir, dirs);
  writeMenuState(dir, { mode, count: dirs.length });
  syncScaffoldIgnores(dir); // a rebuild must not undo (or miss) the scaffold's self-ignore
  return { analysis, mode, provisional: mode === "fallback", warning: fallbackNotice(mode), prepared: result.fonts, directions: result.directions, outPath: result.outPath };
}

// ── the specimen gate: screenshots-first, ENFORCED ───────────────────────────
// The portable sheet renders generic specimen cards — never the human's pages — so wherever the
// real-site capture could work it is the WRONG choosing surface. Documentation alone didn't hold
// (the Vite dogfood: preview.html was easier to reach than the real screenshots, so the human
// was handed generic cards and asked "where's my site?"). So the ladder is enforced by the tools
// themselves: the sheet unlocks only when
//   • a real font_lab_screenshot_directions attempt FAILED on infrastructure — the failure is on
//     record (.font-lab/capture-blocked.json) and rides the sheet result as `unlockedBecause`; or
//   • force:true — the human EXPLICITLY asked for the portable offline artifact.
// Engine callers opt in via screenshotFirst:true; the TOOL layer always passes it, so every
// agent transport (MCP and `run` alike) gets the enforcement. Direct engine/test callers keep
// the old behavior.
function specimenGate(dir, analysis, { force = false } = {}) {
  if (force) return { via: "force" };
  const blocked = readCaptureBlocked(dir);
  if (blocked)
    return {
      via: "capture-blocked",
      unlockedBecause: blocked,
      note:
        `Specimen sheet unlocked because the real-site capture failed (${blocked.stage}: ${String(blocked.error).split("\n")[0]}). ` +
        "These are generic cards, NOT the human's pages — if that failure is fixable (install a Chromium, fix the dev script), fix it and re-run font_lab_screenshot_directions instead.",
    };
  const { devCmd } = detectDevCommand(dir);
  const panelNote = analysis?.capabilities?.livePanel
    ? "This is a Next App Router project — the live panel (font_lab_init) is the best surface when the human is local; headless, "
    : "";
  throw new Error(
    "refusing to build the GENERIC specimen sheet: the real-site preview hasn't been tried here, and specimen cards are never the choosing surface while the human's actual pages can be captured. " +
      panelNote +
      `call font_lab_screenshot_directions({ projectDir }) — it manages the dev server itself (detected dev command: ${devCmd ? `\`${devCmd}\`` : "none found — it will report that too"}), paints each direction onto the human's REAL pages, and returns chat-sized heroShot images to show them. ` +
      "If that fails on infrastructure (no Chromium can launch, the dev server won't serve), this tool unlocks automatically with the failure on record. " +
      "Pass force:true ONLY when the human explicitly asked for the portable offline sheet.",
  );
}

// ── the portable "choosing moment" (framework-agnostic, no dev server) ────────
// Build a single self-contained HTML sheet — the parity fonts embedded (base64 when inlined) —
// that renders each direction on the project's own palette. Works on ANY project (it's just a
// file the human opens), which is what the live in-app panel can't be. Carries a real width-diff
// render check so a silently-fallen-back font is badged, not trusted (the fonts.check trap).
// NOT the first resort: with screenshotFirst:true (every tool-layer call) it refuses until a
// real-site capture attempt has failed — see specimenGate above.

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

export async function previewSpecimen(projectDir, { directions, vibe, count, inline = true, fetch = true, allowFallback = true, screenshotFirst = false, force = false, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const gate = screenshotFirst ? specimenGate(dir, analysis, { force }) : null;
  const resolved = resolveCaptureSet(dir, analysis, { directions, vibe, count, allowFallback });
  const dirs = resolved.directions;
  await ensureAdmitted(dir, dirs);

  const families = [...new Set(dirs.flatMap((d) => ROLES.map((r) => d.roles?.[r]?.family ?? d[r]).filter(Boolean)))];
  // cacheDir: specimen bytes are inlined into the HTML — they never need to live in the repo.
  const { faceCss, stacks } = await buildParityBundles(dir, families, { fetch, inline, staticDir: analysis.staticDir, cacheDir: fontCacheDir(dir), specFor: mergedSpecFor(dir), log });

  const ctx = gatherContext(dir);
  const cssText = analysis.cssFile ? (() => { try { return readFileSync(path.join(dir, analysis.cssFile), "utf8"); } catch { return ""; } })() : "";
  const palette = resolvePalette([...extractColors(cssText), ...(ctx.colors || [])]);
  const copy = ctx.copySample?.length ? { headline: ctx.copySample[0], paragraph: ctx.copySample.slice(1, 4).join(" ") || undefined } : {};
  const title = path.basename(dir);

  const html = buildSpecimenHtml({ directions: specimenDirections(dirs, stacks), faceCss, palette, copy, title });
  const outPath = path.join(ensureFlDir(dir), "preview.html");
  writeFileSync(outPath, html);

  return {
    path: outPath,
    rel: path.relative(dir, outPath),
    framework: analysis.framework,
    inline: !!inline && fetch !== false,
    fonts: families,
    directionsSource: resolved.source,
    ...(resolved.source === "fallback" ? { menuWarning: fallbackNotice("fallback") } : {}),
    ...(gate?.unlockedBecause ? { unlockedBecause: gate.unlockedBecause, gateNote: gate.note } : {}),
    directions: dirs.map((d) => ({ id: d.id, name: d.name, vibe: d.vibe })),
    nextStep:
      "Open the HTML (it's self-contained — fonts embedded, opens offline) and have the human compare. " +
      "Each card has a live render-check badge. Then record the pick with select_direction and ship with apply. " +
      "NOTE: these are specimen cards, not the human's pages — when a dev server is running (any framework), " +
      "prefer font_lab_screenshot_directions: it screenshots the REAL site in each direction.",
  };
}

// Headless capture of the specimen sheet: open the local HTML, wait for the embedded render check
// to run, screenshot each card, and report per-face load verdicts — a VERIFIED capture (never a
// silent Times-in-disguise shot). No dev server, no init, no panel; works on any framework.
export async function screenshotSpecimen(projectDir, { htmlPath, outDir, executablePath, directions, vibe, count, fetch = true, inline = true, allowFallback = true, screenshotFirst = false, force = false } = {}) {
  const dir = path.resolve(projectDir);
  // Same gate as previewSpecimen (this is just its headless capture): check ONCE here, then the
  // internal sheet build below is already sanctioned.
  const gate = screenshotFirst ? specimenGate(dir, analyzeProject(dir), { force }) : null;
  let html = htmlPath;
  if (!html) html = (await previewSpecimen(dir, { directions, vibe, count, fetch, inline, allowFallback })).path;
  const chromium = await loadChromium(dir);
  const out = outDir ? path.resolve(outDir) : path.join(ensureFlDir(dir), "previews");
  mkdirSync(out, { recursive: true });
  const { browser, via } = await launchBrowser(chromium, { executablePath, projectDir: dir });
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
    return {
      html,
      outDir: out,
      browser: via,
      verified: verdicts.allLoaded,
      summary: verdicts.summary,
      ...(gate?.unlockedBecause ? { unlockedBecause: gate.unlockedBecause, gateNote: gate.note } : {}),
      shots,
    };
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
  // If the pick came from the deterministic starter menu (mounted via allowFallback), say so —
  // shipping it is fine, but the human may not realize the options were never tailored to them.
  const menu = readMenuState(dir);
  if (menu?.mode === "fallback")
    result.menuWarning =
      "Heads up: this pick came from the deterministic starter menu, not one tailored to this project's brief. If the human wanted options tailored to what they're going for, run intake → compose → prepare_preview and let them pick again — reversible via font_lab_undo.";
  // Files written ≠ pixels changed. The receipt (font_lab_verify) is what closes a font ship.
  result.verifyNext =
    "apply edited files — it did not prove pixels changed. With the dev server running, call font_lab_verify (on the routes the human cares about) for the convergence receipt; anything apply couldn't reach comes back as a ready-to-execute work order.";
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

  ensureFlDir(dir);
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

// Block until the human asks for MORE options in the panel (the "none of these" flow), or timeout.
// The MCP-native counterpart to waitForPick: while parked here the agent shows as "listening", so a
// human who clicks "more" reaches a live agent instead of the copy-a-prompt off-ramp. Resolves with
// the human's mini-brief + the families they've already seen, so the agent composes something NEW.
// Returns { requested, request?, timedOut?, waitedMs }.
export async function waitForRequest(projectDir, { timeoutMs = 240_000 } = {}) {
  const dir = path.resolve(projectDir);
  const reqPath = requestPath(dir);
  const startedAt = Date.now();
  const current = () => {
    const r = readRequest(dir);
    return r && r.status === "pending" ? r : null;
  };

  const immediate = current();
  if (immediate) return { requested: true, request: immediate, waitedMs: 0 };

  ensureFlDir(dir);
  setAgentWaiting(dir, true);
  try {
    const request = await new Promise((resolve) => {
      let watcher = null, poller = null, deadline = null;
      const settle = (v) => {
        try { watcher?.close(); } catch {}
        clearInterval(poller);
        clearTimeout(deadline);
        resolve(v);
      };
      const check = () => { const r = current(); if (r) settle(r); };
      try {
        watcher = fsWatch(path.join(dir, ".font-lab"), (_ev, name) => {
          if (!name || name === "request.json") check();
        });
      } catch {}
      poller = setInterval(check, 1000);
      deadline = setTimeout(() => settle(null), timeoutMs);
      check();
    });
    if (request) return { requested: true, request, waitedMs: Date.now() - startedAt };
    return {
      requested: false,
      timedOut: true,
      waitedMs: Date.now() - startedAt,
      hint: "No 'more options' request yet. Call font_lab_wait_for_request again to keep listening, or check in with the human.",
    };
  } finally {
    setAgentWaiting(dir, false);
  }
}

// Unified event wait: block until EITHER the human picks OR requests more options, whichever
// comes first. Collapses waitForPick + waitForRequest into a single tool so agents don't need
// to choose. Returns { event: "pick"|"request"|"timeout", ... }.
export async function waitForEvent(projectDir, { timeoutMs = 240_000, ignoreExistingPick = false } = {}) {
  const dir = path.resolve(projectDir);
  const selPath = selectionPath(dir);
  const reqPath = requestPath(dir);
  const startedAt = Date.now();
  const baseline = ignoreExistingPick && existsSync(selPath) ? statSafe(selPath) : null;

  const currentPick = () => {
    if (!existsSync(selPath)) return null;
    if (baseline) {
      const st = statSafe(selPath);
      if (st && st.mtimeMs <= baseline.mtimeMs) return null;
    }
    return readSelection(dir);
  };
  const currentRequest = () => {
    const r = readRequest(dir);
    return r && r.status === "pending" ? r : null;
  };
  const currentDone = () => readDoneRequest(dir);

  const immPick = currentPick();
  if (immPick) return { event: "pick", picked: true, selection: immPick, waitedMs: 0 };
  const immReq = currentRequest();
  if (immReq) return { event: "request", requested: true, request: immReq, waitedMs: 0 };
  const immDone = currentDone();
  if (immDone) return { event: "done", done: true, request: immDone, waitedMs: 0 };

  ensureFlDir(dir);
  setAgentWaiting(dir, true);
  try {
    const result = await new Promise((resolve) => {
      let watcher = null, poller = null, deadline = null;
      const settle = (v) => {
        try { watcher?.close(); } catch {}
        clearInterval(poller);
        clearTimeout(deadline);
        resolve(v);
      };
      const check = () => {
        const pick = currentPick();
        if (pick) return settle({ event: "pick", picked: true, selection: pick });
        const req = currentRequest();
        if (req) return settle({ event: "request", requested: true, request: req });
        const done = currentDone();
        if (done) return settle({ event: "done", done: true, request: done });
      };
      try {
        watcher = fsWatch(path.join(dir, ".font-lab"), (_ev, name) => {
          if (!name || name === "selection.json" || name === "request.json" || name === "done.json") check();
        });
      } catch {}
      poller = setInterval(check, 1000);
      deadline = setTimeout(() => settle(null), timeoutMs);
      check();
    });
    if (result) return { ...result, waitedMs: Date.now() - startedAt };
    return {
      event: "timeout",
      picked: false,
      requested: false,
      done: false,
      timedOut: true,
      waitedMs: Date.now() - startedAt,
      hint: "No pick, request, or done signal yet. Call font_lab_wait again to keep listening, or check in with the human.",
    };
  } finally {
    setAgentWaiting(dir, false);
  }
}

// The human's pending "more options" ask, if any (mini-brief + the families to avoid repeating).
export function readMoreRequest(projectDir) {
  const r = readRequest(path.resolve(projectDir));
  return r && r.status === "pending" ? r : null;
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
      endpoint = { up: true, port, once: !!body.once, autoApply: !!body.autoApply, version: body.version ?? null };
      if (body.agentWaiting) state.agentWaiting = true;
      if (body.agentParked) state.agentParked = true; // a --once serve is parked presence the files can't see
      // The endpoint keeps its boot-time version for its whole life; npm install doesn't restart
      // it. Surface the drift to the agent — it's the "0.12.1 endpoint, 0.12.2 package" trap.
      if (isRealVersion(body.version) && cmpVersions(VERSION, body.version) > 0) {
        endpoint.stale = true;
        endpoint.hint = `The :7777 endpoint is running ${body.version} but ${VERSION} is installed — kill it and relaunch \`npx font-lab serve\` to pick up the new version.`;
      }
    }
  } catch {}
  let backups = null;
  try {
    const runId = readFileSync(path.join(dir, ".font-lab", "backups", "latest.txt"), "utf8").trim();
    backups = { latestRunId: runId };
  } catch {}
  // Dev-server health, seeded by the panel's own origin report (the panel can't report the
  // server being DOWN — no server, no panel — so the agent learns it here and restarts it).
  let devServer = null;
  const ds = readDevServer(dir);
  if (ds?.origin) {
    let up = false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 800);
      const res = await fetch(ds.origin, { signal: ctl.signal, redirect: "manual" });
      clearTimeout(t);
      up = res.status < 500;
    } catch {}
    devServer = { url: ds.origin, up, lastSeen: ds.at ?? null };
    if (!up) devServer.hint = `The dev server at ${ds.origin} is not responding. The LIVE PANEL needs it restarted (background task, bound to 127.0.0.1); font_lab_screenshot_directions and font_lab_verify will start the project's dev server themselves.`;
  }
  const environment = detectEnvironment();
  return {
    ...state,
    endpoint,
    backups,
    devServer,
    menu: readMenuState(dir),
    // The "can I get real-site screenshots RIGHT NOW?" snapshot — composed set, captures and
    // their freshness, whether a Playwright driver/browser resolves, and any recorded capture
    // failure. Answers the dogfood's status ask without launching anything.
    preview: previewReadiness(dir),
    versions: (() => {
      const v = { ...panelDrift(dir), installed: installedVersionIn(dir) };
      const skew = versionSkew(dir);
      if (skew) v.skew = skew; // the init-refusing mismatch, visible from status too
      return v;
    })(),
    environment: { kind: environment.kind, remote: environment.remote, ...(environment.remote ? { note: remoteWorkflowNote(environment) } : {}) },
    // The commit moment, answered up front: the git-verified two-pile plan (ship vs scaffold,
    // ready-to-run commands) — so "what do I actually commit?" never needs reverse-engineering.
    commitPlan: buildCommitPlan(dir),
    // What `font-lab install` wired, in and out of the repo — the footprint receipt.
    footprint: readInstallManifest(dir),
  };
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

// Preview readiness for font_lab_status — cheap on purpose (resolution probes + directory reads,
// never a browser launch), so status stays a fast snapshot. The `playwright.driver` field also
// answers the MCP/CLI parity question up front: it reports WHICH install would be used
// (project-first, mirroring loadChromium), so "installed it, still failing" has a place to look.
function previewReadiness(dir) {
  const set = readPreviewSet(dir);
  const setStat = statSafe(previewSetPath(dir));
  const shotsDir = path.join(dir, ".font-lab", "previews");
  let shots = { count: 0, newestAt: null };
  try {
    const files = readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
    let newest = 0;
    for (const f of files) {
      const s = statSafe(path.join(shotsDir, f));
      if (s && s.mtimeMs > newest) newest = s.mtimeMs;
    }
    shots = { count: files.length, newestAt: newest ? new Date(newest).toISOString() : null };
  } catch {}
  const stale = !!(shots.newestAt && setStat && setStat.mtimeMs > new Date(shots.newestAt).getTime());
  let driver = null;
  const probes = [];
  try { probes.push(["project", createRequire(path.join(dir, "package.json"))]); } catch {}
  try { probes.push(["font-lab", createRequire(import.meta.url)]); } catch {}
  for (const [where, req] of probes) {
    for (const mod of ["playwright", "playwright-core"]) {
      try {
        req.resolve(mod);
        driver = `${mod} (${where})`;
        break;
      } catch {}
    }
    if (driver) break;
  }
  const browser = discoverChromium(dir);
  const blocked = readCaptureBlocked(dir);
  const sheet = existsSync(path.join(dir, ".font-lab", "preview.html"));
  return {
    composedSet: { exists: set.length > 0, count: set.length, at: setStat ? setStat.mtime.toISOString() : null },
    screenshots: {
      dir: path.join(".font-lab", "previews"),
      ...shots,
      ...(stale ? { stale: true, hint: "the composed set changed after these were captured — re-run font_lab_screenshot_directions" } : {}),
    },
    playwright: {
      driver,
      discoveredBrowser: browser,
      ...(driver
        ? browser
          ? {}
          : { browserNote: "no browser in the Playwright caches — launch will try the system Chrome/Edge channels, or run `npx playwright install chromium`" }
        : { hint: "no Playwright driver resolves — `npm i -D playwright-core` IN THE PROJECT (picked up immediately by MCP and CLI alike, no restart)" }),
    },
    ...(blocked ? { captureBlocked: { ...blocked, note: "a real-site capture attempt failed — the specimen-sheet fallback is unlocked, but fixing this and re-running font_lab_screenshot_directions is the better path" } } : {}),
    ...(sheet ? { specimenSheet: { path: path.join(".font-lab", "preview.html"), note: "generic fallback artifact — NOT the human's pages; never present it while real-site captures can run" } } : {}),
    hint: !set.length
      ? "no composed set yet — run font_lab_compose_directions({ projectDir, directions }) after intake"
      : shots.count === 0
        ? "composed set ready, no captures yet — run font_lab_screenshot_directions({ projectDir })"
        : stale
          ? "captures predate the current composed set — re-run font_lab_screenshot_directions({ projectDir })"
          : "captures exist — show the heroShot images and record the pick with font_lab_select",
  };
}

// Fix a role the analyzer flags as dead (declared but not actually rendered). Reversible.
export function rewire(projectDir) {
  return rewireCoverage(path.resolve(projectDir));
}

// The post-init healthcheck — "prove the page works BEFORE inviting the human." Versions,
// scaffold completeness, a real homepage GET (with the 500 module-not-found sniff), the :7777
// endpoint, and the CSP scan, folded into { ready, blockers, warnings, nextStep }. Read-only.
// The skill rule it enforces: do not invite the human until ready:true.
export async function healthcheck(projectDir, { baseUrl, port = 7777, timeoutMs } = {}) {
  const dir = path.resolve(projectDir);
  let analysis = null;
  try {
    analysis = analyzeProject(dir);
  } catch {} // the module re-tries and degrades honestly
  return runHealthcheck(dir, { baseUrl, port, timeoutMs, analysis });
}

// ── install / uninstall the live panel (the agent's "setup" step) ────────────

const INIT_START = INIT_MARKER; // one string, shared with state.scaffoldMounted (the hook reads it too)
const INIT_END = "// font-lab:init:end";

function resolveAppDir(projectDir) {
  const d = ["app", "src/app"].map((x) => path.join(projectDir, x)).find((x) => existsSync(path.join(x, "layout.tsx")));
  if (!d) throw new Error("could not find app/layout.tsx (App Router only)");
  return d;
}

// The scaffold-hygiene sweep: every dir the panel path may have created gets the same nested
// `*` .gitignore that keeps .font-lab/ invisible — so the dev tooling never shows up in the
// human's `git status` as something to puzzle over at commit time. public/fontlab here is
// PREVIEW staging only (init is Next-panel-only; the css-entry SHIP path writes real runtime
// assets there and strips this ignore — see buildParityBundles' caller in codegen). The human's
// opt-out (`init` with tracked:true) persists in .font-lab/scaffold.json so later rebuilds
// don't silently re-ignore what they chose to track.
function syncScaffoldIgnores(dir, appDir = null) {
  const tracked = readScaffoldPrefs(dir)?.tracked === true;
  const candidates = new Set(
    [
      appDir ? path.join(appDir, "_fontlab") : null,
      path.join(dir, "app", "_fontlab"), // generateCatalog's fixed output home
      path.join(dir, "src", "app", "_fontlab"),
      path.join(dir, "public", "fontlab"),
    ].filter(Boolean),
  );
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (tracked) removeFontLabGitignore(c);
    else ensureSelfIgnoredDir(c, "dev-panel scaffolding (regenerable — font_lab_init rebuilds it; font_lab_finish removes it)");
  }
  return !tracked;
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
  // Preserve the layout's own indentation of </body> instead of hardcoding one — this is what
  // lets unmountPanel restore the file byte-identical (the finish contract: git status after
  // finish == the product diff, no stray whitespace).
  if (!/<FontLabDevPanel\s*\/>/.test(src))
    src = src.replace(/([ \t]*)<\/body>/, (_m, ind) => `  {process.env.NODE_ENV === "development" && <FontLabDevPanel />}\n${ind}</body>`);
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
  // 2) the dev-only render expression — the exact inverses of mountPanel's two insert shapes
  //    first (so the round-trip is byte-identical), then a loose fallback for hand-reformats:
  //    a) the expression got its own line (</body> was already on one): drop the whole line
  out = out.replace(/^[ \t]*\{[^\n}]*<FontLabDevPanel\b[^\n}]*\}[ \t]*\n/gm, "");
  //    b) mount split an inline `…{children}</body>`: drop the expression AND the newline +
  //       indent it inserted before </body>, restoring the original single line
  out = out.replace(/[ \t]*\{[^\n}]*<FontLabDevPanel\b[^\n}]*\}\n[ \t]*(?=<\/body>)/g, "");
  //    c) anything reformatted since mount: the loose match (may leave whitespace; git diff judges)
  out = out.replace(/[ \t]*\{[^\n}]*<FontLabDevPanel\b[^\n}]*\}\n?/g, "");
  // 3) the next/dynamic import we may have added — only if nothing else uses dynamic()
  if (/from\s+["']next\/dynamic["']/.test(out) && !/\bdynamic\s*\(/.test(out)) {
    out = out.replace(/^[ \t]*import\s+dynamic\s+from\s+["']next\/dynamic["'];?[ \t]*\n/m, "");
  }
  return out;
}

// The hard gate on every scaffold-writing verb (init / prepare_preview / more_directions):
// a version-skewed tool must NOT stamp panel code into the project. This is the filmed-demo
// bug at its root — an MCP server frozen at 0.11 stamped a panel into a 0.13 project, the
// scaffold didn't match the package, and Next 500'd with a white page that read as "the dev
// server is down". `status` mentioning drift was too quiet; the break happens HERE, so the
// refusal happens here. allowVersionSkew:true is the deliberate override (mixed checkouts).
function assertNoVersionSkew(dir, { allow = false, verb = "font_lab_init" } = {}) {
  const skew = versionSkew(dir);
  if (!skew) return null;
  if (allow) return skew; // surfaced in the result so the override is never silent
  throw new Error(
    `VERSION SKEW — refusing to stamp panel code: ${skew.message} ` +
      `(A skewed ${verb} is how a broken half-panel ships: the stamped files stop matching the installed package and Next 500s with a white page.) ` +
      `After upgrading + reloading, re-run ${verb}. Pass allowVersionSkew:true ONLY for a deliberately mixed checkout.`,
  );
}

// Set the project up so the human can preview live: self-host the parity bundles, drop in the
// portable dev panel, and mount it (dev-only) in the layout. Idempotent + reversible (uninit).
export async function init(projectDir, { directions, vibe, count, allowFallback = true, fetch = true, tracked, allowVersionSkew = false, log } = {}) {
  const dir = path.resolve(projectDir);
  const skew = assertNoVersionSkew(dir, { allow: allowVersionSkew, verb: "font_lab_init" });
  const analysis = analyzeProject(dir);
  if (!analysis.supported)
    throw new Error(
      analysis.applyMode === "css-entry"
        ? `the live in-app panel is Next-only, but this ${analysis.framework} project still previews AND ships: compose → font_lab_screenshot_directions (screenshots your REAL running site per direction — no panel needed, and it starts the dev server itself when none is running) or font_lab_preview (portable specimen sheet when no dev server can run) → font_lab_select → apply (self-hosted @font-face into ${analysis.capabilities.applyTarget}). Skip init.`
        : `project not supported yet: ${analysis.reasons.join("; ")}`,
    );
  const appDir = resolveAppDir(dir);
  const layout = path.join(appDir, "layout.tsx");

  const backupDir = path.join(ensureFlDir(dir), "init-backup");
  mkdirSync(backupDir, { recursive: true });
  const backupLayout = path.join(backupDir, "layout.tsx");
  if (!existsSync(backupLayout)) copyFileSync(layout, backupLayout); // never clobber the original

  // Build the panel from the agent's brief-driven directions (the tasteful path). Refuse to mount
  // the generic default menu without a brief unless allowFallback is set (see flow.resolveDirectionsMode).
  const mode = resolveDirectionsMode({ directions, allowFallback });
  const dirs = mode === "composed" ? directions : fallbackDirections(dir, analysis, { vibe, count });
  await ensureAdmitted(dir, dirs); // self-host any non-catalog (Google/foundry) faces the agent composed
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis), menuMode: mode };
  const built = await generateCatalog(dir, dirs, meta, { fetch, log, specFor: mergedSpecFor(dir) });

  mkdirSync(path.join(appDir, "_fontlab"), { recursive: true });
  // Stamp the installing tool's version into the panel so it can later notice when it's stale.
  const panelSrc = readFileSync(PANEL_TEMPLATE, "utf8").replace(/__FONTLAB_VERSION__/g, VERSION);
  writeFileSync(path.join(appDir, "_fontlab", "FontLabDevPanel.tsx"), panelSrc);
  writeFileSync(path.join(appDir, "_fontlab", "fl-census.ts"), readFileSync(CENSUS_TEMPLATE, "utf8"));
  const mounted = mountPanel(layout);
  writePreviewSet(dir, dirs);
  writeMenuState(dir, { mode, count: dirs.length });
  // Scaffold hygiene: born self-ignoring (like .font-lab/), so `git status` at commit time shows
  // the product diff, not the dev tooling. tracked:true is the explicit opt-in for teams that
  // want the panel committed and shared — the choice persists across rebuilds.
  if (tracked !== undefined) writeScaffoldPrefs(dir, { tracked: tracked === true });
  const selfIgnored = syncScaffoldIgnores(dir, appDir);

  // Scaffolding is a source write too — logged under its own kind so the commit-time story can
  // keep "Font Lab's dev tooling" separate from the human's copy/font work.
  appendSourceEdit(dir, {
    kind: "scaffold",
    files: [
      ...(mounted ? [path.relative(dir, layout)] : []),
      path.relative(dir, path.join(appDir, "_fontlab", "FontLabDevPanel.tsx")),
      path.relative(dir, path.join(appDir, "_fontlab", "fl-census.ts")),
      ...(built.fonts?.length ? ["public/fontlab/"] : []),
    ],
  });

  // The self-check: NEVER report success on a scaffold that would 500. Every file just stamped
  // must exist and every relative import in app/_fontlab/ must resolve — the exact class that
  // shipped in the field as `Module not found: Can't resolve './fl-census'` → white page.
  const selfCheck = checkScaffold(dir);
  if (!selfCheck.complete) {
    const what = [
      selfCheck.missing.length ? `missing: ${selfCheck.missing.join(", ")}` : null,
      selfCheck.unresolvedImports.length
        ? `unresolved imports: ${selfCheck.unresolvedImports.map((u) => `${u.file} → "${u.specifier}"`).join(", ")}`
        : null,
      !selfCheck.layoutMounted ? "panel not mounted in the layout" : null,
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `init self-check FAILED — the stamped scaffold is incomplete (${what}). Next would 500 (Module not found) and the site would read as a dead server, so init refuses to report success. ` +
        "This usually means a stale or mixed font-lab install: run `npx font-lab upgrade`, then font_lab_init again.",
    );
  }

  // CSP is the OTHER silent panel-killer (page serves, client never hydrates, panel absent) —
  // scan now, at exactly the moment the agent is about to say "open your site".
  const csp = scanCsp(dir);

  return {
    analysis,
    mode,
    provisional: mode === "fallback",
    warning: fallbackNotice(mode),
    directions: dirs.map((d) => ({ id: d.id, name: d.name, vibe: d.vibe })),
    wiring: meta.wiring,
    deadRoles: analysis.coverage?.deadRoles || [],
    otherSubsystems: analysis.coverage?.otherSubsystems || [],
    prepared: built.fonts,
    mounted,
    scaffoldSelfIgnored: selfIgnored,
    layout: path.relative(dir, layout),
    selfCheck: { complete: true, panelDir: selfCheck.panelDir },
    ...(skew ? { versionSkewAllowed: skew } : {}),
    ...(csp.blockers.length || csp.warnings.length ? { csp } : {}),
    nextStep:
      (csp.blockers.length
        ? `FIRST — the project's CSP will kill the live panel in the human's browser (${csp.blockers.map((b) => `${b.directive} missing ${b.missing}`).join("; ")}): apply the dev-only allowances in csp.patch and RESTART the dev server (Next reads headers at startup). Then: `
        : "") +
      (mode === "fallback"
        ? "The panel is up with the STARTER MENU (badged 'not tailored yet' in-panel). Good enough to verify the panel mounts — but it's not tailored to this project. Before the human commits, run intake (font_lab_start) → font_lab_compose_directions → font_lab_prepare_preview so the options fit their brief. Then read_pick → apply."
        : "Start your dev server, then run font_lab_healthcheck({ projectDir }) and DO NOT invite the human until it reports ready:true — it proves the homepage serves (200, not a white 500), the scaffold is complete, versions align, the :7777 endpoint is up, and the CSP is clear. " +
          "Then have the human flip fonts in the panel (bottom-right) and Pick. Want more options? compose additional directions and call font_lab_more_directions. Then read_pick → apply."),
  };
}

// Grow the live panel (#4): admit + APPEND newly-composed directions to the current preview set and
// rebuild, so the human can keep exploring without losing what's already there.
export async function expandPreview(projectDir, { directions, fetch = true, log, menuMode, allowVersionSkew = false } = {}) {
  if (!Array.isArray(directions) || !directions.length)
    throw new Error("expandPreview: provide the new `directions` to add (compose them first with compose_directions)");
  const dir = path.resolve(projectDir);
  assertNoVersionSkew(dir, { allow: allowVersionSkew, verb: "font_lab_more_directions" });
  const analysis = analyzeProject(dir);
  const merged = mergeDirections(readPreviewSet(dir), directions);
  await ensureAdmitted(dir, directions);
  // Appending composed directions makes the menu tailored — carry that through to the panel badge.
  // (menuMode override: the endpoint's curator self-serve appends WITHOUT claiming "tailored".)
  const mode = menuMode || "composed";
  const meta = { target: toTarget(analysis), replaces: analysis.replaces, wiring: wiringFor(analysis), menuMode: mode };
  const result = await generateCatalog(dir, merged, meta, { fetch, log, specFor: mergedSpecFor(dir) });
  writePreviewSet(dir, merged);
  writeMenuState(dir, { mode, count: merged.length });
  syncScaffoldIgnores(dir); // a rebuild must not undo (or miss) the scaffold's self-ignore
  // If this fulfilled a pending in-panel "more options" ask, clear it so the panel stops showing
  // "waiting for your agent" and status reads clean.
  const had = readRequest(dir);
  clearRequest(dir);
  return { added: directions.length, total: merged.length, directions: result.directions, fulfilledRequest: had?.status === "pending" || false };
}

// The endpoint's no-agent fallback for the panel's "Get more" ask: honor the human's mini-brief
// from the deterministic curator so the click ALWAYS yields new options — even with no agent
// alive anywhere. Curator picks aren't LLM-tailored, so the menu badge is preserved (never
// upgraded to "composed" by this path) and the panel narrates honestly. An agent that shows up
// later can still do better — this clears the request, so it composes for the NEXT ask.
export async function selfServeMore(projectDir, request, { count = 4, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const brief = request?.brief || {};
  const feelings = Array.isArray(brief.feeling) ? brief.feeling.filter(Boolean) : brief.feeling ? [brief.feeling] : [];
  const vibe = feelings[0] || undefined;
  // Extra feelings lean the score without forcing it, same as project-derived signals.
  const signals = feelings.slice(1).map((f) => ({ tag: f, weight: 2 }));
  const norm = (s) => normFamily(s || "");
  const excluded = new Set((request?.exclude || []).map(norm));
  for (const d of readPreviewSet(dir)) for (const r of ROLES) excluded.add(norm(d.roles[r].family));

  // Over-ask the curator, then keep directions whose display AND body are genuinely new — the
  // mono role legitimately repeats across directions, so it doesn't disqualify.
  const { seed, hints } = deriveSignals(path.basename(dir), gatherContext(dir));
  const pool = curateDirections(analysis, { vibe, count: 12, seed, signals: [...hints, ...signals] });
  const fresh = pool.filter((d) => !excluded.has(norm(d.roles.display.family)) && !excluded.has(norm(d.roles.body.family))).slice(0, count);
  if (!fresh.length) {
    clearRequest(dir);
    return { added: 0, exhausted: true, hint: "The curator's catalog spread is already on screen — fresh options need an agent to compose beyond it." };
  }
  const currentMode = readMenuState(dir)?.mode || "fallback";
  const result = await expandPreview(dir, { directions: fresh, fetch, log, menuMode: currentMode });
  return { ...result, selfServed: true };
}

export function uninit(projectDir) {
  const dir = path.resolve(projectDir);
  // Tolerate a missing/renamed layout (resolveAppDir throws): the panel dirs still deserve
  // removal — a half-torn-down project must not leave uninit unable to finish the job.
  let appDir = null;
  try {
    appDir = resolveAppDir(dir);
  } catch {}
  const layout = appDir ? path.join(appDir, "layout.tsx") : null;
  // Surgically strip the panel scaffolding — do NOT restore layout.tsx from the init backup,
  // which predates any `apply` and would silently wipe the shipped font change.
  let unmounted = false;
  if (layout && existsSync(layout)) {
    const before = readFileSync(layout, "utf8");
    const after = unmountPanel(before);
    if (after !== before) {
      writeFileSync(layout, after);
      unmounted = true;
    }
  }
  const panelDirs = new Set(
    [appDir ? path.join(appDir, "_fontlab") : null, path.join(dir, "app", "_fontlab"), path.join(dir, "src", "app", "_fontlab")].filter(Boolean),
  );
  const removed = [];
  for (const d of panelDirs) {
    if (!existsSync(d)) continue;
    rmSync(d, { recursive: true, force: true });
    removed.push(path.relative(dir, d));
  }
  if (existsSync(path.join(dir, "public", "fontlab"))) {
    rmSync(path.join(dir, "public", "fontlab"), { recursive: true, force: true });
    removed.push("public/fontlab");
  }
  rmSync(path.join(dir, ".font-lab", "init-backup"), { recursive: true, force: true });
  appendSourceEdit(dir, {
    kind: "unscaffold",
    files: [...(unmounted ? [path.relative(dir, layout)] : []), ...removed.map((r) => r + "/")],
  });
  return {
    layout: layout ? path.relative(dir, layout) : null,
    unmountedPanel: unmounted,
    removed,
    note: "Removed only the dev-panel scaffolding; any applied font change is left intact.",
  };
}

// ── finish: the loop's last step, not an abort ────────────────────────────────
// "The human is done choosing" has a verb now: strip the dev-panel scaffolding (uninit),
// clear the panel's Done signal, optionally remove the install wiring too, and come back
// with the git-verified commit plan. apply → verify → finish is the whole loop; a session
// that skips finish is the one that leaves the repo confusing at commit time.
export async function finish(projectDir, { uninstall = false, keepScaffold = false } = {}) {
  const dir = path.resolve(projectDir);
  const wasDone = readDoneRequest(dir);
  let scaffold = null;
  if (!keepScaffold && scaffoldMounted(dir)) scaffold = uninit(dir);
  clearDoneRequest(dir);
  let uninstalled = null;
  if (uninstall) {
    const { uninstallAll } = await import("./install.mjs");
    uninstalled = uninstallAll(dir);
  }
  const commitPlan = buildCommitPlan(dir);
  return {
    finished: true,
    fulfilledDoneRequest: !!wasDone,
    scaffold: scaffold ?? { removed: [], note: keepScaffold ? "kept — keepScaffold was set" : "none was mounted" },
    uninstalled,
    commitPlan,
    note:
      "Relay commitPlan.commands to the human — the ship pile is their work. Never run git commit/push yourself unless they explicitly ask" +
      (uninstall
        ? ". Runtime state stays in .font-lab/ (self-ignored; backups live there) — the human can delete the dir whenever."
        : ". Install wiring (MCP, skill/AGENTS block) was kept for next time — finish with uninstall:true removes it."),
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
  // Resolve the id against the SAME set the human was shown: explicit → the persisted composed
  // set → the deterministic starter. Before the composed set persisted on every stack, a
  // non-Next pick-by-id could only match the starter menu — the composed ids didn't exist here.
  const dirs = resolveCaptureSet(dir, analysis, { directions, vibe, count }).directions;
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
  const flDir = ensureFlDir(dir);
  writeFileSync(path.join(flDir, "selection.json"), JSON.stringify(selection, null, 2) + "\n");
  // Never block the human's pick — but hand back an honest heads-up if it reads generic, so the
  // agent can relay it. The selection.json contract on disk stays clean (warnings aren't shipped).
  return { ...selection, warnings: pickWarnings(roles) };
}

// Ready-to-run commands to launch the FULL live editor (flip / mix / compare in a real browser),
// for when the screenshots aren't enough. Detects the project's dev command + package manager.
// In a remote/container session the framing flips: these are commands for the HUMAN'S OWN
// machine (after pulling the branch) — never a URL handoff to a localhost the human can't reach.
export function liveInstructions(projectDir, { remote } = {}) {
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
  const environment = detectEnvironment({ remote });
  const note =
    environment.remote && !environment.portForwarded
      ? "IMPORTANT — this session runs in a remote container the human's browser cannot reach: localhost URLs here are for YOUR headless browser only. These commands are for the human to run ON THEIR OWN MACHINE after pulling this branch, if they want the full live flip/mix/edit experience. In this session, keep driving the pick from screenshots — do not promise the human a localhost URL."
      : environment.remote
        ? "This workspace forwards ports (Codespaces/Gitpod-style): the live panel can work through the FORWARDED URL for these ports — hand the human the forwarded link your platform shows, not a raw localhost one."
        : "Run these in a local terminal — your Mac/Linux terminal, or the integrated terminal in VS Code / Cursor / the Claude Code IDE extension — to flip, mix, and compare the directions live on your real site.";
  return {
    note,
    environment: { kind: environment.kind, remote: environment.remote },
    who: environment.remote
      ? "CLOUD / CONTAINER AGENT (this session): you can run every headless step yourself — install, compose, font_lab_screenshot_directions (it starts the dev server itself), select, apply, verify. What you canNOT do is host the live panel for the human: the two long-running processes below only make sense on a machine whose localhost the human can open."
      : "AGENT WITH A LOCAL TERMINAL (Cursor, Claude Code, Windsurf, …): run the dev server and the :7777 endpoint YOURSELF as background tasks and leave them running (skip whichever is already up) — do NOT run them in the foreground, they never exit and your turn will hang. Then tell the human to open the site and pick.",
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
function discoverChromium(projectDir) {
  const roots = [];
  const pbp = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pbp && pbp !== "0") roots.push(pbp);
  // PLAYWRIGHT_BROWSERS_PATH=0 (or a project that set it at install time) keeps browsers inside
  // the driver package itself — check the PROJECT's install too, so a browser the user installed
  // into their repo is found no matter which process (MCP server, one-shot CLI) is asking.
  if (projectDir) {
    for (const pkg of ["playwright-core", "playwright"])
      roots.push(path.join(path.resolve(projectDir), "node_modules", pkg, ".local-browsers"));
  }
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
// Load Playwright's `chromium` driver, tolerating every way it can be present — CRUCIALLY
// including the USER'S PROJECT. A bare `import("playwright")` resolves relative to THIS package's
// own install (the npx cache when the MCP server was registered as `npx font-lab mcp`), which is
// how the dogfood hit "CLI works after `npm i -D playwright`, the MCP server still says it's
// missing": the two processes were resolving from different roots. So: resolve from the project's
// node_modules FIRST (createRequire re-checks the disk on every call — a driver installed
// mid-session is picked up by the running MCP server, no restart), then fall back to our own
// dependencies (`playwright-core` ships as an optional dep so `npx font-lab` works out of the
// box). A full `playwright` is preferred over `-core` at each root (it may carry its own
// browser). Throws ONE actionable error only when nothing resolves anywhere — a real load error
// inside an installed driver is re-thrown as-is.
async function loadChromium(projectDir) {
  if (projectDir) {
    let requireFromProject = null;
    try {
      requireFromProject = createRequire(path.join(path.resolve(projectDir), "package.json"));
    } catch {}
    for (const mod of ["playwright", "playwright-core"]) {
      let resolved = null;
      try {
        resolved = requireFromProject?.resolve(mod);
      } catch {} // not installed in the project — try the next root
      if (!resolved) continue;
      const m = await import(pathToFileURL(resolved).href); // load errors inside a REAL install re-throw as-is
      const chromium = m.chromium ?? m.default?.chromium;
      if (chromium) return chromium;
    }
  }
  for (const mod of ["playwright", "playwright-core"]) {
    try {
      return (await import(mod)).chromium;
    } catch (e) {
      if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    }
  }
  throw new Error(
    "Screenshots need a Playwright driver. Install one IN THE PROJECT — `npm i -D playwright-core` " +
      "(light; drives your system Chrome) or `npm i -D playwright` (can bundle its own browser) — then " +
      "RETRY THIS SAME TOOL: the project's install is picked up immediately, from the MCP server and the " +
      "CLI alike, no session restart. If no system Chrome/Edge exists either, also run `npx playwright " +
      "install chromium`. Only if no browser can exist here, fall back to the live editor (liveInstructions()).",
  );
}

async function launchBrowser(chromium, { executablePath, projectDir } = {}) {
  const explicit = executablePath || process.env.FONT_LAB_CHROMIUM || process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const discovered = discoverChromium(projectDir);
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

// The per-direction paint plan: which census voice gets which family's stack. Pure + exported
// for tests — this bridge is what keeps panel-free capture identical to the panel's own flips
// (same role→voice map, same parity stacks), so the images stay faithful to what ships.
const PAINT_VOICE = { display: "heading", body: "body", mono: "label" };
export function paintPlanFor(direction, stacks) {
  return ROLES.map((role) => {
    const fam = direction.roles?.[role]?.family ?? direction[role] ?? null;
    return { role, voice: PAINT_VOICE[role], family: fam, stack: fam ? stacks[fam] || null : null };
  });
}

// One capture = TWO artifacts per direction: the full-page PNG (detail / archives) and a
// viewport-sized JPEG "hero shot" (~10× smaller) that actually fits a chat thread or a phone —
// the surface where remote humans make the pick. scale:'css' keeps the JPEG at CSS pixels
// instead of the 2× device raster.
async function shoot(page, out, id, fullPage) {
  const screenshot = path.join(out, `${id}.png`);
  await page.screenshot({ path: screenshot, fullPage });
  const heroShot = path.join(out, `${id}.hero.jpg`);
  await page.screenshot({ path: heroShot, type: "jpeg", quality: 80, scale: "css" });
  return { screenshot, heroShot };
}

// Headless capture WITHOUT the panel — the real-site preview for every non-Next framework.
// Injects the parity @font-face (base64-inlined; zero project writes, no dev-server asset
// dependency), then paints the RENDERED page per direction through the census — the exact
// machinery the Next panel flips with — and screenshots it. Requires only the dev server.
async function capturePainted(dir, analysis, dirs, { base, route, out, viewport, fullPage, executablePath, fetch = true, log } = {}) {
  await ensureAdmitted(dir, dirs);
  const families = [...new Set(dirs.flatMap((d) => ROLES.map((r) => d.roles?.[r]?.family ?? d[r]).filter(Boolean)))];
  const inline = fetch !== false; // offline builds can't inline bytes — fall back to /fontlab URLs
  // cacheDir: the bytes are inlined into the injected CSS, so previewing writes NOTHING to the
  // repo — public/<staticDir>/fontlab stays reserved for fonts that actually ship.
  const { faceCss, stacks } = await buildParityBundles(dir, families, { fetch, inline, staticDir: analysis.staticDir, cacheDir: fontCacheDir(dir), specFor: mergedSpecFor(dir), log });
  const censusSrc = readFileSync(CENSUS_TEMPLATE, "utf8");
  const chromium = await loadChromium(dir);
  const { browser, via } = await launchBrowser(chromium, { executablePath, projectDir: dir });
  try {
    // bypassCSP: a strict dev CSP must not block the injected faces or the census (verifyShip's
    // finding) — the paint is measurement-grade, not a page mutation the site should police.
    const ctx = await browser.newContext({ bypassCSP: true, viewport: viewport || { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(base + route, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(async () => { await document.fonts.ready; }).catch(() => {});
    await page.waitForTimeout(400); // hydration settle (same rationale as verifyShip)
    await page.addStyleTag({ content: faceCss.join("\n") });
    await page.addScriptTag({ content: censusSrc });
    // Load-verify every parity face up front via fonts.load (which actually fetches, unlike the
    // fonts.check false-positive trap) — an unloadable face is REPORTED, never screenshotted as
    // if it were the real thing.
    const flFaces = Object.values(stacks).map((s) => (String(s).match(/'([^']+)'/) || [])[1]).filter(Boolean);
    const facesLoaded = await page.evaluate(async (names) => {
      const outMap = {};
      for (const n of names) {
        try { outMap[n] = (await document.fonts.load(`16px "${n}"`)).length > 0; } catch { outMap[n] = false; }
      }
      return outMap;
    }, flFaces);
    await page.evaluate(() => { window.__flCensus.census(); });

    const shots = [];
    shots.push({ id: "current", name: "Current (before)", vibe: "—", rationale: "the site as it is today", ...(await shoot(page, out, "current", fullPage)) });

    for (const d of dirs) {
      const plan = paintPlanFor(d, stacks);
      await page.evaluate((entries) => {
        for (const e of entries) window.__flCensus.paintVoice(e.voice, e.stack);
      }, plan);
      await page.evaluate(async () => { await document.fonts.ready; }).catch(() => {});
      await page.waitForTimeout(350);
      const files = await shoot(page, out, d.id, fullPage);
      await page.evaluate(() => window.__flCensus.clearPaint());
      shots.push({
        id: d.id,
        name: d.name,
        vibe: d.vibe,
        rationale: d.rationale,
        fonts: Object.fromEntries(plan.map((e) => [e.role, e.family])),
        ...files,
      });
    }
    return {
      baseUrl: base,
      route,
      outDir: out,
      browser: via,
      mode: "painted",
      note: "No panel needed on this stack: the REAL rendered page was painted per direction through the census (the same machinery the Next panel flips with), with the parity @font-face injected inline — faithful to what ships, zero project writes.",
      shotsNote: "Each direction has TWO images: `heroShot` (viewport JPEG, chat/phone-sized — show THESE to the human) and `screenshot` (full-page PNG, for detail on request).",
      facesLoaded,
      shots,
      live: liveInstructions(dir),
    };
  } finally {
    await browser.close();
  }
}

// Headless capture: screenshot the REAL running site in each direction — the images the human
// picks from, faithful to what ships. On Next with the panel init'd it drives the panel; on any
// other framework it paints the rendered page directly (capturePainted). Makes no project edits.
// Returns a manifest the agent shows.
//
// The dev server is REACHABLE-OR-STARTED: pass a live baseUrl and it's used; otherwise (nothing
// passed, nothing recorded, or the recorded one is dead) Font Lab starts the project's own dev
// command itself — bound to 127.0.0.1, health-checked, torn down after the capture — because on
// cloud harnesses "just background the dev server" is the single biggest time sink (sandboxed
// shells reap it; IPv6 default hosts refuse to bind). ensureServer:false forbids the spawn.
export async function captureDirections(projectDir, { baseUrl, routes = ["/"], outDir, directions, viewport, fullPage = true, executablePath, fetch = true, ensureServer, allowFallback = true, log = () => {} } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const resolved = resolveCaptureSet(dir, analysis, { directions, allowFallback });
  const dirs = resolved.directions;
  const out = outDir ? path.resolve(outDir) : path.join(ensureFlDir(dir), "previews");
  mkdirSync(out, { recursive: true });

  // What the human SAW is what a later select must resolve against — so explicit, compose-shaped
  // directions persist as the project's menu too (an inline pass could otherwise vanish: composed
  // without persistence on another transport, captured here, then font_lab_select finds no set).
  // Raw un-normalized shapes are left alone — compose is the normalizer, and persisting a
  // roles-less direction would break select.
  if (resolved.source === "explicit" && dirs.every((d) => d.id && ROLES.every((r) => d.roles?.[r]?.family))) {
    writePreviewSet(dir, dirs);
    writeMenuState(dir, { mode: "composed", count: dirs.length });
  }

  let managed = null;
  let serverNote = null;
  if (!baseUrl) baseUrl = readDevServer(dir)?.origin;
  if (!(baseUrl && (await probeHttp(baseUrl)))) {
    if (ensureServer === false)
      throw new Error(
        `captureDirections: ${baseUrl ? `the dev server at ${baseUrl} isn't responding` : "no dev server is running (none passed, none recorded)"} and ensureServer:false forbids starting one. ` +
          "Start it yourself — bind 127.0.0.1 (an IPv6 `::` host dies with EAFNOSUPPORT on IPv4-only containers) and use a harness-managed background task (a plain `&` won't survive sandboxed shells) — then pass baseUrl.",
      );
    try {
      managed = await startManagedServer(dir, { framework: analysis.framework, log });
    } catch (e) {
      // A dev server that genuinely can't serve is an INFRASTRUCTURE failure of the real-site
      // path — record it so the specimen-sheet fallback unlocks (see specimenGate). The
      // ensureServer:false refusal above deliberately doesn't: the agent forbade the fix itself.
      writeCaptureBlocked(dir, { stage: "dev-server", error: e.message });
      throw e;
    }
    serverNote = `${baseUrl ? `the dev server at ${baseUrl} wasn't responding` : "no dev server was running"} — started \`${managed.command}\` (managed: bound to 127.0.0.1, stopped after the capture)`;
    baseUrl = managed.origin;
  }

  const base = baseUrl.replace(/\/+$/, "");
  const route = routes[0] || "/";
  const annotate = (result) => ({
    ...result,
    directionsSource: resolved.source, // explicit | preview-set | fallback — never a silent starter
    ...(resolved.source === "fallback" ? { menuWarning: fallbackNotice("fallback") } : {}),
    ...(managed ? { managedServer: { command: managed.command, origin: managed.origin, stopped: true } } : {}),
    ...(serverNote ? { serverNote } : {}),
  });

  // A capture that WORKED (re-)locks the specimen-sheet fallback; one that failed on
  // infrastructure records why, which is the only thing that unlocks it (see specimenGate).
  const succeed = (result) => {
    clearCaptureBlocked(dir);
    return result;
  };

  try {
    // No live panel on this stack? Paint the real page headlessly — same images, no init needed.
    if (!analysis.capabilities.livePanel)
      return succeed(annotate(await capturePainted(dir, analysis, dirs, { base, route, out, viewport, fullPage, executablePath, fetch, log })));

    const chromium = await loadChromium(dir);
    const { browser, via } = await launchBrowser(chromium, { executablePath, projectDir: dir });
    try {
      const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 }, deviceScaleFactor: 2 });
      // Wait for `load`, not `networkidle`: a persistent third-party live script (e.g. a design
      // skill's live mode, HMR sockets) keeps the network busy so `networkidle` never fires and times
      // out. We gate readiness on the panel mounting + fonts being ready instead, which is what we
      // actually need for a faithful shot.
      await page.goto(base + route, { waitUntil: "load", timeout: 30000 });
      await page.waitForSelector("#fontlab-panel-host", { timeout: 20000 }).catch(() => {
        throw new Error(`no Font Lab panel at ${base + route} — run font_lab_init (then reload the page) first; the panel mounts dev-only`);
      });
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
      const curFiles = await shoot(page, out, "current", fullPage);
      await setPanel("visible");
      shots.push({ id: "current", name: "Current (before)", vibe: "—", rationale: "the site as it is today", ...curFiles });

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
        const files = await shoot(page, out, d.id, fullPage);
        await setPanel("visible");
        shots.push({
          id: d.id,
          name: d.name,
          vibe: d.vibe,
          rationale: d.rationale,
          fonts: { display: d.roles.display.family, body: d.roles.body.family, mono: d.roles.mono.family },
          ...files,
        });
      }
      return succeed(annotate({
        baseUrl: base,
        route,
        outDir: out,
        browser: via,
        mode: "panel",
        shotsNote: "Each direction has TWO images: `heroShot` (viewport JPEG, chat/phone-sized — show THESE to the human) and `screenshot` (full-page PNG, for detail on request).",
        shots,
        live: liveInstructions(dir),
      }));
    } finally {
      await browser.close();
    }
  } catch (e) {
    // Record WHY the real-site capture failed — the record is what unlocks the specimen-sheet
    // fallback. Errors whose fix is a different Font Lab step (the Next panel isn't init'd)
    // stay unrecorded: the sheet isn't the answer to those.
    const msg = String(e?.message || e);
    if (!/no Font Lab panel/.test(msg)) {
      const stage = /Playwright driver/i.test(msg)
        ? "playwright-driver"
        : /launch a Chromium/i.test(msg)
          ? "browser-launch"
          : "capture";
      writeCaptureBlocked(dir, { stage, error: msg });
    }
    throw e;
  } finally {
    if (managed) await managed.stop();
  }
}

// ── the ship receipt (v2.2): measure convergence on rendered pixels, not on files written ────
// After apply (and/or rewire, and/or the agent's own edits), re-render the running site and
// census it: what fraction of each voice's text ACTUALLY renders the picked family now? The
// honesty invariant lives here — "by verification" instead of "by construction". Whatever did
// not converge comes back as a named, provenance-carrying work order for the coding agent, so
// partial convergence is a first-class state with a next step, never a silent no-op.
//
// Requires the project's dev server running (like captureDirections). Makes no edits.
const RECEIPT_VOICE = { display: "heading", body: "body", mono: "label" };

export async function verifyShip(projectDir, { baseUrl, routes = ["/"], targets, executablePath, ensureServer, log = () => {} } = {}) {
  const dir = path.resolve(projectDir);
  const sel = readSelection(dir);
  const tg = targets || {
    display: sel?.roles?.display?.family || null,
    body: sel?.roles?.body?.family || null,
    mono: sel?.roles?.mono?.family || null,
  };
  if (!Object.values(tg).some(Boolean))
    throw new Error("verifyShip: nothing to verify — no selection.json (pick first) and no explicit targets {display,body,mono}");

  // The panel reports its origin to the endpoint on every connect — use it so the receipt
  // doesn't demand a URL the system already knows. And like captureDirections, the server is
  // reachable-or-started: a receipt right after apply shouldn't fail because the dev server
  // died between the screenshots and the ship.
  let managed = null;
  if (!baseUrl) baseUrl = readDevServer(dir)?.origin;
  if (!(baseUrl && (await probeHttp(baseUrl)))) {
    if (ensureServer === false)
      throw new Error(
        `verifyShip: ${baseUrl ? `the dev server at ${baseUrl} isn't responding` : "no dev server is running (none passed, none recorded)"} and ensureServer:false forbids starting one — start it yourself (bind 127.0.0.1, harness-managed background task) and pass baseUrl.`,
      );
    managed = await startManagedServer(dir, { framework: analyzeProject(dir).framework, log });
    baseUrl = managed.origin;
  }

  const chromium = await loadChromium(dir);
  const censusSrc = readFileSync(CENSUS_TEMPLATE, "utf8");
  const base = baseUrl.replace(/\/+$/, "");
  const routesOut = [];
  let via = null;
  try {
    const { browser, via: browserVia } = await launchBrowser(chromium, { executablePath, projectDir: dir });
    via = browserVia;
    try {
      // bypassCSP: a strict dev CSP (connect-src 'self', upgrade-insecure-requests) must not be
      // able to block the measurement script. (The same CSP is a product hazard for the live
      // panel — see spike/cluster-paint/RESULTS.md finding 1.)
      const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 900 } });
      for (const route of routes.length ? routes : ["/"]) {
        const page = await ctx.newPage();
        await page.goto(base + route, { waitUntil: "load", timeout: 30000 });
        await page.evaluate(async () => { await document.fonts.ready; }).catch(() => {});
        await page.waitForTimeout(400); // hydration settle
        await page.addScriptTag({ content: censusSrc }); // no-ops if the panel already loaded it
        const measured = await page.evaluate((args) => {
          const fc = window.__flCensus;
          fc.clearPaint(); // ship truth: never measure through a preview paint
          const clusters = fc.recensus();
          const voices = {};
          const residue = [];
          for (const role of Object.keys(args.targets)) {
            const fam = args.targets[role];
            if (!fam) continue;
            voices[role] = fc.voiceCoverage(args.voice[role], fam);
            for (const c of fc.residueFor(args.voice[role], fam)) residue.push({ role, target: fam, ...c });
          }
          return { clusters, voices, residue };
        }, { targets: tg, voice: RECEIPT_VOICE });
        routesOut.push({ route, ...measured });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (managed) await managed.stop();
  }

  const residue = routesOut.flatMap((r) => r.residue.map((c) => ({ route: r.route, ...c })));
  const converged = residue.length === 0;
  const receipt = {
    at: new Date().toISOString(),
    baseUrl: base,
    targets: tg,
    converged,
    routes: routesOut.map((r) => ({ route: r.route, voices: r.voices, clusters: r.clusters })),
    residue,
    browser: via,
  };
  const receiptPath = path.join(ensureFlDir(dir), "receipt.json");
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  const workOrder = converged ? null : buildWorkOrder(dir, sel, receipt);
  return {
    converged,
    receipt,
    receiptPath: path.relative(dir, receiptPath),
    workOrder,
    ...(managed ? { managedServer: { command: managed.command, origin: managed.origin, stopped: true } } : {}),
    nextStep: converged
      ? "Converged — every measured voice renders the pick on these routes. Tell the human, then font_lab_status → sourceChanges for what to commit."
      : "Not fully converged. The workOrder names every unreached spot with provenance — execute it (ask the human first about intentional brand islands), then re-run font_lab_verify until converged.",
  };
}

// The residue, written as a paste-ready instruction for the coding agent — Font Lab is
// agent-native, so "here is exactly what still renders the old font, and where it comes from"
// turns partial convergence into a work order instead of a dead end. Mirrors the copy-edit
// agentHandoff pattern (font-lab.mjs).
function buildWorkOrder(dir, sel, receipt) {
  const project = path.basename(dir);
  let deadRoles = [];
  try {
    deadRoles = analyzeProject(dir).coverage?.deadRoles || [];
  } catch {}
  const lines = [
    `In the ${project} project, Font Lab shipped the font pick "${sel?.direction?.name ?? "(targets passed directly)"}" and then re-rendered the site to verify. ${receipt.residue.length} spot(s) still render the OLD fonts. Finish the ship:`,
  ];
  for (const r of receipt.residue) {
    const isInline = r.prov.startsWith("inline");
    const routeM = r.prov.match(/route:([a-z0-9-]+)/i);
    // Server-component fibers carry no debug stack (spike finding), so chunk-derived provenance
    // often reads "global" on RSC pages — the receipt's ROUTE is the reliable locator there.
    const whereHint = routeM
      ? `app/${routeM[1]}/`
      : r.route && r.route !== "/"
        ? `app${r.route}/ (this route's page + components)`
        : "the global layout/CSS";
    lines.push(
      "",
      `- on ${r.route} — ${r.label}: ${r.unconverged} of ${r.elements} element(s) still render "${r.family}"; target ${r.target} (${r.role} role).`,
      `    sample text: ${JSON.stringify(r.sample)}`,
      `    provenance: ${isInline ? "inline-style / route-scoped font declarations" : "stylesheet-driven"} — look under ${whereHint}.`,
    );
    if (isInline)
      lines.push(
        `    This looks like a per-route font island. ASK THE HUMAN first: adopt ${r.target} here too, or keep this page's own fonts on purpose? Only edit if they want it adopted.`,
      );
  }
  if (deadRoles.length)
    lines.push(
      "",
      `Note: the analyzer flags dead role variable chain(s): ${deadRoles.join(", ")}. Run font_lab_rewire_dead_roles FIRST (reversible) — it usually closes the global gap without hand edits.`,
    );
  lines.push("", "After editing, re-run font_lab_verify with the same routes and confirm converged: true before telling the human the ship is done.");
  return lines.join("\n");
}
