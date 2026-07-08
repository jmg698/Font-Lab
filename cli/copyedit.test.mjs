// Unit coverage for the copy-edit write-back's field-robustness seams. The engine's core
// (resolve/apply/undo/refuse) is proven headlessly in spike/text-edit/edit-codegen.test.mjs;
// this file guards the parts that vary by the target repo we're injected into — chiefly the
// source-map path shapes different bundlers emit, and the HTML-entity gap between what's in
// source (what&apos;s) and the rendered words the panel reads back (what's). Run: node copyedit.test.mjs

import { normalizeSourcePath, decodeEntities, encodeJsxText, applyEdit, findPhrase, undoEdit, resolveTarget } from "./copyedit.mjs";
import { Project } from "ts-morph";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const eq = (name, got, want) =>
  got === want ? (pass++, console.log(`  ✓ ${name}`))
               : (fail++, console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`));
const ok = (name, cond, extra = "") =>
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}  ${extra}`));

console.log("\nnormalizeSourcePath — source-map URL shapes seen across bundlers\n");

// The reported bug: a space in the project folder arrives percent-encoded, so existsSync()
// missed the file and every edit reverted.
eq("Turbopack project-relative", normalizeSourcePath("[project]/src/app/page.tsx"), "src/app/page.tsx");
eq("percent-encoded space decodes (the reported bug)", normalizeSourcePath("[project]/Artificial%20Insight/src/app/page.tsx"), "Artificial Insight/src/app/page.tsx");
eq("percent-encoded non-ASCII decodes", normalizeSourcePath("[project]/caf%C3%A9/app/page.tsx"), "café/app/page.tsx");

// Other bundlers Font Lab may be injected alongside.
eq("file:// absolute (with encoded space)", normalizeSourcePath("file:///Users/jack/My%20Site/app/page.tsx"), "/Users/jack/My Site/app/page.tsx");
eq("webpack:// (Next/CRA dev)", normalizeSourcePath("webpack://_N_E/./app/page.tsx"), "app/page.tsx");
eq("webpack-internal:// with runtime tag", normalizeSourcePath("webpack-internal:///(app-pages-browser)/./app/page.tsx"), "app/page.tsx");
eq("turbopack:// protocol form", normalizeSourcePath("turbopack://[project]/app/page.tsx"), "app/page.tsx");
eq("Vite /@fs absolute", normalizeSourcePath("/@fs/Users/jack/site/src/App.tsx"), "/Users/jack/site/src/App.tsx");
eq("leading ./ collapses", normalizeSourcePath("./src/app/page.tsx"), "src/app/page.tsx");

// Must NOT mangle an already-clean path — normalization has to be safe on the common case.
eq("clean absolute path untouched", normalizeSourcePath("/Users/jack/site/app/page.tsx"), "/Users/jack/site/app/page.tsx");
eq("clean relative path untouched", normalizeSourcePath("src/app/page.tsx"), "src/app/page.tsx");

console.log("\nHTML entities — the gap between source (what&apos;s) and rendered words (what's)\n");

// Decode: what a browser (and el.textContent) does to JSX text before the panel ever sees it.
eq("&apos; decodes", decodeEntities("what&apos;s"), "what's");
eq("&amp; &lt; &gt; &quot; decode", decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot;"), `a & b <c> "d"`);
eq("numeric decimal &#39; decodes", decodeEntities("it&#39;s"), "it's");
eq("numeric hex &#x27; decodes", decodeEntities("it&#x27;s"), "it's");
eq("uppercase-X numeric hex &#X27; decodes (valid per spec)", decodeEntities("it&#X27;s"), "it's");
eq("lone-surrogate numeric ref left verbatim (no invalid UTF-16)", decodeEntities("a&#xD800;b"), "a&#xD800;b");
eq("prose entities &mdash; &hellip; decode", decodeEntities("a&mdash;b&hellip;c"), "a—b…c");
eq("single-pass: &amp;apos; stays literal &apos; (browser shows it, we don't over-decode)", decodeEntities("x&amp;apos;y"), "x&apos;y");
eq("unknown entity is left verbatim (soft-degrade, never mis-decode)", decodeEntities("a&fooble;b"), "a&fooble;b");
eq("out-of-range numeric ref is left verbatim", decodeEntities("a&#xFFFFFFFF;b"), "a&#xFFFFFFFF;b");

// Encode: what we write BACK, so a retype is valid JSX text and matches the file's entity style.
eq("apostrophe re-encodes to &apos; (round-trips, lint-safe)", encodeJsxText("what's"), "what&apos;s");
eq("< { & MUST encode (else the parse corrupts); > } \" too", encodeJsxText(`a<b{c}&d>e"f'g`), `a&lt;b&#123;c&#125;&amp;d&gt;e&quot;f&apos;g`);
eq("decode∘encode is identity on rendered text", decodeEntities(encodeJsxText(`Tom & "Jerry" <ok> it's {x}`)), `Tom & "Jerry" <ok> it's {x}`);

console.log("\nend-to-end — the reported bug: an entity-encoded line, duplicated across two pages\n");

// The exact shape from the report: "…what&apos;s real and what&apos;s vaporware." on two pages.
const SRC_LINE = `Really understand AI in banking: what&apos;s real and what&apos;s vaporware.`;
const RENDERED = `Really understand AI in banking: what's real and what's vaporware.`;
function reproProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "fl-entity-"));
  mkdirSync(path.join(dir, "src/app/how-it-works"), { recursive: true });
  const page = (tag) => `export default function P() {\n  return (\n    <${tag}>\n      <p className="text-sm text-muted-foreground">\n        ${SRC_LINE}\n      </p>\n    </${tag}>\n  );\n}\n`;
  writeFileSync(path.join(dir, "src/app/page.tsx"), page("main"));
  writeFileSync(path.join(dir, "src/app/how-it-works/page.tsx"), page("section"));
  return dir;
}
const readHome = (d) => readFileSync(path.join(d, "src/app/page.tsx"), "utf8");
const readHow = (d) => readFileSync(path.join(d, "src/app/how-it-works/page.tsx"), "utf8");
const lineOf = (src, needle) => src.split("\n").findIndex((l) => l.includes(needle)) + 1;

{
  const dir = reproProject();
  ok("findPhrase now locates the DECODED phrase (0 before the fix → the reported error)", findPhrase(dir, RENDERED).length === 2);
  // The panel's resolved call-site pins the home page's <p>. Edit through it.
  const r = applyEdit(dir, { file: "src/app/page.tsx", line: lineOf(readHome(dir), "what&apos;s"), col: 6, oldText: RENDERED, newText: "Really understand AI in banking: what's hype and what's real." });
  ok("the entity line SAVES via the resolved frame", r.ok, JSON.stringify(r));
  ok("  home page updated, apostrophes re-encoded to &apos;", readHome(dir).includes("what&apos;s hype and what&apos;s real."));
  ok("  no raw apostrophe leaked into source (lint-safe)", !readHome(dir).includes("what's hype"));
  ok("  the how-it-works duplicate is UNTOUCHED (the frame disambiguated across files)", readHow(dir).includes(SRC_LINE) && !readHow(dir).includes("hype"));
  rmSync(dir, { recursive: true, force: true });
}
{
  // Special characters a human might type into JSX text must land safely (encoded), not corrupt.
  const dir = reproProject();
  const typed = `A < B & "C" it's {x} > done`;
  const r = applyEdit(dir, { file: "src/app/page.tsx", line: lineOf(readHome(dir), "what&apos;s"), col: 6, oldText: RENDERED, newText: typed });
  ok("special chars (< { & \" ' > }) encode and verify instead of breaking the parse", r.ok, JSON.stringify(r));
  ok("  re-parsing round-trips to exactly the typed words", !!resolveTarget(new Project().addSourceFileAtPath(path.join(dir, "src/app/page.tsx")), { oldText: typed }).hit);
  rmSync(dir, { recursive: true, force: true });
}
{
  // Undo must still restore the entity line byte-for-byte (backup machinery unchanged).
  const dir = reproProject();
  const before = readHome(dir);
  applyEdit(dir, { file: "src/app/page.tsx", line: lineOf(readHome(dir), "what&apos;s"), col: 6, oldText: RENDERED, newText: "Completely new copy." });
  undoEdit(dir);
  ok("undo restores the entity line byte-for-byte", readHome(dir) === before);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\ninline markup — a bare run edits without disturbing its <br/>/<em> siblings\n");

// The panel's per-run editing (font-lab-panel.tsx) sends the run's nearest ELEMENT call-site plus the
// run's OWN words, so a headline carrying inline markup is no longer un-editable — each run maps to one
// JsxText node. This guards that server contract against regressions.
{
  const dir = mkdtempSync(path.join(tmpdir(), "fl-runs-"));
  mkdirSync(path.join(dir, "app"), { recursive: true });
  // The real jack-mcgovern.com hero: a bare text run beside a <br/> and an <em> run.
  const HERO =
    `export default function Hero() {\n  return (\n    <h1 className="hero">\n` +
    `      You pick the type.\n      <br />\n      <em>Your agent ships it.</em>\n    </h1>\n  );\n}\n`;
  const file = path.join(dir, "app/page.tsx");
  writeFileSync(file, HERO);
  const read = () => readFileSync(file, "utf8");
  const lineOf2 = (needle) => read().split("\n").findIndex((l) => l.includes(needle)) + 1;

  const r1 = applyEdit(dir, { file: "app/page.tsx", line: lineOf2("<h1"), col: 4, oldText: "You pick the type.", newText: "You choose the type." });
  ok("bare run inside <h1> saves via the element frame + its own oldText", r1.ok, JSON.stringify(r1));
  ok("  only the bare run changed", read().includes("You choose the type."));
  ok("  the <br/> sibling is preserved", read().includes("<br />"));
  ok("  the <em> sibling is untouched", read().includes("<em>Your agent ships it.</em>"));

  const r2 = applyEdit(dir, { file: "app/page.tsx", line: lineOf2("<em>"), col: 6, oldText: "Your agent ships it.", newText: "Your agent writes it." });
  ok("the <em> run edits independently, leaving the h1 run intact",
    r2.ok && read().includes("Your agent writes it.") && read().includes("You choose the type."));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail ? "✗" : "✓"} copyedit: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
