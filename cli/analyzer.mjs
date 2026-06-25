// Font Lab analyzer (M3) — a static, read-only audit of a target Next.js project.
//
// Detects the four things codegen and the preview both need to stop guessing:
//   • framework + App vs Pages Router
//   • Tailwind v3 vs v4
//   • the current fonts, per role (display / body / mono)
//   • how those fonts are wired (CSS variables vs hardcoded)
//
// Pure functions, no writes. ts-morph parses the declaration file (the same engine codegen
// edits with, so the two agree on what a font const is); the CSS entry is read as text and
// its custom-property graph resolved so a role var like `--font-display` can be traced —
// through any number of indirections — back to the next/font const that ultimately feeds it.
// That chain is what lets the analyzer name "Bricolage Grotesque" on a real site that maps
// `--font-display: var(--font-bricolage)`, and "Inter" on our fixture that hops
// `--font-sans → --fl-sans → --font-inter`.
//
// Output feeds two consumers: codegen's branch selection (target) and the panel's
// before/after toggle (replaces — the real "current" the preview compares against).

import { Project, Node, SyntaxKind } from "ts-morph";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROLE_VARS = { display: "--font-display", body: "--font-sans", mono: "--font-mono" };
const ROLES = ["display", "body", "mono"];

// next/font import specifier (e.g. `Bricolage_Grotesque`) -> display family name. This is
// the inverse of codegen's family->importName, so a round-trip is lossless for the families
// Google actually ships.
const familyFromImport = (name) => name.replace(/_/g, " ");

const rel = (projectDir, p) => (p ? path.relative(projectDir, p) : null);

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ---- locate the moving parts -----------------------------------------------

function locate(projectDir) {
  const exists = (p) => existsSync(p) && p;
  const firstFile = (...cands) => cands.map((c) => path.join(projectDir, c)).find(existsSync) || null;

  // App Router declares fonts in app/layout.{tsx,jsx}; Pages Router in pages/_app.{tsx,jsx}.
  const appLayout = firstFile("app/layout.tsx", "app/layout.jsx", "src/app/layout.tsx", "src/app/layout.jsx");
  const pagesApp = firstFile("pages/_app.tsx", "pages/_app.jsx", "src/pages/_app.tsx", "src/pages/_app.jsx");

  const router = appLayout ? "app" : pagesApp ? "pages" : "unknown";
  const declarationFile = appLayout || pagesApp || null;

  // CSS entry — the file carrying `@import "tailwindcss"` / `@tailwind` directives.
  const css = firstFile(
    "app/globals.css",
    "app/global.css",
    "src/app/globals.css",
    "styles/globals.css",
    "src/styles/globals.css",
  );

  const twConfig = firstFile(
    "tailwind.config.ts",
    "tailwind.config.js",
    "tailwind.config.mjs",
    "tailwind.config.cjs",
  );

  return { declarationFile, router, css, twConfig };
}

// ---- package.json: framework + tailwind version hints ----------------------

const majorOf = (range) => {
  const m = String(range || "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

function readDeps(projectDir) {
  const pkg = readJson(path.join(projectDir, "package.json")) || {};
  return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
}

// ---- the declaration file: next/font consts + which element wears them ------

function parseDeclaration(declPath) {
  const result = { nextFonts: [], localFonts: [], classNameTarget: null, importModules: [] };
  if (!declPath) return result;

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  const sf = project.addSourceFileAtPath(declPath);

  // Which next/font specifiers are imported (google vs local matters for the ship path).
  const googleNames = new Set();
  const localNames = new Set();
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (mod === "next/font/google" || mod === "next/font/local") {
      result.importModules.push(mod);
      const target = mod === "next/font/local" ? localNames : googleNames;
      for (const n of imp.getNamedImports()) target.add(n.getName());
      const def = imp.getDefaultImport();
      if (def) target.add(def.getText());
    }
  }

  // Font consts: `const x = Family({ variable: "--font-x", ... })`.
  const constByName = new Map();
  for (const vd of sf.getVariableDeclarations()) {
    const init = vd.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression().getText();
    const isGoogle = googleNames.has(callee);
    const isLocal = localNames.has(callee);
    if (!isGoogle && !isLocal) continue;

    const obj = init.getArguments()[0];
    let variable = null;
    if (obj && Node.isObjectLiteralExpression(obj)) {
      const p = obj.getProperty("variable");
      if (p && Node.isPropertyAssignment(p)) {
        const v = p.getInitializer();
        if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v))) variable = v.getLiteralValue();
      }
    }
    const entry = {
      constName: vd.getName(),
      importName: callee,
      family: isGoogle ? familyFromImport(callee) : callee,
      variable,
      source: isGoogle ? "google" : "local",
    };
    constByName.set(vd.getName(), entry);
    (isLocal ? result.localFonts : result.nextFonts).push(entry);
  }

  // Which element (html/body) carries the font consts' `.variable` classes.
  const allConsts = [...result.nextFonts, ...result.localFonts];
  let best = { tag: null, hits: 0 };
  for (const kind of [SyntaxKind.JsxOpeningElement, SyntaxKind.JsxSelfClosingElement]) {
    for (const el of sf.getDescendantsOfKind(kind)) {
      const tag = el.getTagNameNode().getText();
      if (tag !== "html" && tag !== "body") continue;
      const attr = el.getAttribute?.("className");
      const text = attr ? attr.getText() : "";
      const hits = allConsts.filter((c) => text.includes(`${c.constName}.variable`)).length;
      if (hits > best.hits) best = { tag, hits };
    }
  }
  result.classNameTarget = best.tag;
  return result;
}

// ---- CSS: tailwind version + the custom-property graph ----------------------

// Collect every `--name: value;` declaration in the file (across :root, @theme, @theme
// inline). Last write wins, which roughly matches the cascade for our purposes.
function collectCssVars(css) {
  const vars = new Map();
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)\s*;/g;
  let m;
  while ((m = re.exec(css))) vars.set(m[1], m[2].trim());
  return vars;
}

// Follow `var(--x)` references from a role var until we land on one of the next/font
// variables (resolved) or run out of indirection (unresolved). Cycle-guarded.
function resolveToFontVar(startVar, cssVars, fontVarSet) {
  const seen = new Set();
  let cur = startVar;
  while (cur && !seen.has(cur)) {
    if (fontVarSet.has(cur)) return cur;
    seen.add(cur);
    const val = cssVars.get(cur);
    if (!val) return null;
    const next = val.match(/var\(\s*(--[A-Za-z0-9-]+)/);
    if (!next) return null;
    cur = next[1];
  }
  return null;
}

function detectTailwind(css, deps, twConfig) {
  const cssV4 = /@import\s+["']tailwindcss["']/.test(css);
  const cssV3 = /@tailwind\s+(base|components|utilities)/.test(css);
  const pkgMajor = majorOf(deps.tailwindcss);
  const hasV4Postcss = !!(deps["@tailwindcss/postcss"] || deps["@tailwindcss/vite"]);

  let version = null;
  if (cssV4 && (pkgMajor === 4 || hasV4Postcss || pkgMajor === null)) version = 4;
  else if (cssV3 && (pkgMajor === 3 || twConfig)) version = 3;
  else if (pkgMajor) version = pkgMajor;
  else if (cssV4) version = 4;
  else if (cssV3) version = 3;

  return { version, signals: { cssV4, cssV3, pkgMajor, hasV4Postcss, hasConfig: !!twConfig } };
}

// ---- coverage diagnostics (will a swap actually be visible? at scale) -------
//
// Two ways a swap silently does nothing on a real site, both of which we'd rather REPORT
// than be surprised by:
//
//  1. Dead role — a role var is declared in `@theme inline { … }`, but the site consumes it
//     via a *raw* `var(--font-display)` somewhere (e.g. `@layer base { h1 { font-family:
//     var(--font-display) } }`). Under `@theme inline`, Tailwind v4 does NOT publish the
//     theme var as a `:root` custom property — only the generated `font-*` utilities deref
//     it. So that raw reference resolves to nothing and the element silently inherits its
//     parent's font. Swapping that role is invisible until it's rewired through the utility.
//     (This is exactly what jack-mcgovern.com does with its headings.)
//
//  2. Other subsystems — fonts declared with their own next/font + variables in a different
//     route/component (jack's `/gus` uses `--font-fraunces`/`--font-dm-sans` via inline
//     styles). A global swap of the layout fonts won't reach them; the agent/user should
//     know the swap's true scope (full per-route flipping is M6).

const THEME_BLOCK_RE = /@theme(\s+inline)?\s*\{([^}]*)\}/g;
const reVar = (v) => new RegExp(`var\\(\\s*${v}\\s*\\)`);

function deadRoles(css) {
  // role vars declared inside an `@theme inline` block
  const inlineVars = new Set();
  let m;
  THEME_BLOCK_RE.lastIndex = 0;
  while ((m = THEME_BLOCK_RE.exec(css))) {
    if (!m[1]) continue; // plain @theme (not inline) DOES publish the var — not dead
    for (const v of Object.values(ROLE_VARS)) if (new RegExp(`${v}\\s*:`).test(m[2])) inlineVars.add(v);
  }
  const cssNoTheme = css.replace(THEME_BLOCK_RE, "");
  const dead = [];
  for (const role of ROLES) {
    const rv = ROLE_VARS[role];
    if (inlineVars.has(rv) && reVar(rv).test(cssNoTheme)) dead.push(role);
  }
  return dead;
}

function walkSourceFiles(dir, acc, depth = 0) {
  if (depth > 6) return acc;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkSourceFiles(full, acc, depth + 1);
    else if (/\.(tsx|ts|jsx|js)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

function otherFontSubsystems(projectDir, declarationFile) {
  const declAbs = declarationFile ? path.join(projectDir, declarationFile) : null;
  const roots = ["app", "src/app", "components", "src/components"].map((d) => path.join(projectDir, d));
  const files = [];
  for (const r of roots) walkSourceFiles(r, files);
  const out = [];
  for (const f of [...new Set(files)]) {
    if (f === declAbs) continue;
    let text = "";
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (!/from\s+["']next\/font\/(google|local)["']/.test(text)) continue;
    const families = [...new Set([...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']next\/font\/(?:google|local)["']/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean)))];
    const variables = [...new Set([...text.matchAll(/variable\s*:\s*["'](--[A-Za-z0-9-]+)["']/g)].map((m) => m[1]))];
    out.push({ file: path.relative(projectDir, f), families, variables });
  }
  return out;
}

// ---- the public surface -----------------------------------------------------

export function analyzeProject(projectDir) {
  projectDir = path.resolve(projectDir);
  const deps = readDeps(projectDir);
  const { declarationFile, router, css: cssPath, twConfig } = locate(projectDir);

  const framework = deps.next ? "next" : "unknown";
  const styling = deps.tailwindcss ? "tailwind" : "unknown";

  const decl = parseDeclaration(declarationFile);
  const css = cssPath ? readFileSync(cssPath, "utf8") : "";
  const cssVars = collectCssVars(css);
  const tw = detectTailwind(css, deps, twConfig);

  const fontByVar = new Map();
  for (const f of [...decl.nextFonts, ...decl.localFonts]) if (f.variable) fontByVar.set(f.variable, f);
  const fontVarSet = new Set(fontByVar.keys());

  // Resolve each role's font by tracing the role var through the CSS graph.
  const roles = {};
  let resolvedAny = false;
  for (const role of ROLES) {
    const hit = resolveToFontVar(ROLE_VARS[role], cssVars, fontVarSet);
    const font = hit ? fontByVar.get(hit) : null;
    if (font) {
      resolvedAny = true;
      roles[role] = {
        family: font.family,
        source: font.source,
        constName: font.constName,
        importName: font.importName,
        nextFontVar: font.variable,
        roleVar: ROLE_VARS[role],
      };
    } else {
      roles[role] = null;
    }
  }

  // Wiring: role vars resolving to next/font consts is the high-fidelity, swap-friendly
  // path. next/font present but unreachable through vars (or literal font-family) is the
  // lower-fidelity hardcoded path. Nothing at all is "none".
  const hasNextFont = decl.nextFonts.length + decl.localFonts.length > 0;
  const hardcodedFamily = /font-family\s*:\s*(['"][A-Za-z][^;}]*|[A-Za-z][\w -]*,)/.test(
    css.replace(/font-family\s*:\s*var\([^)]*\)[^;}]*/g, ""),
  );
  let fontWiring = "none";
  if (resolvedAny) fontWiring = "css-variables";
  else if (hasNextFont || hardcodedFamily) fontWiring = "hardcoded";

  const replaces = {};
  for (const role of ROLES) replaces[role] = roles[role]?.family ?? null;

  const target = {
    framework,
    router,
    styling,
    tailwindVersion: tw.version,
    fontWiring,
  };

  // Is this the branch codegen actually ships today (App + Tailwind v4 + CSS-variable
  // wiring)? The analyzer decides; codegen never re-guesses.
  const reasons = [];
  if (framework !== "next") reasons.push(`framework is ${framework} (need next)`);
  if (router !== "app") reasons.push(`router is ${router} (need app)`);
  if (styling !== "tailwind") reasons.push(`styling is ${styling} (need tailwind)`);
  if (tw.version !== 4) reasons.push(`tailwind v${tw.version ?? "?"} (need v4)`);
  if (fontWiring === "hardcoded") reasons.push("fonts are hardcoded (need css-variables)");
  if (fontWiring === "none") reasons.push("no fonts detected to replace");
  const supported = reasons.length === 0;

  // Coverage: will a swap actually be visible, and is this the only font subsystem?
  const dead = deadRoles(css).filter((role) => roles[role]); // only roles we'd actually swap
  const otherSubsystems = otherFontSubsystems(projectDir, rel(projectDir, declarationFile));
  const coverage = { deadRoles: dead, otherSubsystems };

  const notes = [];
  if (decl.localFonts.length)
    notes.push(`next/font/local in use (${decl.localFonts.map((f) => f.constName).join(", ")}) — repointed, not deleted`);
  if (decl.classNameTarget === "body") notes.push("font variables applied on <body> (not <html>)");
  for (const role of ROLES) if (!roles[role]) notes.push(`no ${role} font wired (codegen will add one)`);
  for (const role of dead)
    notes.push(
      `${role}: consumed via raw var(${ROLE_VARS[role]}) under @theme inline — Tailwind v4 doesn't expose it as a :root var, so it's dead on the live site; swapping ${role} is invisible until rewired through the font-${role === "body" ? "sans" : role} utility`,
    );
  for (const s of otherSubsystems)
    notes.push(`other font subsystem in ${s.file} (${[...s.families].join(", ") || s.variables.join(", ")}) — a global swap won't reach it (M6: multi-route)`);

  return {
    projectDir,
    ...target,
    declarationFile: rel(projectDir, declarationFile),
    cssFile: rel(projectDir, cssPath),
    tailwindConfig: rel(projectDir, twConfig),
    classNameTarget: decl.classNameTarget,
    roles,
    replaces,
    nextFonts: decl.nextFonts,
    localFonts: decl.localFonts,
    tailwindSignals: tw.signals,
    coverage,
    supported,
    reasons,
    notes,
  };
}

// The preview swap target, per role: which leaf next/font variable to override and on which
// element next/font set it. This is what makes the live panel honest on ANY site — override
// the same variable that ship rewrites, at the same element, so preview == ship by
// construction. Roles with no next/font variable (e.g. a system-mono `--font-mono`) are null:
// the panel can't preview a swap the site doesn't wire (we say so instead of faking it).
export function wiringFor(a) {
  const el = a.classNameTarget || "html";
  const w = {};
  for (const role of ROLES) {
    const r = a.roles[role];
    w[role] = r && r.nextFontVar ? { var: r.nextFontVar, el } : null;
  }
  return w;
}

// The subset codegen and selection.json care about.
export function toTarget(a) {
  return {
    framework: a.framework,
    router: a.router,
    styling: a.styling,
    tailwindVersion: a.tailwindVersion,
    fontWiring: a.fontWiring,
  };
}

// A compact, human-readable summary for the CLI.
export function summarize(a) {
  const fam = (r) => a.replaces[r] ?? "—";
  const lines = [
    `  framework   ${a.framework}`,
    `  router      ${a.router}`,
    `  styling     ${a.styling}${a.tailwindVersion ? ` v${a.tailwindVersion}` : ""}`,
    `  wiring      ${a.fontWiring}${a.classNameTarget ? ` (on <${a.classNameTarget}>)` : ""}`,
    `  current     display ${fam("display")}   body ${fam("body")}   mono ${fam("mono")}`,
    `  files       ${[a.declarationFile, a.cssFile].filter(Boolean).join(", ") || "—"}`,
    `  ships now    ${a.supported ? "yes (App + Tailwind v4 + CSS variables)" : "no — " + a.reasons.join("; ")}`,
  ];
  if (a.coverage.deadRoles.length) lines.push(`  ⚠ dead      ${a.coverage.deadRoles.join(", ")} — declared but not actually rendered (swap invisible until rewired)`);
  if (a.coverage.otherSubsystems.length)
    lines.push(`  ⚠ scope     other font subsystems: ${a.coverage.otherSubsystems.map((s) => s.file).join(", ")} (global swap won't reach them)`);
  if (a.notes.length) lines.push(`  notes       ${a.notes.join("\n              ")}`);
  return lines.join("\n");
}
