// Deterministic, headless proof of the WRITE-BACK half. No browser, no server — just:
// "given a target (by string or by location), do we edit the right source literal,
// reversibly, and refuse the cases we must refuse?"  Run: node edit-codegen.test.mjs

import { applyEdit, undoEdit, resolveTarget, findPhrase } from "./edit-codegen.mjs";
import { Project } from "ts-morph";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name} ${extra}`))); };

// Each test runs in a throwaway copy of the fixture under app/ so backups/undo are isolated.
function freshProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "fl-text-"));
  mkdirSync(path.join(dir, "app"), { recursive: true });
  copyFileSync(path.join(here, "fixtures", "Sample.tsx"), path.join(dir, "app", "Sample.tsx"));
  return dir;
}
const FILE = "app/Sample.tsx";
const read = (dir) => readFileSync(path.join(dir, FILE), "utf8");
const sfOf = (dir) => new Project().addSourceFileAtPath(path.join(dir, FILE));

console.log("\nWRITE-BACK ENGINE\n");

// 1) Edit plain JSX text by exact string (unique) — the happy path.
{
  const dir = freshProject();
  const r = applyEdit(dir, { file: FILE, oldText: "The moment of choice is the only part that needed you.", newText: "Taste is the only part that needed you." });
  ok("edit unique JSX text by string", r.ok && read(dir).includes("Taste is the only part that needed you."), JSON.stringify(r));
  ok("  original text is gone", !read(dir).includes("The moment of choice is the only part"));
  const u = undoEdit(dir);
  ok("  undo restores byte-for-byte", read(dir) === readFileSync(path.join(here, "fixtures", "Sample.tsx"), "utf8"), JSON.stringify(u));
  rmSync(dir, { recursive: true, force: true });
}

// 2) Edit a string-literal JSX expression: <h2>{"..."}</h2>
{
  const dir = freshProject();
  const r = applyEdit(dir, { file: FILE, oldText: "What you see is what you ship", newText: "Preview equals ship" });
  ok("edit string-literal JSX expr", r.ok && r.kind === "jsxexpr-string" && read(dir).includes('"Preview equals ship"'), JSON.stringify(r));
  rmSync(dir, { recursive: true, force: true });
}

// 3) DUPLICATE phrase: string-only is ambiguous and must REFUSE (not guess).
{
  const dir = freshProject();
  const r = applyEdit(dir, { file: FILE, oldText: "Good design is the presence of a decision.", newText: "X" });
  ok("duplicate phrase by string is refused", !r.ok && /ambiguous/.test(r.error), JSON.stringify(r));
  ok("  refusal lists candidate lines", Array.isArray(r.candidates) && r.candidates.length === 2);
  rmSync(dir, { recursive: true, force: true });
}

// 4) DUPLICATE phrase resolved by LOCATION — the exact-mapping payoff.
{
  const dir = freshProject();
  // find the two duplicate lines, edit ONLY the second one by its location.
  const hits = findPhrase(dir, "Good design is the presence of a decision.");
  ok("findPhrase locates both duplicates", hits.length === 2, JSON.stringify(hits));
  const second = hits[1];
  const r = applyEdit(dir, { file: FILE, line: second.line, newText: "Good design is the presence of a SECOND decision." });
  const lines = read(dir).split("\n");
  ok("location edit hits the right one", r.ok && lines[second.line - 1].includes("SECOND"), JSON.stringify(r));
  ok("  the other duplicate is untouched", read(dir).match(/presence of a decision\./g)?.length === 1);
  rmSync(dir, { recursive: true, force: true });
}

// 5) Per-segment edit of text interleaved with inline markup (<code>Inter</code>).
{
  const dir = freshProject();
  const r = applyEdit(dir, { file: FILE, oldText: "A page set in", newText: "A site set in" });
  ok("edit text segment beside inline markup", r.ok && read(dir).includes("A site set in <code>Inter</code>"), JSON.stringify(r));
  rmSync(dir, { recursive: true, force: true });
}

// 6) Dynamic text must NOT be matchable — the honest ceiling.
{
  const dir = freshProject();
  const sf = sfOf(dir);
  const dyn1 = resolveTarget(sf, { oldText: "title" });
  const dyn2 = resolveTarget(sf, { oldText: "hero.subtitle" });
  ok("dynamic {title} is not an editable text node", !!dyn1.error, JSON.stringify(dyn1));
  // hero.subtitle is a string literal but it's an ARG to t(), not JSX text -> not matched
  ok("i18n key inside t() is not matched", !!dyn2.error, JSON.stringify(dyn2));
  rmSync(dir, { recursive: true, force: true });
}

// 7) verify-on-failure leaves the tree untouched (simulate by targeting a missing string).
{
  const dir = freshProject();
  const orig = read(dir);
  const r = applyEdit(dir, { file: FILE, oldText: "this string does not exist anywhere", newText: "x" });
  ok("missing target is refused, file untouched", !r.ok && read(dir) === orig, JSON.stringify(r));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail ? "✗" : "✓"} write-back: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
