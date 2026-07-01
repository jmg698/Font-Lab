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
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
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

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const readSafe = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const HTML_TAG = /<html[\s/>]/;
const TW_DIRECTIVE = /@import\s+["']tailwindcss["']|@tailwind\s+(?:base|components|utilities)/;

// Bounded recursive finder: absolute paths of files whose name passes `match`, skipping the
// usual noise. Used to find a root layout hidden under route groups, and the Tailwind CSS
// entry when it isn't at a conventional path. Depth-capped so a big monorepo can't hang us.
function findFiles(dir, match, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (["node_modules", ".next", ".git", "dist", "build", "out"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(full, match, acc, depth + 1);
    else if (match(e.name)) acc.push(full);
  }
  return acc;
}

const shallowest = (files) => files.slice().sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)[0] || null;

// The App Router's root layout. Conventional path first; otherwise the layout that actually
// carries <html> — which is where it lives under a top-level route group like
// `app/(marketing)/layout.tsx` (a shape Next fully supports and real sites use).
function findRootLayout(projectDir) {
  const conv = ["app/layout.tsx", "app/layout.jsx", "src/app/layout.tsx", "src/app/layout.jsx"]
    .map((c) => path.join(projectDir, c))
    .find(existsSync);
  if (conv) return conv;
  for (const base of ["app", "src/app"]) {
    const root = path.join(projectDir, base);
    if (!existsSync(root)) continue;
    const layouts = findFiles(root, (n) => /^layout\.(tsx|jsx)$/.test(n));
    const withHtml = layouts.filter((f) => HTML_TAG.test(readSafe(f)));
    const pick = shallowest(withHtml.length ? withHtml : layouts);
    if (pick) return pick;
  }
  return null;
}

const findPagesApp = (projectDir) =>
  ["pages/_app.tsx", "pages/_app.jsx", "src/pages/_app.tsx", "src/pages/_app.jsx"]
    .map((c) => path.join(projectDir, c))
    .find(existsSync) || null;

// The CSS entry carrying the Tailwind directive. Conventional paths first; then any `.css`
// under app/src/styles that imports Tailwind — so a project whose entry is
// `src/styles/tailwind.css` (or any other non-standard name) isn't misread as "no CSS".
function findCssEntry(projectDir) {
  const conv = ["app/globals.css", "app/global.css", "src/app/globals.css", "styles/globals.css", "src/styles/globals.css", "app/styles/globals.css"]
    .map((c) => path.join(projectDir, c))
    .find((p) => existsSync(p) && TW_DIRECTIVE.test(readSafe(p)));
  if (conv) return conv;
  for (const base of ["app", "src", "styles"]) {
    const root = path.join(projectDir, base);
    if (!existsSync(root)) continue;
    const hit = findFiles(root, (n) => n.endsWith(".css")).find((p) => TW_DIRECTIVE.test(readSafe(p)));
    if (hit) return hit;
  }
  // No Tailwind directive anywhere — but on a non-Tailwind project we still want the CSS file that
  // owns the fonts, so degraded mode can name the current families (for the brief) and point a
  // hand-apply at the right file. Look for font signals.
  const FONT_SIGNAL = /fonts\.googleapis|@font-face|font-family\s*:|--f[dbm]\b|--font/i;
  for (const base of ["app", "src", "styles"]) {
    const root = path.join(projectDir, base);
    if (!existsSync(root)) continue;
    const hit = findFiles(root, (n) => n.endsWith(".css")).find((p) => FONT_SIGNAL.test(readSafe(p)));
    if (hit) return hit;
  }
  // Last resort: a conventional path if present, so version detection via deps has a file to read.
  return ["app/globals.css", "src/app/globals.css", "styles/globals.css"].map((c) => path.join(projectDir, c)).find(existsSync) || null;
}

function locate(projectDir) {
  const rootLayout = findRootLayout(projectDir);
  const pagesApp = rootLayout ? null : findPagesApp(projectDir);
  const router = rootLayout ? "app" : pagesApp ? "pages" : "unknown";
  const declarationFile = rootLayout || pagesApp || null;
  const css = findCssEntry(projectDir);
  const twConfig =
    ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"]
      .map((c) => path.join(projectDir, c))
      .find(existsSync) || null;

  return { declarationFile, router, css, twConfig };
}

// ---- module resolution (for fonts declared outside the layout) --------------

const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const resolveWithExts = (base) => RESOLVE_EXTS.map((e) => base + e).find(isFile) || null;

function readTsPaths(projectDir) {
  const ts = readJson(path.join(projectDir, "tsconfig.json")) || readJson(path.join(projectDir, "jsconfig.json"));
  const co = ts?.compilerOptions || {};
  return { baseUrl: co.baseUrl ? path.resolve(projectDir, co.baseUrl) : projectDir, paths: co.paths || {} };
}

// Resolve an import specifier to a font-module file on disk, or null for a bare package /
// unresolvable path. Handles relative imports and tsconfig path aliases (`@/lib/fonts`), which
// is how most teams share a `next/font` declaration across the layout and other files.
function resolveLocalModule(spec, fromFile, tsPaths) {
  if (spec.startsWith(".")) return resolveWithExts(path.resolve(path.dirname(fromFile), spec));
  for (const [pattern, targets] of Object.entries(tsPaths.paths)) {
    const m = spec.match(new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)") + "$"));
    if (!m) continue;
    for (const t of targets) {
      const hit = resolveWithExts(path.resolve(tsPaths.baseUrl, t.replace(/\*/g, m[1] ?? "")));
      if (hit) return hit;
    }
  }
  return null;
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

// Pull every `const x = Family({ variable: "--font-x", … })` out of one source file, keyed by
// const name. Shared by the layout and any font module it imports, so a font declared in
// `app/fonts.ts` reads exactly like one declared inline.
function collectFontConsts(sf) {
  const googleNames = new Set();
  const localNames = new Set();
  const importModules = [];
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (mod === "next/font/google" || mod === "next/font/local") {
      importModules.push(mod);
      const target = mod === "next/font/local" ? localNames : googleNames;
      for (const n of imp.getNamedImports()) target.add(n.getName());
      const def = imp.getDefaultImport();
      if (def) target.add(def.getText());
    }
  }

  const consts = new Map();
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
    consts.set(vd.getName(), {
      constName: vd.getName(),
      importName: callee,
      family: isGoogle ? familyFromImport(callee) : callee,
      variable,
      source: isGoogle ? "google" : "local",
    });
  }
  return { consts, importModules };
}

function parseDeclaration(declPath, projectDir, tsPaths) {
  const result = { nextFonts: [], localFonts: [], classNameTarget: null, classNameTargetTag: null, importModules: [], fromModules: [] };
  if (!declPath) return result;

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  const sf = project.addSourceFileAtPath(declPath);

  // 1) consts declared inline in the layout. bindingName = how the JSX className references it.
  const inline = collectFontConsts(sf);
  result.importModules.push(...inline.importModules);
  const byBinding = new Map();
  for (const [name, entry] of inline.consts) byBinding.set(name, { ...entry, bindingName: name, fromModule: null });

  // 2) consts imported from a LOCAL module — `import { sans } from "./fonts"` /
  //    `import { display } from "@/lib/fonts"`. Next's own docs recommend this split, so a lot
  //    of real projects keep zero font consts in the layout. Resolve the module, parse it the
  //    same way, and bind each named import to the const it actually points at (alias-aware).
  const moduleCache = new Map();
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (spec === "next/font/google" || spec === "next/font/local") continue;
    const named = imp.getNamedImports();
    if (!named.length) continue;
    const modPath = resolveLocalModule(spec, declPath, tsPaths);
    if (!modPath) continue;
    if (!moduleCache.has(modPath)) {
      try {
        const msf = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(modPath);
        moduleCache.set(modPath, collectFontConsts(msf));
      } catch {
        moduleCache.set(modPath, { consts: new Map(), importModules: [] });
      }
    }
    const mod = moduleCache.get(modPath);
    let used = false;
    for (const ni of named) {
      const entry = mod.consts.get(ni.getName());
      if (!entry) continue;
      const bindingName = ni.getAliasNode()?.getText() || ni.getName();
      byBinding.set(bindingName, { ...entry, bindingName, fromModule: rel(projectDir, modPath) });
      used = true;
    }
    if (used) {
      result.importModules.push(...mod.importModules);
      result.fromModules.push(rel(projectDir, modPath));
    }
  }

  for (const e of byBinding.values()) (e.source === "local" ? result.localFonts : result.nextFonts).push(e);

  // Which element carries the font consts' `.variable` classes. We track two answers: the best
  // html/body match (what codegen can safely edit) and the best match on ANY element (which
  // catches fonts pinned on a wrapper/provider instead) — so a non-standard target is reported,
  // never silently treated as <html>.
  const bindings = [...byBinding.keys()];
  const hitsOn = (el) => {
    const attr = el.getAttribute?.("className");
    const text = attr ? attr.getText() : "";
    return bindings.filter((b) => text.includes(`${b}.variable`)).length;
  };
  let bestStd = { tag: null, hits: 0 };
  let bestAny = { tag: null, hits: 0 };
  for (const kind of [SyntaxKind.JsxOpeningElement, SyntaxKind.JsxSelfClosingElement]) {
    for (const el of sf.getDescendantsOfKind(kind)) {
      const tag = el.getTagNameNode().getText();
      const hits = hitsOn(el);
      if (hits > bestAny.hits) bestAny = { tag, hits };
      if ((tag === "html" || tag === "body") && hits > bestStd.hits) bestStd = { tag, hits };
    }
  }
  result.classNameTarget = bestStd.tag; // html/body only — codegen-safe
  result.classNameTargetTag = bestAny.hits ? bestAny.tag : null; // the real carrier (may be a wrapper)
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

function otherFontSubsystems(projectDir, declarationFile, exclude = []) {
  const declAbs = declarationFile ? path.join(projectDir, declarationFile) : null;
  // Font modules the layout already pulls in are the PRIMARY fonts, not a rival subsystem.
  const excludeAbs = new Set(exclude.filter(Boolean).map((p) => path.join(projectDir, p)));
  const roots = ["app", "src/app", "components", "src/components", "lib", "src/lib"].map((d) => path.join(projectDir, d));
  const files = [];
  for (const r of roots) walkSourceFiles(r, files);
  const out = [];
  for (const f of [...new Set(files)]) {
    if (f === declAbs || excludeAbs.has(f)) continue;
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

// ---- framework + font-loading detection (beyond Next / next/font) -----------

// Which framework are we in? This decides the *declaration site* and *static dir*, not whether
// we can ship — the parity engine (self-hosted @font-face) is framework-agnostic.
function detectFramework(deps, projectDir) {
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
  if (has("next")) return "next";
  if (has("@tanstack/react-start") || has("@tanstack/start") || has("@tanstack/solid-start")) return "tanstack-start";
  if (has("@remix-run/react") || has("@react-router/dev")) return "remix";
  if (has("@sveltejs/kit")) return "sveltekit";
  if (has("astro")) return "astro";
  if (has("@angular/core")) return "angular";
  if (has("vite") || has("@vitejs/plugin-react") || has("@vitejs/plugin-vue")) return "vite";
  const cfg = (...f) => f.some((x) => existsSync(path.join(projectDir, x)));
  if (cfg("astro.config.mjs", "astro.config.ts", "astro.config.js")) return "astro";
  if (cfg("vite.config.ts", "vite.config.js", "vite.config.mjs")) return "vite";
  if (cfg("svelte.config.js", "svelte.config.ts")) return "sveltekit";
  return "unknown";
}

// A project's static web root, where `/fontlab/x.woff2` resolves. `public/` is the convention
// across Next / Vite / TanStack Start / Remix; Astro too. (SvelteKit uses `static/`.)
export function staticDirFor(framework) {
  return framework === "sveltekit" ? "static" : "public";
}

// CSS generic keywords / global values that are NOT a real font family — so tracing a role var
// to a value like `sans-serif` correctly reports "no concrete font here", not a family named
// "sans-serif".
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
  "ui-rounded", "cursive", "fantasy", "emoji", "math", "fangsong", "inherit", "initial", "unset",
  "revert", "revert-layer", "none",
]);

// The first *concrete* family in a font-family value (`'Archivo Black', sans-serif` -> "Archivo
// Black"). null if it's a var() ref (follow the chain) or only generics.
function firstConcreteFamily(value) {
  const seg = String(value).split(",")[0].trim().replace(/^["']|["']$/g, "").trim();
  if (!seg || /^var\(/i.test(seg)) return null;
  if (GENERIC_FAMILIES.has(seg.toLowerCase())) return null;
  return seg;
}

// Follow a CSS custom-property's `var(--x)` chain until we hit a literal font-family value.
// This names the current font on ANY css-wired site — Google `@import`, `<link>`, or a raw
// `@font-face` — not just next/font. Returns { family, leafVar } or null. Cycle-guarded.
function resolveCssFontFamily(startVar, cssVars) {
  const seen = new Set();
  let cur = startVar;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const val = cssVars.get(cur);
    if (val == null) return null;
    const fam = firstConcreteFamily(val);
    if (fam) return { family: fam, leafVar: cur };
    const next = val.match(/var\(\s*(--[A-Za-z0-9-]+)/);
    if (!next) return null;
    cur = next[1];
  }
  return null;
}

// Common project names for each role's font var, beyond Font Lab's own tokens — so we resolve
// (and later repoint) whatever the project actually calls its display/body/mono vars.
const ROLE_VAR_ALIASES = {
  display: ["--font-display", "--fd", "--font-heading", "--font-head", "--heading-font", "--display-font", "--ff-display"],
  body: ["--font-sans", "--font-body", "--font-base", "--fb", "--body-font", "--ff-body", "--font"],
  mono: ["--font-mono", "--fm", "--font-code", "--mono-font", "--ff-mono"],
};

// Families pulled from a Google Fonts `@import url(...)` or `<link href=...>` — the most common
// non-next/font loader. Handles css2 (`&family=`) and css1 (`family=A|B`) forms, strips axes.
function googleFamiliesFrom(text) {
  const fams = new Set();
  const re = /fonts\.googleapis\.com\/css2?\?([^"')\s]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const query = m[1];
    for (const fm of query.matchAll(/family=([^&:]+)/g)) {
      const raw = fm[1];
      for (const part of raw.split("|")) {
        try {
          const fam = decodeURIComponent(part.split(":")[0].replace(/\+/g, " ")).trim();
          if (fam) fams.add(fam);
        } catch {}
      }
    }
  }
  return [...fams];
}

// ---- the public surface -----------------------------------------------------

export function analyzeProject(projectDir) {
  projectDir = path.resolve(projectDir);
  const deps = readDeps(projectDir);
  const { declarationFile, router, css: cssPath, twConfig } = locate(projectDir);

  const framework = detectFramework(deps, projectDir);
  const styling = deps.tailwindcss ? "tailwind" : "unknown";

  const tsPaths = readTsPaths(projectDir);
  const decl = parseDeclaration(declarationFile, projectDir, tsPaths);
  const css = cssPath ? readFileSync(cssPath, "utf8") : "";
  const cssVars = collectCssVars(css);
  const tw = detectTailwind(css, deps, twConfig);

  // The project's CSS with Font Lab's OWN applied block removed — so CSS-native detection reads
  // the project's original wiring, never what a prior css-entry apply wrote. Without this, our
  // fenced `@theme { --font-display: 'FL X' }` would make re-analysis resolve the role's leaf var
  // to the role token itself, changing what we repoint and breaking idempotent re-apply.
  const FL_FENCE = /\/\* font-lab:start \*\/[\s\S]*?\/\* font-lab:end \*\//g;
  const cssClean = css.replace(FL_FENCE, "");
  const cssVarsClean = collectCssVars(cssClean);

  const fontByVar = new Map();
  for (const f of [...decl.nextFonts, ...decl.localFonts]) if (f.variable) fontByVar.set(f.variable, f);
  const fontVarSet = new Set(fontByVar.keys());

  // Resolve each role's font by tracing the role var through the CSS graph to a next/font const.
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
        leafVar: font.variable,
        fromModule: font.fromModule ?? null,
      };
    } else {
      roles[role] = null;
    }
  }

  // Nothing from next/font? Fall back to a CSS-native trace — name the family the project loads
  // via Google `@import`/`<link>` or a raw `@font-face`, keyed on whatever it calls its role var
  // (`--fd`, `--font-display`, …). This is what makes Font Lab see the current fonts on a
  // TanStack/Vite/Astro site instead of reporting `fontWiring: none`.
  let cssNativeResolvedAny = false;
  for (const role of ROLES) {
    if (roles[role]) continue;
    for (const v of ROLE_VAR_ALIASES[role]) {
      const hit = resolveCssFontFamily(v, cssVarsClean);
      if (hit) {
        roles[role] = { family: hit.family, source: "css", roleVar: v, leafVar: hit.leafVar, nextFontVar: null, constName: null, importName: null, fromModule: null };
        cssNativeResolvedAny = true;
        break;
      }
    }
  }

  // How are the current fonts loaded? Drives the ship branch and honest messaging. Read from the
  // fence-stripped CSS so our own applied @font-face/@import edits don't masquerade as the
  // project's loader on re-analyze.
  const googleImportFamilies = googleFamiliesFrom(cssClean);
  let fontLoading = "none";
  if (resolvedAny) fontLoading = "next-font";
  else if (googleImportFamilies.length) fontLoading = "import-url";
  else if (/@font-face\s*\{/i.test(cssClean)) fontLoading = "font-face";
  else if (cssNativeResolvedAny) fontLoading = "css-var";
  else if (decl.nextFonts.length + decl.localFonts.length > 0) fontLoading = "next-font";

  // Every current family we can name, from any loader — what the taste engine steers *away* from.
  const currentFamilies = [...new Set([...ROLES.map((r) => roles[r]?.family).filter(Boolean), ...googleImportFamilies])];

  // Wiring: role vars resolving to next/font consts is the high-fidelity, swap-friendly
  // path. next/font present but unreachable through vars (or literal font-family) is the
  // lower-fidelity hardcoded path. Nothing at all is "none".
  const hasNextFont = decl.nextFonts.length + decl.localFonts.length > 0;
  // A literal `font-family: 'X'` USAGE means hardcoded wiring — but a `font-family` *inside*
  // an `@font-face` block is a face declaration, not usage, and our own fenced block is
  // self-hosted parity CSS. Strip both so a css-entry apply stays self-consistent on re-analyze
  // (else re-apply would refuse, breaking idempotency), and `var(...)` usage is css-variable wiring.
  const cssForHardcoded = css
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/\/\* font-lab:start \*\/[\s\S]*?\/\* font-lab:end \*\//g, "")
    .replace(/font-family\s*:\s*var\([^)]*\)[^;}]*/g, "");
  const hardcodedFamily = /font-family\s*:\s*(['"][A-Za-z][^;}]*|[A-Za-z][\w -]*,)/.test(cssForHardcoded);
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

  // Fonts declared in a separate module: correctly detected above (family + wiring), but
  // codegen edits the layout in place and can't yet rewrite a const that lives in another
  // file — so we name the exact blocker instead of misreporting the wiring.
  const moduleFontFiles = [...new Set(ROLES.filter((r) => roles[r]?.fromModule).map((r) => roles[r].fromModule))];
  if (moduleFontFiles.length)
    reasons.push(`current fonts are declared in a separate module (${moduleFontFiles.join(", ")}) — codegen can't rewrite module-defined fonts yet`);

  // Fonts pinned on a wrapper/provider instead of <html>/<body>: the variable lands on an
  // element we can't statically resolve to a DOM node, so a :root-scoped swap would miss it.
  const wrapperTarget = decl.classNameTargetTag && !decl.classNameTarget ? decl.classNameTargetTag : null;
  if (wrapperTarget) reasons.push(`font variables applied on <${wrapperTarget}> (need <html> or <body>)`);

  const supported = reasons.length === 0;

  // ── ship branch selection (decoupled from Next) ──────────────────────────────
  // Two auto-ship branches, and an honest degraded path:
  //   • next-font  — the original: Next App Router + TW v4 + next/font (`supported`).
  //   • css-entry  — self-host the parity woff2 + @font-face into the CSS entry and route it to
  //                  the elements. Two ways in: (a) Tailwind v4, via @theme (any framework); or
  //                  (b) VAR-WIRED, Tailwind or not — the project routes fonts through a CSS var
  //                  (`--font-body`, `--fd`, …) that we repoint. Both are a single, clean seam.
  //   • manual     — hardcoded font-family with no var, CSS-in-JS, etc.: compose + preview still
  //                  work; the human applies the generated block by hand. (Tier B/C.)
  const nextFontBranch = supported;
  // A role whose current font we resolved through a CSS variable — the seam we can repoint even
  // without Tailwind. (next/font-sourced roles don't count; those take the next-font branch.)
  const varWired = ROLES.some((r) => roles[r]?.source === "css" && roles[r]?.leafVar);
  const cssEntryBranch =
    !nextFontBranch &&
    !!cssPath &&
    fontLoading !== "next-font" &&
    fontWiring !== "hardcoded" &&
    !moduleFontFiles.length &&
    (tw.version === 4 || varWired);
  const applyMode = nextFontBranch ? "next-font" : cssEntryBranch ? "css-entry" : null;
  const shippable = applyMode !== null;
  const cssEntryVia = applyMode === "css-entry" ? (tw.version === 4 ? "tailwind" : "css-var") : null;

  // What an agent can actually do here — the manifest that turns a refusal into a paved path
  // instead of a dead end. `livePanel` is the in-app HMR panel (Next-only today); everything
  // else (taste engine + screenshot preview + apply) works on the css-entry branch too.
  const capabilities = {
    autoApply: shippable,
    applyMode,
    livePanel: nextFontBranch,
    screenshotPreview: true,
    composeDirections: true,
    manualApply: !shippable,
    applyTarget: applyMode === "css-entry" ? rel(projectDir, cssPath) : applyMode === "next-font" ? rel(projectDir, declarationFile) : rel(projectDir, cssPath),
  };
  const shipNote =
    applyMode === "next-font"
      ? "auto-ship via next/font + Tailwind (App Router)"
      : applyMode === "css-entry"
        ? cssEntryVia === "tailwind"
          ? `auto-ship via self-hosted @font-face + Tailwind @theme into ${capabilities.applyTarget} (${framework}, no next/font)`
          : `auto-ship via self-hosted @font-face + repointing the project's own font var(s) in ${capabilities.applyTarget} (${framework}, no Tailwind)`
        : `no auto-ship branch (${reasons.join("; ") || "unknown"}) — compose + preview still work; the human applies the pick by hand${capabilities.applyTarget ? ` into ${capabilities.applyTarget}` : ""}`;

  // Coverage: will a swap actually be visible, and is this the only font subsystem?
  const dead = deadRoles(css).filter((role) => roles[role]); // only roles we'd actually swap
  const otherSubsystems = otherFontSubsystems(projectDir, rel(projectDir, declarationFile), decl.fromModules);
  const coverage = { deadRoles: dead, otherSubsystems };

  const notes = [];
  if (decl.localFonts.length)
    notes.push(`next/font/local in use (${decl.localFonts.map((f) => f.constName).join(", ")}) — repointed, not deleted`);
  if (decl.classNameTarget === "body") notes.push("font variables applied on <body> (not <html>)");
  if (moduleFontFiles.length)
    notes.push(`fonts imported from ${moduleFontFiles.join(", ")} (declared outside the layout) — detected, but shipping them is not wired up yet`);
  if (wrapperTarget)
    notes.push(`font variables ride <${wrapperTarget}>, not <html>/<body> — a global :root swap won't reach them until they're moved onto <html>/<body>`);
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
    fontLoading,
    currentFamilies,
    declarationFile: rel(projectDir, declarationFile),
    cssFile: rel(projectDir, cssPath),
    staticDir: staticDirFor(framework),
    tailwindConfig: rel(projectDir, twConfig),
    classNameTarget: decl.classNameTarget,
    classNameTargetTag: decl.classNameTargetTag,
    fontModules: decl.fromModules,
    roles,
    replaces,
    nextFonts: decl.nextFonts,
    localFonts: decl.localFonts,
    tailwindSignals: tw.signals,
    coverage,
    supported,
    applyMode,
    cssEntryVia,
    shippable,
    capabilities,
    shipNote,
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
