// Font Lab codegen (M2) — turn .font-lab/selection.json into real, reversible next/font +
// Tailwind edits. Strategy per SHIP-SPEC.md:
//   • ts-morph for the AST-sensitive bits: merge the next/font import, rewrite the <html>
//     className, and remove the font consts we're replacing;
//   • fenced markers for the append-only regions (the generated font consts in layout.tsx
//     and the @theme block in globals.css) — trivially find/replace/remove, so re-apply is
//     byte-idempotent and undo is exact;
//   • backup-first undo that needs nothing of the user (no clean tree, no git).
//
// Scope: the common case — App Router + Tailwind v4, fonts wired through CSS variables.

import { Project, Node, SyntaxKind, QuoteKind } from "ts-morph";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROLE_VARS = { display: "--font-display", body: "--font-sans", mono: "--font-mono" };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const constName = (role) => "fontLab" + cap(role);
const importName = (family) => family.replace(/[^A-Za-z0-9]+/g, "_");
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

// ---- layout.tsx: AST bits (import + className + removing replaced fonts) ----

function getStringProp(obj, name) {
  const p = obj.getProperty(name);
  if (!p || !Node.isPropertyAssignment(p)) return null;
  const init = p.getInitializer();
  if (!init) return null;
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue();
  return init.getText().replace(/^["'`]|["'`]$/g, "");
}

function findHtml(sf) {
  return (
    sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).find((e) => e.getTagNameNode().getText() === "html") ||
    sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).find((e) => e.getTagNameNode().getText() === "html")
  );
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

function editLayoutAst(sf, roles) {
  // 1) ensure the next/font/google import carries our families.
  let imp = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === "next/font/google");
  if (!imp) imp = sf.addImportDeclaration({ moduleSpecifier: "next/font/google", namedImports: [] });
  const named = new Set(imp.getNamedImports().map((n) => n.getName()));
  for (const r of roles) if (!named.has(r.importName)) imp.addNamedImport(r.importName);

  // 2) remove existing *non-Font-Lab* font consts on a role var (the fonts we replace).
  //    Font Lab's own consts live in a fenced block managed as text — never here.
  const roleVarSet = new Set(Object.values(ROLE_VARS));
  const removeNames = [];
  const removedCallees = [];
  const replaced = [];
  for (const vd of sf.getVariableDeclarations()) {
    if (vd.getName().startsWith("fontLab")) continue;
    const init = vd.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const obj = init.getArguments()[0];
    const varVal = obj && Node.isObjectLiteralExpression(obj) ? getStringProp(obj, "variable") : null;
    if (varVal && roleVarSet.has(varVal)) {
      removeNames.push(vd.getName());
      removedCallees.push(init.getExpression().getText());
      replaced.push({ variable: varVal, font: init.getExpression().getText() });
      vd.getVariableStatementOrThrow().remove();
    }
  }

  // 3) merge our variable classes into <html className>, dropping the replaced fonts'.
  const html = findHtml(sf);
  if (!html) throw new Error("no <html> element in layout.tsx");
  const attr = html.getAttribute("className");
  const { dynamic, statics } = classNameTokens(attr);
  const kept = dynamic.filter((d) => !removeNames.some((n) => d === n || d.startsWith(n + ".")));
  for (const r of roles) {
    const token = `${r.constName}.variable`;
    if (!kept.includes(token)) kept.push(token);
  }
  const initText = buildClassNameInit(kept, statics);
  if (attr) attr.setInitializer(initText);
  else html.addAttribute({ name: "className", initializer: initText });

  // 4) drop now-unused imports for replaced fonts — but never a font a role still needs
  //    (the generated fenced consts reference role imports and are added as text later, so
  //    they're invisible to this AST pass).
  const roleImports = new Set(roles.map((r) => r.importName));
  for (const callee of new Set(removedCallees)) {
    if (roleImports.has(callee)) continue;
    const stillUsed = sf
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((id) => id.getText() === callee && !Node.isImportSpecifier(id.getParent()));
    if (!stillUsed) imp.getNamedImports().find((n) => n.getName() === callee)?.remove();
  }

  return { replaced };
}

// ---- layout.tsx: fenced const block (text, idempotent) ---------------------

function setFencedConsts(text, roles) {
  const lines = [
    "// font-lab:start",
    "// generated — re-run `font-lab apply` to update, `font-lab undo` to revert",
    ...roles.map(
      (r) => `const ${r.constName} = ${r.importName}({ subsets: ["latin"], display: "swap", variable: "${r.varName}" });`,
    ),
    "// font-lab:end",
  ];
  const block = lines.join("\n");
  // remove any prior block, then insert a fresh one right after the import region.
  text = text.replace(/\n*\/\/ font-lab:start[\s\S]*?\/\/ font-lab:end\n*/g, "\n\n");
  const importRe = /^import[^\n]*;[ \t]*$/gm;
  let last = 0;
  let m;
  while ((m = importRe.exec(text))) last = m.index + m[0].length;
  const before = text.slice(0, last).replace(/\s*$/, "");
  const after = text.slice(last).replace(/^\s*/, "");
  return `${before}\n\n${block}\n\n${after}`;
}

function verifyLayout(sf, roles) {
  for (const r of roles) {
    if (!sf.getVariableDeclaration(r.constName)) throw new Error(`verify: missing const ${r.constName}`);
  }
  const { dynamic } = classNameTokens(findHtml(sf)?.getAttribute("className"));
  for (const r of roles) {
    if (!dynamic.includes(`${r.constName}.variable`)) throw new Error(`verify: <html> missing ${r.constName}.variable`);
  }
}

// ---- globals.css (fenced markers) ------------------------------------------

function editCss(cssPath) {
  let css = readFileSync(cssPath, "utf8");
  const block = `/* font-lab:start */
@theme inline {
  --font-display: var(--font-display);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}
/* font-lab:end */`;
  const re = /\/\* font-lab:start \*\/[\s\S]*?\/\* font-lab:end \*\//;
  if (re.test(css)) css = css.replace(re, block);
  else if (/@import\s+["']tailwindcss["'];/.test(css)) css = css.replace(/(@import\s+["']tailwindcss["'];\n?)/, `$1\n${block}\n`);
  else css = `${block}\n${css}`;
  writeFileSync(cssPath, css);
}

// ---- backups / apply / undo ------------------------------------------------

function backup(projectDir, files) {
  const flDir = path.join(projectDir, ".font-lab");
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
    manifest.git = execFileSync("git", ["-C", projectDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(flDir, "backups", "latest.txt"), runId);
  return { dir, runId };
}

function restore(projectDir, backupDir) {
  const manifest = JSON.parse(readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
  for (const f of manifest.files) copyFileSync(path.join(backupDir, f.path), path.join(projectDir, f.path));
}

export function applySelection(projectDir) {
  const selPath = path.join(projectDir, ".font-lab", "selection.json");
  if (!existsSync(selPath)) throw new Error(`no selection at ${selPath} — pick one first`);
  const selection = JSON.parse(readFileSync(selPath, "utf8"));
  const { layout, css } = resolveTargets(projectDir);

  const roles = ["display", "body", "mono"].map((role) => ({
    role,
    family: selection.roles[role].family,
    importName: importName(selection.roles[role].family),
    varName: ROLE_VARS[role],
    constName: constName(role),
  }));

  const { dir: backupDir, runId } = backup(projectDir, [layout, css]);

  // 1) AST edits (import + className + remove replaced fonts), then save.
  const project = new Project({ manipulationSettings: { quoteKind: QuoteKind.Double, useTrailingCommas: false } });
  const sf = project.addSourceFileAtPath(layout);
  const { replaced } = editLayoutAst(sf, roles);
  sf.saveSync();

  // 2) Fenced const block (text) + the CSS @theme block.
  writeFileSync(layout, setFencedConsts(readFileSync(layout, "utf8"), roles));
  editCss(css);

  // 3) Verify; on failure restore the backup so the tree is never left half-edited.
  try {
    const vsf = new Project().addSourceFileAtPath(layout);
    verifyLayout(vsf, roles);
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
    direction: selection.direction,
    roles: roles.map((r) => ({ role: r.role, family: r.family })),
    replaced,
    edited: [path.relative(projectDir, layout), path.relative(projectDir, css)],
    backupDir: path.relative(projectDir, backupDir),
  };
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
  return { runId, restored: manifest.files.map((f) => f.path), warnings };
}
