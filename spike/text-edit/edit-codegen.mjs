// Text-edit spike — the WRITE-BACK half (Node-side, deterministic, fully testable headless).
//
// This is the moat half of click-to-edit-copy: turn "a human edited the rendered words"
// into an exact, reversible source edit. It deliberately mirrors the production font
// codegen (cli/codegen.mjs): ts-morph for the AST-sensitive bit, backup-first undo that
// needs nothing of the user (no clean tree, no git), and a verify step that restores on
// failure so the tree is never left half-edited.
//
// We resolve a clicked node to a source string literal two ways, in priority order:
//   1. LOCATION  — { file, line, col } from the browser (React fiber `_debugSource`, if the
//      stack exposes it). We find the JSX element at that position and edit its text child.
//      This is exact: it survives duplicate strings, because we know WHICH element.
//   2. STRING    — { oldText } only. We scan JSX text/attribute literals for an exact trimmed
//      match. Simple, zero-config, but ambiguous when the same words appear twice — we report
//      the ambiguity rather than guessing (soft-degrade, never silently edit the wrong line).
//
// A node's editable text is one of:
//   • a JsxText child            (<h1>Hello</h1>)
//   • a string-literal JSX expr  (<h1>{"Hello"}</h1>)
// Dynamic text ({post.title}, {t('k')}, a .map) is intentionally NOT matched — that's the
// honest ceiling; the browser side marks those nodes non-editable.

import { Project, Node, SyntaxKind } from "ts-morph";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (s) => s.replace(/\s+/g, " ").trim();

// ---- locating the editable text node ---------------------------------------

// Every JsxText / string-literal child that carries human-visible words, with the trimmed
// text and a setter that rewrites it while preserving the original surrounding whitespace.
function editableTextNodes(sf) {
  const out = [];
  for (const t of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const raw = t.getText();
    const text = norm(raw);
    if (!text) continue; // whitespace-only formatting node
    out.push({
      node: t,
      kind: "jsxtext",
      text,
      line: t.getStartLineNumber(),
      setText: (next) => {
        // keep leading / trailing whitespace, swap the meaningful core
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        t.replaceWithText(lead + next + trail);
      },
    });
  }
  // <h1>{"Hello"}</h1> — a string literal inside a JSX expression container
  for (const lit of [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ]) {
    const parent = lit.getParent();
    if (!parent || !Node.isJsxExpression(parent)) continue;
    out.push({
      node: lit,
      kind: "jsxexpr-string",
      text: norm(lit.getLiteralValue()),
      line: lit.getStartLineNumber(),
      setText: (next) => lit.setLiteralValue(next),
    });
  }
  return out;
}

// The JSX element whose opening tag begins at (line, col). `_debugSource` points at the
// element, not its text, so we then take that element's own editable text child.
function elementAt(sf, line, col) {
  const opens = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  let best = null;
  for (const o of opens) {
    const ln = o.getStartLineNumber();
    if (ln !== line) continue;
    const c = o.getStart() - o.getStartLinePos(); // 0-based column of the `<`
    // Babel/SWC columns are 0-based at the `<`; tolerate ±1 and pick the closest on the line.
    const d = Math.abs(c - col);
    if (!best || d < best.d) best = { el: o.getParent(), d };
  }
  return best?.el ?? null;
}

function textChildrenOf(el, all) {
  // direct text children of this element (not text nested in a child element)
  return all.filter((e) => {
    let p = e.node.getParent();
    // JsxText's parent is the JsxElement; string-expr's parent chain is JsxExpression -> JsxElement
    while (p && !Node.isJsxElement(p) && !Node.isJsxFragment(p)) p = p.getParent();
    return p === el;
  });
}

// ---- backups (same shape as cli/codegen.mjs, self-contained for the spike) --

function backup(projectDir, files, runIdSeed) {
  const flDir = path.join(projectDir, ".font-lab");
  const runId = "edit-" + runIdSeed;
  const dir = path.join(flDir, "backups", runId);
  const manifest = { runId, kind: "text-edit", files: [] };
  for (const f of files) {
    const rel = path.relative(projectDir, f);
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(f, dest);
    manifest.files.push({ path: rel, sha256: sha(readFileSync(f)) });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(flDir, "backups", "latest-edit.txt"), runId);
  return { dir, runId };
}

function restore(projectDir, backupDir) {
  const manifest = JSON.parse(readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
  for (const f of manifest.files) copyFileSync(path.join(backupDir, f.path), path.join(projectDir, f.path));
}

// ---- public API ------------------------------------------------------------

// Resolve the single text node an edit refers to. Returns { hit } or { error, candidates }.
export function resolveTarget(sf, { line, col, oldText }) {
  const all = editableTextNodes(sf);
  const want = oldText != null ? norm(oldText) : null;

  if (line != null) {
    const el = elementAt(sf, line, col ?? 0);
    if (!el) return { error: `no JSX element at ${line}:${col}` };
    let kids = textChildrenOf(el, all);
    if (want != null) kids = kids.filter((k) => k.text === want);
    if (kids.length === 1) return { hit: kids[0] };
    if (kids.length === 0) return { error: `element at ${line}:${col} has no editable text matching "${want ?? "(any)"}"` };
    return { error: `ambiguous: ${kids.length} text children at ${line}:${col}`, candidates: kids.map((k) => k.text) };
  }

  if (want != null) {
    const matches = all.filter((k) => k.text === want);
    if (matches.length === 1) return { hit: matches[0] };
    if (matches.length === 0) return { error: `no editable text matches "${want}"` };
    return {
      error: `ambiguous: "${want}" appears ${matches.length}× — need a location to disambiguate`,
      candidates: matches.map((k) => `line ${k.line}`),
    };
  }

  return { error: "need {line} or {oldText}" };
}

// Apply one text edit to one file. backup-first, verify, restore-on-failure.
export function applyEdit(projectDir, { file, line, col, oldText, newText, runIdSeed = "manual" }) {
  if (newText == null) throw new Error("newText is required");
  const abs = path.isAbsolute(file) ? file : path.join(projectDir, file);
  if (!existsSync(abs)) throw new Error(`no such file: ${file}`);

  const project = new Project({ useInMemoryFileSystem: false });
  const sf = project.addSourceFileAtPath(abs);
  const res = resolveTarget(sf, { line, col, oldText });
  if (res.error) return { ok: false, ...res };

  const before = res.hit.text;
  const { dir: backupDir, runId } = backup(projectDir, [abs], runIdSeed);

  res.hit.setText(newText);
  sf.saveSync();

  // verify: re-parse and confirm the new text is present where we expect it.
  const verify = resolveTarget(new Project().addSourceFileAtPath(abs), {
    line,
    col,
    oldText: norm(newText),
  });
  if (verify.error || verify.hit?.text !== norm(newText)) {
    restore(projectDir, backupDir);
    return { ok: false, error: `verify failed (${verify.error ?? "text mismatch"}); restored backup`, runId };
  }

  return {
    ok: true,
    runId,
    file: path.relative(projectDir, abs),
    line: res.hit.line,
    kind: res.hit.kind,
    before,
    after: norm(newText),
    backupDir: path.relative(projectDir, backupDir),
  };
}

export function undoEdit(projectDir) {
  const flDir = path.join(projectDir, ".font-lab");
  const latest = path.join(flDir, "backups", "latest-edit.txt");
  if (!existsSync(latest)) throw new Error("nothing to undo (no text edits)");
  const runId = readFileSync(latest, "utf8").trim();
  const dir = path.join(flDir, "backups", runId);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  restore(projectDir, dir);
  return { runId, restored: manifest.files.map((f) => f.path) };
}

// Convenience for the string-search fallback: scan a project's .tsx/.jsx for a phrase, so
// the browser side can ask "is this phrase uniquely locatable?" before committing.
export function findPhrase(projectDir, phrase, dirs = ["app", "src"]) {
  const want = norm(phrase);
  const hits = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === ".next" || name === ".font-lab") continue;
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(tsx|jsx)$/.test(name)) {
        const sf = new Project().addSourceFileAtPath(p);
        for (const k of editableTextNodes(sf)) if (k.text === want) hits.push({ file: path.relative(projectDir, p), line: k.line });
      }
    }
  };
  for (const d of dirs) walk(path.join(projectDir, d));
  return hits;
}
