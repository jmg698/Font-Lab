// Copy edit write-back — promoted from spike/text-edit/edit-codegen.mjs (13/13 tests there).
// Turns "a human retyped the rendered words" into an exact, reversible source edit. Mirrors
// the font codegen's contract: ts-morph for the AST bit, backup-first undo that needs nothing
// of the user (no clean tree, no git), verify-with-restore so the tree is never half-edited.
// Soft-degrade, never guess: dynamic text and ambiguous phrases are refused with reasons.
//
// Served by \`font-lab serve\` as POST /edit + /undo (see font-lab.mjs); the panel's
// double-click-to-retype posts here with the React 19 _debugStack call-site frame.

import { Project, Node, SyntaxKind } from "ts-morph";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (s) => s.replace(/\s+/g, " ").trim();

// ---- HTML character references in JSX text ---------------------------------

// JSX text renders HTML character references exactly like a browser does, so the words the panel
// reads back (element.textContent) are the DECODED form — "what's", not the "what&apos;s" that's
// in source. ts-morph hands us the RAW source text with entities intact, so we must decode before
// comparing, or a perfectly good edit looks like `no editable text matching …` and the panel snaps
// the words back. (String-literal JSX exprs — `{"…"}` — are JS strings, not JSX text; ts-morph's
// getLiteralValue already returns their rendered value, so this only applies to JsxText.)
//
// We decode the prose set a browser would, plus any numeric reference (&#39; / &#x27;). An entity
// we don't recognize is left verbatim — at worst the match softly fails (an honest refusal), never
// a wrong decode. Single-pass, so `&amp;apos;` decodes to the literal `&apos;` (as a browser shows
// it), not to `'`.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  laquo: "«", raquo: "»", times: "×", divide: "÷",
  deg: "°", plusmn: "±", frac12: "½", frac14: "¼",
  frac34: "¾", middot: "·", bull: "•", dagger: "†",
  Dagger: "‡", sect: "§", para: "¶", euro: "€",
  pound: "£", cent: "¢", yen: "¥", ensp: " ",
  emsp: " ", thinsp: " ", shy: "­", prime: "′",
  Prime: "″", minus: "−", not: "¬",
};
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // reject out-of-range and lone surrogates — leave the ref verbatim rather than emit invalid UTF-16
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m;
  });
}

// The inverse, for write-back into a JsxText node. Characters that are syntactically special in
// JSX text ( & < { ) MUST be encoded or we'd corrupt the parse; the rest of React's
// no-unescaped-entities default set ( > " ' } ) we encode too, so a retype never reintroduces a
// lint error into the user's source and an apostrophe round-trips back to the `&apos;` the file
// already used. `&` goes first so we don't double-encode the entities we're introducing.
export function encodeJsxText(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---- locating the editable text node ---------------------------------------

// Every JsxText / string-literal child that carries human-visible words, with the trimmed
// text and a setter that rewrites it while preserving the original surrounding whitespace.
function editableTextNodes(sf) {
  const out = [];
  for (const t of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const raw = t.getText();
    const text = norm(decodeEntities(raw)); // compare against the rendered words, not the source entities
    if (!text) continue; // whitespace-only formatting node
    out.push({
      node: t,
      kind: "jsxtext",
      text,
      line: t.getStartLineNumber(),
      setText: (next) => {
        // keep leading / trailing whitespace, swap the meaningful core (re-encoded so it's valid
        // JSX text and matches the file's existing &apos;/&amp; convention)
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        t.replaceWithText(lead + encodeJsxText(next) + trail);
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

// ---- source-path normalization ---------------------------------------------

// A source map's `source` is a URL emitted by whatever bundler served it, so its shape varies
// by stack — and Font Lab injects into repos we don't control. Normalize the shapes we know to a
// real filesystem path. Anything we don't recognize still falls through to the project-wide
// phrase search in POST /edit, so an unfamiliar bundler degrades gracefully instead of failing.
export function normalizeSourcePath(source) {
  let f = String(source);
  // URLs percent-encode spaces / non-ASCII: ".../Artificial%20Insight/..." — the exact bug that
  // made existsSync() miss and the panel snap words back. Decode to a real path first.
  try { f = decodeURIComponent(f); } catch {}
  f = f
    .replace(/^file:\/\//, "")                              // file:///Users/... -> /Users/...
    .replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, "")  // Next/webpack dev (app|pages) chunks
    .replace(/^webpack:\/\/[^/]*\//, "")                    // webpack://_N_E/./app/... -> ./app/...
    .replace(/^(turbopack|rsc):\/\/(\[project\]\/)?/, "")   // turbopack:// / rsc:// prefixes
    .replace(/^\[project\]\//, "")                          // Turbopack project-relative
    .replace(/^\/@fs\//, "/")                               // Vite absolute (/@fs/Users/...)
    .replace(/^\.\//, "")                                   // leading ./
    .replace(/^\/{2,}/, "/");                               // collapse doubled leading slashes
  return f;
}

// ---- public API ------------------------------------------------------------

// Resolve the single text node an edit refers to. Returns { hit } or { error, candidates }.
export function resolveTarget(sf, { line, col, oldText }) {
  const all = editableTextNodes(sf);
  const want = oldText != null ? norm(oldText) : null;

  // Precise-first: a resolved call-site frame ({line,col}) pins the exact element — the only
  // way to safely disambiguate a phrase that appears more than once. Try it before anything.
  if (line != null) {
    const el = elementAt(sf, line, col ?? 0);
    if (el) {
      const kids = textChildrenOf(el, all);
      const byText = want != null ? kids.filter((k) => k.text === want) : kids;
      if (byText.length === 1) return { hit: byText[0] };
      if (want == null && kids.length > 1)
        return { error: `ambiguous: ${kids.length} text children at ${line}:${col}`, candidates: kids.map((k) => k.text) };
    }
    // Element missing, or found but its text didn't line up (dev source maps drift a column or
    // a line, and React 19 JSX call-site frames can point a tag off). Rather than hard-refuse a
    // good edit — which is what makes the panel snap the words back — fall through to the
    // unique-phrase match below. It still refuses genuine ambiguity, so we degrade, never guess.
  }

  if (want != null) {
    const matches = all.filter((k) => k.text === want);
    if (matches.length === 1) return { hit: matches[0] };
    if (matches.length === 0)
      return { error: line != null ? `no editable text matching "${want}" at or near ${line}:${col ?? 0}` : `no editable text matches "${want}"` };
    return {
      error: `ambiguous: "${want}" appears ${matches.length}× — need a location to disambiguate`,
      candidates: matches.map((k) => `line ${k.line}`),
    };
  }

  return { error: line != null ? `no JSX element at ${line}:${col ?? 0}` : "need {line} or {oldText}" };
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
// the browser side can ask "is this phrase uniquely locatable?" before committing. The default
// roots cover App Router (app), Pages Router (pages), and the usual src/component layouts — an
// absent one is skipped, so widening the net costs nothing where it doesn't apply.
export function findPhrase(projectDir, phrase, dirs = ["app", "src", "pages", "components"]) {
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
