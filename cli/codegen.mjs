// Font Lab codegen (M2 + M3) — turn .font-lab/selection.json into real, reversible
// next/font + Tailwind edits, with the analyzer (M3) choosing the branch so codegen never
// guesses. Strategy per docs/SHIP-SPEC.md:
//   • ts-morph for the AST-sensitive bits: merge the next/font import, rewrite the <html>
//     (or <body>) className, and either replace or adopt the consts we're swapping;
//   • fenced markers for the append-only regions (the generated font consts in layout.tsx
//     and the @theme block in globals.css) — trivially find/replace/remove, so re-apply is
//     byte-idempotent and undo is exact;
//   • backup-first undo that needs nothing of the user (no clean tree, no git).
//
// Two wiring shapes, both now handled (the analyzer says which applies per role):
//   • ROLE-VAR — a font const lives on a role variable (`--font-sans`) or the role is empty.
//     We replace/create a Font-Lab const on that role var (the M2 path; jack's missing mono).
//   • ADOPT — a font const lives on the project's own variable (`--font-bricolage`) wired to
//     a role through `@theme inline`. We rewrite that const's family IN PLACE, keeping its
//     variable, name, and className token — a minimal diff that leaves the project's own
//     wiring intact (SHIP-SPEC "adopt an existing variable rather than introduce a competitor").
//
// Scope gate: App Router + Tailwind v4 + CSS-variable wiring. The analyzer enforces it.

import { Project, Node, SyntaxKind, QuoteKind } from "ts-morph";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { analyzeProject } from "./analyzer.mjs";
import { inCatalog, get as catalogGet } from "./catalog.mjs";
import { normalize as normFamily, admit as admitFont, isShippable } from "./admit.mjs";
import { buildParityBundles } from "./catalog-build.mjs";
import { ensureFlDir, pruneBackups, appendSourceEdit } from "./state.mjs";

const ROLE_VARS = { display: "--font-display", body: "--font-sans", mono: "--font-mono" };
const ROLE_VAR_SET = new Set(Object.values(ROLE_VARS));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const constName = (role) => "fontLab" + cap(role);
const importName = (family) => family.replace(/[^A-Za-z0-9]+/g, "_");
// Roles whose const WE generate in the fenced block (vs adopt of the project's own const).
// "localfont" is rolevar-shaped everywhere except the import + the const's factory call.
const isGenerated = (r) => r.mode === "rolevar" || r.mode === "localfont";
const famSlug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-"); // matches catalog-build's woff2 naming
// A distinct, family-named CSS variable for a new role, matching the common project convention
// (`--font-bricolage`, `--font-jetbrains-mono`). Keeping it distinct from the role token avoids the
// self-referential `--font-mono: var(--font-mono)` and the collision with a project's own token.
const fontVar = (family) => "--font-" + family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function resolveTargets(projectDir) {
  const appDir = ["app", "src/app"]
    .map((d) => path.join(projectDir, d))
    .find((d) => existsSync(path.join(d, "layout.tsx")));
  if (!appDir) throw new Error("could not find app/layout.tsx (App Router only for now)");
  const layout = path.join(appDir, "layout.tsx");
  const css = ["globals.css", "global.css"].map((f) => path.join(appDir, f)).find(existsSync);
  if (!css) throw new Error("could not find app/globals.css");
  return { layout, css };
}

// ---- layout.tsx: AST bits (import + className + replace/adopt consts) -------

function getStringProp(obj, name) {
  const p = obj.getProperty(name);
  if (!p || !Node.isPropertyAssignment(p)) return null;
  const init = p.getInitializer();
  if (!init) return null;
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue();
  return init.getText().replace(/^["'`]|["'`]$/g, "");
}

// Find the element (preferring the analyzer's choice) that wears the font variables.
function findClassTarget(sf, preferred) {
  const els = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  const byTag = (tag) => els.find((e) => e.getTagNameNode().getText() === tag);
  return (preferred && byTag(preferred)) || byTag("html") || byTag("body") || null;
}

function classNameTokens(attr) {
  const dynamic = [];
  const statics = [];
  const init = attr?.getInitializer();
  if (!init) return { dynamic, statics };
  if (Node.isJsxExpression(init)) {
    const expr = init.getExpression();
    if (!expr) return { dynamic, statics };
    if (Node.isTemplateExpression(expr)) {
      statics.push(...expr.getHead().getLiteralText().split(/\s+/).filter(Boolean));
      for (const span of expr.getTemplateSpans()) {
        dynamic.push(span.getExpression().getText());
        statics.push(...span.getLiteral().getLiteralText().split(/\s+/).filter(Boolean));
      }
    } else if (Node.isNoSubstitutionTemplateLiteral(expr) || Node.isStringLiteral(expr)) {
      statics.push(...expr.getLiteralValue().split(/\s+/).filter(Boolean));
    } else {
      dynamic.push(expr.getText());
    }
  } else if (Node.isStringLiteral(init)) {
    statics.push(...init.getLiteralValue().split(/\s+/).filter(Boolean));
  }
  return { dynamic, statics };
}

function buildClassNameInit(dynamic, statics) {
  if (dynamic.length === 0) return `"${statics.join(" ")}"`;
  const dyn = dynamic.map((d) => "${" + d + "}").join(" ");
  const stat = statics.length ? " " + statics.join(" ") : "";
  return "{`" + dyn + stat + "`}";
}

function editLayoutAst(sf, roles, classTarget) {
  // 1) ensure the next/font/google import carries every new GOOGLE family. Local-shipped
  //    (foundry) families must never land here — an unknown name in this import is exactly
  //    the "apply exits 0, next build fails" failure this branch used to have.
  let imp = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === "next/font/google");
  if (!imp) imp = sf.addImportDeclaration({ moduleSpecifier: "next/font/google", namedImports: [] });
  const named = new Set(imp.getNamedImports().map((n) => n.getName()));
  for (const r of roles.filter((r) => r.mode !== "localfont"))
    if (!named.has(r.importName)) {
      imp.addNamedImport(r.importName);
      named.add(r.importName);
    }

  // 1b) self-hosted faces ride next/font/local's default import.
  if (roles.some((r) => r.mode === "localfont")) {
    const local = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === "next/font/local");
    if (!local) sf.addImportDeclaration({ moduleSpecifier: "next/font/local", defaultImport: "localFont" });
    else if (!local.getDefaultImport()) local.setDefaultImport("localFont");
  }

  const replaced = [];
  const oldImports = new Set();

  // 2a) ADOPT — rewrite the existing const's family in place, keep its variable/name.
  for (const r of roles.filter((r) => r.mode === "adopt")) {
    const vd = sf.getVariableDeclaration(r.constName);
    const init = vd?.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression();
    const old = callee.getText();
    if (old !== r.importName) {
      replaced.push({ variable: r.adoptVar, font: old });
      oldImports.add(old);
      callee.replaceWithText(r.importName);
    }
  }

  // 2b) ROLE-VAR — remove existing non-Font-Lab consts sitting on a role var (the ones we
  //     replace). Font Lab's own consts live in a fenced block managed as text — never here.
  const removeNames = [];
  for (const vd of sf.getVariableDeclarations()) {
    if (vd.getName().startsWith("fontLab")) continue;
    const init = vd.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const obj = init.getArguments()[0];
    const varVal = obj && Node.isObjectLiteralExpression(obj) ? getStringProp(obj, "variable") : null;
    if (varVal && ROLE_VAR_SET.has(varVal)) {
      removeNames.push(vd.getName());
      replaced.push({ variable: varVal, font: init.getExpression().getText() });
      oldImports.add(init.getExpression().getText());
      vd.getVariableStatementOrThrow().remove();
    }
  }

  // 3) className: drop the removed role-var consts' tokens, add a token for every role-var
  //    role. Adopted roles already carry their token and we leave it untouched.
  const el = findClassTarget(sf, classTarget);
  if (!el) throw new Error(`no <${classTarget || "html"}> element in layout.tsx`);
  const attr = el.getAttribute("className");
  const { dynamic, statics } = classNameTokens(attr);
  const kept = dynamic.filter((d) => !removeNames.some((n) => d === n || d.startsWith(n + ".")));
  for (const r of roles.filter(isGenerated)) {
    const token = `${r.constName}.variable`;
    if (!kept.includes(token)) kept.push(token);
  }
  const initText = buildClassNameInit(kept, statics);
  if (attr) attr.setInitializer(initText);
  else el.addAttribute({ name: "className", initializer: initText });

  // 4) drop now-unused imports for replaced/adopted fonts — never one a role still needs.
  const roleImports = new Set(roles.map((r) => r.importName));
  for (const callee of oldImports) {
    if (roleImports.has(callee)) continue;
    const stillUsed = sf
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((id) => id.getText() === callee && !Node.isImportSpecifier(id.getParent()));
    if (!stillUsed) imp.getNamedImports().find((n) => n.getName() === callee)?.remove();
  }

  return { replaced };
}

// ---- layout.tsx: fenced const block (text, idempotent) ---------------------
// Only role-var roles need a generated const; adopted roles are rewritten above.

function setFencedConsts(text, roles) {
  const rv = roles.filter(isGenerated);
  const strip = (t) => t.replace(/\n*\/\/ font-lab:start[\s\S]*?\/\/ font-lab:end\n*/g, "\n\n");
  if (!rv.length) return strip(text);
  const constLine = (r) =>
    r.mode === "localfont"
      ? // Self-hosted parity woff2 (foundry faces): the same file + declared weight range the
        // preview used, so what the human saw is what ships. `weight: "100 900"` mirrors the
        // preview's `font-weight: 100 900` @font-face descriptor.
        `const ${r.constName} = localFont({ src: [{ path: "${r.srcPath}", weight: "100 900", style: "normal" }], display: "swap", variable: "${r.fontVar}" });`
      : `const ${r.constName} = ${r.importName}({ subsets: ["latin"], display: "swap", variable: "${r.fontVar}" });`;
  const lines = [
    "// font-lab:start",
    "// generated — re-run `font-lab apply` to update, `font-lab undo` to revert",
    ...rv.map(constLine),
    "// font-lab:end",
  ];
  const block = lines.join("\n");
  text = strip(text);
  // Match import statements with or without a trailing semicolon (Prettier `semi: false`
  // projects — e.g. jack-mcgovern.com — write `import x from 'y'` with no `;`).
  const importRe = /^import\s[^\n]*$/gm;
  let last = 0;
  let m;
  while ((m = importRe.exec(text))) last = m.index + m[0].length;
  const before = text.slice(0, last).replace(/\s*$/, "");
  const after = text.slice(last).replace(/^\s*/, "");
  return `${before}\n\n${block}\n\n${after}`;
}

function verifyLayout(sf, roles, classTarget) {
  for (const r of roles) {
    const vd = sf.getVariableDeclaration(r.constName);
    if (!vd) throw new Error(`verify: missing const ${r.constName}`);
    if (r.mode === "adopt") {
      const callee = vd.getInitializer()?.getExpression?.().getText();
      if (callee !== r.importName) throw new Error(`verify: ${r.constName} not rewritten to ${r.importName}`);
    }
    if (r.mode === "localfont") {
      const callee = vd.getInitializer()?.getExpression?.().getText();
      if (callee !== "localFont") throw new Error(`verify: ${r.constName} not a localFont const`);
    }
  }
  const { dynamic } = classNameTokens(findClassTarget(sf, classTarget)?.getAttribute("className"));
  for (const r of roles) {
    if (!dynamic.includes(`${r.constName}.variable`)) throw new Error(`verify: <${classTarget}> missing ${r.constName}.variable`);
  }
}

// ---- globals.css (fenced markers) ------------------------------------------
// Only role-var roles need a @theme mapping; adopted roles reuse the project's existing one.

function editCss(cssPath, roles) {
  const rv = roles.filter(isGenerated);
  const css = readFileSync(cssPath, "utf8");
  const next = composeCss(css, rv);
  if (next !== css) writeFileSync(cssPath, next);
}

const FONTLAB_BLOCK = /\/\* font-lab:start \*\/[\s\S]*?\/\* font-lab:end \*\//;

// Pure CSS transform (exported for testing). Inserts/updates the fenced `@theme inline` block that
// maps each role token to a DISTINCT, family-named next/font variable. Two things make it correct on
// real projects (not just the single-import fixture):
//   • placement is after the last leading @import (so every @import stays valid — an @theme wedged
//     between two imports invalidates the later one), AND after the project's own @theme blocks, so
//     our role tokens win Tailwind v4's last-declaration-wins merge (else the new font loads but the
//     utility keeps the project's old value — "downloaded but unused");
//   • each map entry is `--role-token: var(--font-family)`, never `--font-mono: var(--font-mono)`.
export function composeCss(css, rv) {
  if (!rv.length) {
    return FONTLAB_BLOCK.test(css) ? css.replace(/\n*\/\* font-lab:start \*\/[\s\S]*?\/\* font-lab:end \*\/\n*/, "\n") : css;
  }
  const block = [
    "/* font-lab:start */",
    "@theme inline {",
    ...rv.map((r) => `  ${r.varName}: var(${r.fontVar});`),
    "}",
    "/* font-lab:end */",
  ].join("\n");
  if (FONTLAB_BLOCK.test(css)) return css.replace(FONTLAB_BLOCK, block); // idempotent: update in place
  const at = cssInsertIndex(css);
  const head = css.slice(0, at).replace(/\s*$/, "");
  const tail = css.slice(at).replace(/^\s*/, "");
  return [head, block, tail].filter(Boolean).join("\n\n") + "\n";
}

function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return s.length - 1;
}

// Byte offset to insert our block: after the last leading @import AND after the last existing
// @theme block, whichever is later (0 = top of file when there are neither).
function cssInsertIndex(css) {
  let idx = 0;
  let m;
  const importRe = /@import\b[^;]*;/g;
  while ((m = importRe.exec(css))) idx = Math.max(idx, m.index + m[0].length);
  const themeRe = /@theme\b[^{]*\{/g;
  while ((m = themeRe.exec(css))) idx = Math.max(idx, matchBrace(css, themeRe.lastIndex - 1) + 1);
  return idx;
}

// ---- backups / apply / undo ------------------------------------------------

function backup(projectDir, files) {
  const flDir = ensureFlDir(projectDir); // born self-ignoring — backups never reach the git diff
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(flDir, "backups", runId);
  const manifest = { runId, git: null, files: [] };
  for (const f of files) {
    const rel = path.relative(projectDir, f);
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(f, dest);
    manifest.files.push({ path: rel, sha256: sha(readFileSync(f)) });
  }
  try {
    // stderr ignored: on a non-git project the catch swallows the error, but git's
    // "fatal: not a git repository" would still leak through inherited stderr.
    manifest.git = execFileSync("git", ["-C", projectDir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(flDir, "backups", "latest.txt"), runId);
  // undo only ever reads the run latest.txt names — cap the older apply runs (never edit-*).
  pruneBackups(projectDir, { family: "apply" });
  return { dir, runId };
}

function restore(projectDir, backupDir) {
  const manifest = JSON.parse(readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
  for (const f of manifest.files) copyFileSync(path.join(backupDir, f.path), path.join(projectDir, f.path));
}

// Decide per-role whether to adopt the project's existing wiring or write a generated const
// (rolevar for Google faces, localfont for self-hosted foundry faces).
function planRoles(selection, analysis, shipInfo = {}) {
  const plans = ["display", "body", "mono"].map((role) => {
    const family = selection.roles[role].family;
    const existing = analysis.roles[role];
    const ship = shipInfo[family] || { kind: "google" };
    // Adopt the project's OWN variable-named const — but never our own generated one. On a
    // re-apply the analyzer re-reads Font Lab's `fontLab*` const (which sits on a family-named
    // var like `--font-fraunces`); treating that as "the project's wiring" would flip the role
    // to adopt and make setFencedConsts strip its own block. The `fontLab` guard keeps re-apply
    // byte-idempotent.
    //
    // Two more adopt exclusions:
    //   • a locally-shipped (foundry) family — adopt rewrites the callee to a next/font/google
    //     name, which can't express a `src:` file; it gets its own localFont const instead;
    //   • an existing next/font/local const — rewriting its callee to a Google name would leave
    //     the local-only `src` option behind, which next/font/google rejects at build.
    const adopt =
      existing &&
      existing.nextFontVar &&
      !ROLE_VAR_SET.has(existing.nextFontVar) &&
      !existing.constName?.startsWith("fontLab") &&
      existing.source !== "local" &&
      ship.kind !== "local";
    if (adopt)
      return {
        role,
        family,
        importName: importName(family),
        mode: "adopt",
        constName: existing.constName,
        adoptVar: existing.nextFontVar,
      };
    return {
      role,
      family,
      importName: importName(family),
      mode: ship.kind === "local" ? "localfont" : "rolevar",
      constName: constName(role),
      varName: ROLE_VARS[role], // the Tailwind role token (left side of the @theme map)
      fontVar: fontVar(family), // the distinct next/font variable (what the const sets, right side)
      ...(ship.kind === "local" ? { srcPath: ship.srcPath } : {}),
    };
  });
  // One project const can back several roles (a single sans doing display+body duty: both
  // roles trace to the same leaf var). Only one family can live in that const — the first
  // role keeps the adopt; a later role wanting a DIFFERENT family there falls back to its
  // own role-var const, else the two rewrites race and last-write-wins breaks verify.
  const claimed = new Map(); // constName -> importName of the role that adopted it
  return plans.map((p) => {
    if (p.mode !== "adopt") return p;
    const first = claimed.get(p.constName);
    if (!first) {
      claimed.set(p.constName, p.importName);
      return p;
    }
    if (first === p.importName) return p; // same family: one rewrite serves both roles
    return {
      role: p.role,
      family: p.family,
      importName: p.importName,
      mode: "rolevar",
      constName: constName(p.role),
      varName: ROLE_VARS[p.role],
      fontVar: fontVar(p.family),
    };
  });
}

// ---- next-font branch: ship-source resolution (the pre-apply trust gate) ----
// Every family must resolve to a real, buildable source BEFORE we write a byte:
//   catalog member            → next/font/google (the proven path)
//   admitted, source google   → next/font/google
//   admitted, source foundry  → next/font/local, self-hosting the SAME parity woff2 the
//                               preview rendered (copied from <staticDir>/fontlab/, or
//                               fetched from the admitted verdict's woff2Url)
//   unknown                   → run the shippability gate now (network); refuse with the
//                               gate's reason rather than emitting an import that fails at
//                               `next build` ("Unknown font") long after apply exited 0.

const CURL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function admittedFileCache(projectDir) {
  const p = path.join(projectDir, ".font-lab", "admitted.json");
  const load = () => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return {};
    }
  };
  return {
    get: (key) => load()[key],
    set: (key, verdict) => {
      const all = load();
      all[key] = verdict;
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(all, null, 2));
    },
  };
}

function ensureLocalFontFile(projectDir, analysis, layoutPath, family, woff2Url) {
  const name = `fontlab-${famSlug(family)}.woff2`;
  const fontsDir = path.join(path.dirname(layoutPath), "fonts");
  const dest = path.join(fontsDir, name);
  if (!existsSync(dest)) {
    mkdirSync(fontsDir, { recursive: true });
    // The preview already self-hosted this exact file — prefer it (byte-identical, offline).
    const staged = path.join(projectDir, analysis.staticDir || "public", "fontlab", famSlug(family) + ".woff2");
    if (existsSync(staged)) copyFileSync(staged, dest);
    else if (woff2Url) execFileSync("curl", ["-sSL", "-A", CURL_UA, "-o", dest, woff2Url]);
    else throw new Error(`no self-hostable woff2 for "${family}" — run font_lab_check_fonts (or prepare the preview) first`);
  }
  // next/font/local resolves src relative to the declaring file (layout.tsx).
  return { srcPath: `./fonts/${name}`, file: path.relative(projectDir, dest) };
}

async function resolveShipInfo(projectDir, analysis, layoutPath, families) {
  const cache = admittedFileCache(projectDir);
  const info = {};
  const localFiles = [];
  for (const family of new Set(families)) {
    if (inCatalog(family)) {
      info[family] = { kind: "google" };
      continue;
    }
    let v = cache.get(normFamily(family));
    if (!v) {
      try {
        v = await admitFont(family, { cache });
      } catch (e) {
        throw new Error(
          `couldn't verify "${family}" for the next/font branch (${e.message}) — ` +
            `run font_lab_check_fonts first, or pick a Google Fonts family`,
        );
      }
    }
    if (!isShippable(v))
      throw new Error(`"${family}" can't ship: ${v.reason || "not resolvable to a buildable source"} — pick a different face or re-run font_lab_check_fonts`);
    if (v.source === "foundry" || (!v.css2 && v.woff2Url)) {
      const { srcPath, file } = ensureLocalFontFile(projectDir, analysis, layoutPath, family, v.woff2Url);
      info[family] = { kind: "local", srcPath };
      localFiles.push(file);
    } else {
      info[family] = { kind: "google" };
    }
  }
  return { info, localFiles };
}

// ---- CSS-entry apply branch (framework-agnostic, no next/font) --------------
// For ANY framework on Tailwind v4 whose fonts are CSS-wired. We self-host the parity woff2 +
// adjusted-fallback @font-face (the SAME engine the Next panel uses), then write a fenced block
// into the CSS entry that (a) declares the @font-face, (b) maps the Tailwind role tokens via
// @theme, and (c) repoints the project's own leaf vars (`--fd`, …) so existing elements swap
// too. Old Google `@import`s are dropped. Reversible via backup; idempotent via the fence.

// Resolve a family to a generateCatalog spec using catalog members + the project's admitted
// cache — mirrors engine.mergedSpecFor so a picked non-catalog (but admitted) font still ships.
function specForProject(projectDir) {
  let admitted = {};
  try {
    admitted = JSON.parse(readFileSync(path.join(projectDir, ".font-lab", "admitted.json"), "utf8"));
  } catch {}
  return (family) => {
    if (inCatalog(family)) return catalogGet(family);
    const v = admitted[normFamily(family)];
    if (v && (v.css2 || v.woff2Url)) return { css2: v.css2 || null, capsize: v.capsize || null, woff2Url: v.woff2Url || null, category: v.category || null };
    throw new Error(`"${family}" isn't a catalog member and hasn't been admitted — run check_fonts/compose first`);
  };
}

// Pure CSS transform (exported for testing). Drops Google Font @imports and inserts/updates the
// fenced block: @font-face bundles + an @theme role map + a :root repoint of detected leaf vars.
export function composeCssEntry(css, { faceCss, roleStacks, leafVars }) {
  const themeLines = Object.entries(roleStacks).filter(([, s]) => s).map(([tok, s]) => `  ${tok}: ${s};`);
  const rootLines = Object.entries(leafVars).map(([v, s]) => `  ${v}: ${s};`);
  const parts = ["/* font-lab:start */", ...faceCss];
  if (themeLines.length) parts.push("@theme {", ...themeLines, "}");
  if (rootLines.length) parts.push(":root {", ...rootLines, "}");
  parts.push("/* font-lab:end */");
  const block = parts.join("\n");
  // Our self-hosted faces replace any Google Fonts @import (byte parity + zero runtime network).
  const base = css.replace(/^[ \t]*@import\s+(?:url\(\s*)?["']?https?:\/\/fonts\.(?:googleapis|gstatic)\.com[^\n]*\n?/gim, "");
  if (FONTLAB_BLOCK.test(base)) return base.replace(FONTLAB_BLOCK, block); // idempotent update-in-place
  // Append at the END: our @theme must win Tailwind v4's last-declaration merge, and our :root
  // repoint must override the project's own `--font-*: '…'` earlier in the file (same specificity,
  // source order wins). @import rules stay at the top (we only added @font-face/@theme/:root).
  return base.replace(/\s*$/, "") + "\n\n" + block + "\n";
}

async function applyCssEntry(projectDir, selection, analysis, cssPath, opts = {}) {
  const roleFamily = {};
  for (const role of ["display", "body", "mono"]) {
    const fam = selection.roles?.[role]?.family;
    if (!fam) throw new Error(`css-entry apply: selection is missing the ${role} family`);
    roleFamily[role] = fam;
  }
  const families = [...new Set(Object.values(roleFamily))];

  const { dir: backupDir, runId } = backup(projectDir, [cssPath]);
  try {
    const { faceCss, stacks } = await buildParityBundles(projectDir, families, {
      fetch: opts.fetch,
      staticDir: analysis.staticDir,
      specFor: specForProject(projectDir),
      log: opts.log,
    });

    // Tailwind v4 routes fonts through @theme utilities; a non-Tailwind (but var-wired) project
    // routes them through its own CSS var — so we pick the seam the project actually uses.
    const useTheme = analysis.cssEntryVia === "tailwind";
    const roleStacks = {};
    const leafVars = {};
    const repointed = [];
    const unrouted = [];
    for (const role of ["display", "body", "mono"]) {
      const stack = stacks[roleFamily[role]];
      const leaf = analysis.roles?.[role]?.leafVar;
      if (useTheme) {
        roleStacks[ROLE_VARS[role]] = stack; // Tailwind font-display/sans/mono utility path
        // Also repoint a NON-standard project var (e.g. --fd) so var-referencing elements swap too.
        if (leaf && !ROLE_VAR_SET.has(leaf) && !(leaf in leafVars)) {
          leafVars[leaf] = stack;
          repointed.push(leaf);
        }
      } else {
        // No Tailwind: the project's own var IS the only seam — repoint whatever it reads, even a
        // role-token-named one (there's no @theme here to cover it).
        if (leaf && !(leaf in leafVars)) {
          leafVars[leaf] = stack;
          repointed.push(leaf);
        } else if (!leaf) {
          unrouted.push(role); // no var found for this role on a non-Tailwind project — can't route it
        }
      }
    }

    const before = readFileSync(cssPath, "utf8");
    const after = composeCssEntry(before, { faceCss, roleStacks, leafVars });
    if (after !== before) writeFileSync(cssPath, after);

    const out = readFileSync(cssPath, "utf8");
    if (!FONTLAB_BLOCK.test(out)) throw new Error("verify: fenced font-lab block not present after write");

    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const f of manifest.files) f.appliedSha256 = sha(readFileSync(path.join(projectDir, f.path)));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    return {
      runId,
      mode: "css-entry",
      via: useTheme ? "tailwind-theme" : "css-var",
      direction: selection.direction,
      roles: ["display", "body", "mono"].map((r) => ({ role: r, family: roleFamily[r], mode: "css-entry" })),
      edited: [path.relative(projectDir, cssPath)],
      selfHosted: { dir: `${analysis.staticDir}/fontlab`, fonts: families },
      repointed,
      unrouted,
      backupDir: path.relative(projectDir, backupDir),
      parity: opts.fetch === false ? "structural (fetch skipped)" : "guaranteed (self-hosted woff2 + capsize fallback)",
    };
  } catch (e) {
    restore(projectDir, backupDir);
    throw new Error(`css-entry apply aborted (${e.message}); restored from backup`);
  }
}

export async function applySelection(projectDir, opts = {}) {
  const selPath = path.join(projectDir, ".font-lab", "selection.json");
  if (!existsSync(selPath)) throw new Error(`no selection at ${selPath} — pick one first`);
  let selection;
  try {
    selection = JSON.parse(readFileSync(selPath, "utf8"));
  } catch (e) {
    throw new Error(`selection.json is not valid JSON (${e.message}) — re-pick, or fix ${selPath}`);
  }
  // Agents sometimes hand-write this file; a wrong shape must fail with the fix, not a stack trace.
  const missingRoles = ["display", "body", "mono"].filter((r) => typeof selection?.roles?.[r]?.family !== "string");
  if (missingRoles.length)
    throw new Error(
      `selection.json missing roles.{${missingRoles.join(", ")}}.family — expected shape: ` +
        `{ roles: { display: { family, weights }, body: {…}, mono: {…} } } (font_lab_select and the panel write this)`,
    );

  // The analyzer picks the branch; codegen never re-guesses.
  const analysis = analyzeProject(projectDir);

  // Every apply is a source write — log it so "what do I commit?" has an answer at session end.
  const logApplied = (r) => {
    appendSourceEdit(projectDir, { kind: "font-apply", files: r.edited, runId: r.runId, detail: r.direction?.name ? `direction "${r.direction.name}"` : undefined });
    return r;
  };

  // Framework-agnostic CSS-entry branch (TanStack/Vite/Astro/… on Tailwind v4, no next/font).
  if (analysis.applyMode === "css-entry") {
    const cssPath = analysis.cssFile ? path.join(projectDir, analysis.cssFile) : null;
    if (!cssPath || !existsSync(cssPath)) throw new Error("css-entry apply: no CSS entry resolved");
    return logApplied(await applyCssEntry(projectDir, selection, analysis, cssPath, opts));
  }

  if (analysis.applyMode !== "next-font")
    throw new Error(`project not supported by codegen yet: ${analysis.reasons.join("; ")}`);

  // next/font branch — Next App Router. Use the exact files the analyzer resolved (route-group
  // root layouts and non-standard CSS entry names live outside resolveTargets' conventional list).
  const layout = analysis.declarationFile ? path.join(projectDir, analysis.declarationFile) : null;
  const css = analysis.cssFile ? path.join(projectDir, analysis.cssFile) : null;
  if (!layout || !css || !existsSync(layout) || !existsSync(css)) {
    const t = resolveTargets(projectDir);
    return logApplied(await applyResolved(projectDir, selection, analysis, t.layout, t.css));
  }
  return logApplied(await applyResolved(projectDir, selection, analysis, layout, css));
}

async function applyResolved(projectDir, selection, analysis, layout, css) {
  const classTarget = analysis.classNameTarget || "html";

  // Resolve every family to a buildable source FIRST — a refusal here costs nothing;
  // discovering an unknown font at `next build` costs the user their deploy.
  const families = ["display", "body", "mono"].map((r) => selection.roles[r].family);
  const { info: shipInfo, localFiles } = await resolveShipInfo(projectDir, analysis, layout, families);
  const roles = planRoles(selection, analysis, shipInfo);

  const { dir: backupDir, runId } = backup(projectDir, [layout, css]);

  // 1) AST edits (import + className + replace/adopt consts), then save.
  const project = new Project({ manipulationSettings: { quoteKind: QuoteKind.Double, useTrailingCommas: false } });
  const sf = project.addSourceFileAtPath(layout);
  const { replaced } = editLayoutAst(sf, roles, classTarget);
  sf.saveSync();

  // 2) Fenced const block (text) + the CSS @theme block — role-var roles only.
  writeFileSync(layout, setFencedConsts(readFileSync(layout, "utf8"), roles));
  editCss(css, roles);

  // 3) Verify; on failure restore the backup so the tree is never left half-edited.
  try {
    const vsf = new Project().addSourceFileAtPath(layout);
    verifyLayout(vsf, roles, classTarget);
  } catch (e) {
    restore(projectDir, backupDir);
    throw new Error(`apply aborted (${e.message}); restored from backup`);
  }

  // 4) Record post-apply hashes so undo can warn if the user edited since.
  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const f of manifest.files) f.appliedSha256 = sha(readFileSync(path.join(projectDir, f.path)));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    runId,
    mode: "next-font",
    direction: selection.direction,
    roles: roles.map((r) => ({ role: r.role, family: r.family, mode: r.mode })),
    replaced,
    classTarget,
    edited: [path.relative(projectDir, layout), path.relative(projectDir, css)],
    selfHosted: localFiles, // woff2 copied into the source tree for next/font/local roles
    backupDir: path.relative(projectDir, backupDir),
    verify: "structure verified; run the project's build (e.g. `next build`) to confirm before deploying",
  };
}

// Rewire dead roles — fix a role the analyzer flags as declared-but-not-rendered. Under
// Tailwind v4 `@theme inline`, a hand-written `font-family: var(--font-display)` resolves to
// nothing (the theme var isn't published to :root). The fix: point those raw usages at the
// PUBLISHED leaf var the next/font const actually sets (e.g. var(--font-bricolage)), which is
// inherited wherever the font is used. Minimal, backup-first, reversible — and it makes both
// the live preview and the shipped swap visible on that role. Opt-in (we never auto-edit a
// user's base styles during a normal apply).
export function rewireCoverage(projectDir) {
  const analysis = analyzeProject(projectDir);
  const dead = analysis.coverage?.deadRoles || [];
  const { css } = resolveTargets(projectDir);
  if (!dead.length) return { rewired: [], dead, note: "no dead roles to rewire" };

  // protect @theme blocks (their `--font-display: var(--font-x)` definitions stay as-is)
  let text = readFileSync(css, "utf8");
  const blocks = [];
  let work = text.replace(/@theme(\s+inline)?\s*\{[^}]*\}/g, (m) => `__FLTHEME${blocks.push(m) - 1}__`);

  const rewired = [];
  for (const role of dead) {
    const roleVar = ROLE_VARS[role];
    const leaf = analysis.roles[role]?.nextFontVar;
    if (!leaf) continue;
    let n = 0;
    work = work.replace(new RegExp(`var\\(\\s*${roleVar}\\s*\\)`, "g"), () => (n++, `var(${leaf})`));
    if (n) rewired.push({ role, from: roleVar, to: leaf, count: n });
  }
  work = work.replace(/__FLTHEME(\d+)__/g, (_, i) => blocks[Number(i)]);
  if (!rewired.length) return { rewired: [], dead, note: "dead roles found, but no raw var() usages to rewire" };

  const { dir: backupDir, runId } = backup(projectDir, [css]);
  writeFileSync(css, work);
  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const f of manifest.files) f.appliedSha256 = sha(readFileSync(path.join(projectDir, f.path)));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const edited = [path.relative(projectDir, css)];
  appendSourceEdit(projectDir, { kind: "rewire", files: edited, runId, detail: rewired.map((r) => r.role).join(", ") });
  return { runId, rewired, edited, backupDir: path.relative(projectDir, backupDir) };
}

export function undo(projectDir) {
  const flDir = path.join(projectDir, ".font-lab");
  const latest = path.join(flDir, "backups", "latest.txt");
  if (!existsSync(latest)) throw new Error("nothing to undo (no backups)");
  const runId = readFileSync(latest, "utf8").trim();
  const dir = path.join(flDir, "backups", runId);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const warnings = [];
  for (const f of manifest.files) {
    const target = path.join(projectDir, f.path);
    if (f.appliedSha256 && existsSync(target) && sha(readFileSync(target)) !== f.appliedSha256) {
      warnings.push(`${f.path} was modified since apply — restoring anyway`);
    }
  }
  restore(projectDir, dir);
  const restored = manifest.files.map((f) => f.path);
  // An undo rewrites the files too — log it, and let `git diff` judge what's back at HEAD.
  appendSourceEdit(projectDir, { kind: "undo-apply", files: restored, runId });
  return { runId, restored, warnings };
}
