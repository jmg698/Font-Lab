// .font-lab hygiene — the state dir is born SELF-IGNORING (a `*` .gitignore inside it keeps
// runtime state out of the human's git diff, without touching their root .gitignore), backups
// stay CAPPED (a copy-editing session writes one backup per saved retype; undo only ever reads
// the run the latest pointer names, so older runs are prunable), and every SOURCE write is
// LOGGED (edits.log.jsonl → sourceChanges) so status can answer "what do I actually commit?".
// Together these are what stop a user reaching "commit my copy edits" and finding 100+
// untracked Font Lab files with no map. Run: node state-test.mjs

import { ensureFlDir, pruneBackups, writeMenuState, BACKUP_KEEP, appendSourceEdit, readSourceChanges, readHandoffState, editLogPath } from "./state.mjs";
import { applyEdit, undoEdit } from "./copyedit.mjs";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") =>
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}  ${extra}`));

const tmpProject = () => mkdtempSync(path.join(tmpdir(), "fl-state-"));

console.log("\nensureFlDir — the dir is born self-ignoring\n");
{
  const dir = tmpProject();
  const fl = ensureFlDir(dir);
  ok("returns the .font-lab path", fl === path.join(dir, ".font-lab"));
  const gi = path.join(fl, ".gitignore");
  ok("writes .font-lab/.gitignore", existsSync(gi));
  ok("  ignoring everything (`*`)", /^\*$/m.test(readFileSync(gi, "utf8")));

  // A .gitignore the human wrote themselves is their opt-out — never clobber it.
  writeFileSync(gi, "backups/\n");
  ensureFlDir(dir);
  ok("a human-customized .gitignore survives re-ensure", readFileSync(gi, "utf8") === "backups/\n");
  rmSync(dir, { recursive: true, force: true });
}

console.log("\nevery state writer heals an existing un-ignored install\n");
{
  const dir = tmpProject();
  // Simulate a pre-self-ignore install: .font-lab exists, no .gitignore (the user's 137-file wall).
  mkdirSync(path.join(dir, ".font-lab"), { recursive: true });
  writeMenuState(dir, { mode: "composed", count: 3 });
  ok("writeMenuState drops the .gitignore into the existing dir", existsSync(path.join(dir, ".font-lab", ".gitignore")));
  rmSync(dir, { recursive: true, force: true });
}

console.log("\npruneBackups — families are trimmed oldest-first, pointers pinned\n");
{
  const dir = tmpProject();
  const backups = path.join(ensureFlDir(dir), "backups");
  mkdirSync(backups, { recursive: true });
  // 25 copy-edit runs + 4 apply runs, with explicit mtimes so age order is deterministic.
  const stamp = (p, minutes) => utimesSync(p, new Date(0), new Date(minutes * 60_000));
  for (let i = 0; i < 25; i++) {
    const d = path.join(backups, `edit-${String(i).padStart(2, "0")}`);
    mkdirSync(d);
    writeFileSync(path.join(d, "manifest.json"), "{}");
    stamp(d, i);
  }
  for (let i = 0; i < 4; i++) {
    const d = path.join(backups, `2026-07-0${i + 1}T00-00-00-000Z`);
    mkdirSync(d);
    stamp(d, 100 + i);
  }
  // Pin the OLDEST edit run via the pointer — it must survive any prune.
  writeFileSync(path.join(backups, "latest-edit.txt"), "edit-00");

  const pruned = pruneBackups(dir, { family: "edit", keep: 5 });
  const left = readdirSync(backups).filter((n) => n.startsWith("edit-")).sort();
  ok("prunes down to `keep` newest edit runs (+ the pinned one)", left.length === 6, `left: ${left.join(",")}`);
  ok("  newest runs survive", ["edit-20", "edit-21", "edit-22", "edit-23", "edit-24"].every((n) => left.includes(n)));
  ok("  the run latest-edit.txt names survives despite being oldest", left.includes("edit-00"));
  ok("  pruned runs reported", pruned.length === 19);
  ok("  apply-family runs untouched by an edit-family prune", readdirSync(backups).filter((n) => n.startsWith("2026-")).length === 4);

  const prunedApply = pruneBackups(dir, { family: "apply", keep: 2 });
  ok("apply family trims independently", prunedApply.length === 2 && readdirSync(backups).filter((n) => n.startsWith("2026-")).length === 2);
  ok("  edit family untouched by an apply-family prune", readdirSync(backups).filter((n) => n.startsWith("edit-")).length === 6);
  ok("a project with no backups dir is a quiet no-op", pruneBackups(tmpProject(), { family: "edit" }).length === 0);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\nthe real seam — a long retype session stays capped and undo still works\n");
{
  const dir = tmpProject();
  mkdirSync(path.join(dir, "app"), { recursive: true });
  const file = path.join(dir, "app/page.tsx");
  writeFileSync(file, `export default function P() {\n  return <h1>draft 0</h1>;\n}\n`);

  const rounds = BACKUP_KEEP + 5;
  for (let i = 1; i <= rounds; i++) {
    const r = applyEdit(dir, { file: "app/page.tsx", oldText: `draft ${i - 1}`, newText: `draft ${i}`, runIdSeed: `t${String(i).padStart(3, "0")}` });
    if (!r.ok) { ok(`edit ${i} applied`, false, r.error); break; }
  }
  const backups = path.join(dir, ".font-lab", "backups");
  const editRuns = readdirSync(backups).filter((n) => n.startsWith("edit-"));
  ok(`${rounds} retypes leave at most BACKUP_KEEP (${BACKUP_KEEP}) edit backups`, editRuns.length <= BACKUP_KEEP, `found ${editRuns.length}`);
  ok("the state dir self-ignored along the way", existsSync(path.join(dir, ".font-lab", ".gitignore")));

  const u = undoEdit(dir);
  ok("undo after pruning still restores the pre-latest text", readFileSync(file, "utf8").includes(`draft ${rounds - 1}`), JSON.stringify(u));
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nedits.log — the tool-side answer to "what do I actually commit?"\n');
{
  const dir = tmpProject();
  appendSourceEdit(dir, { kind: "scaffold", files: ["app/layout.tsx", "app/_fontlab/FontLabDevPanel.tsx"] });
  appendSourceEdit(dir, { kind: "text-edit", files: ["app/page.tsx"], runId: "edit-a", detail: '"a" → "b"' });
  appendSourceEdit(dir, { kind: "font-apply", files: ["app/layout.tsx", "app/globals.css"], runId: "r1" });
  appendSourceEdit(dir, { kind: "text-edit", files: ["app/page.tsx"], runId: "edit-b" });
  const c = readSourceChanges(dir);
  ok("every write counted", c.writes === 4);
  ok("paths dedupe across writes", c.files.length === 4, c.files.map((f) => f.path).join(","));
  ok("most recently touched first", c.files[0].path === "app/page.tsx");
  const layout = c.files.find((f) => f.path === "app/layout.tsx");
  ok("a path carries every kind that wrote it (scaffold + font-apply)",
    !!layout && layout.kinds.includes("scaffold") && layout.kinds.includes("font-apply") && layout.writes === 2);
  ok("the handoff snapshot surfaces sourceChanges (→ /status, font_lab_status)",
    readHandoffState(dir).sourceChanges?.files?.length === 4);
  ok("an empty project reads as no changes, not an error", readSourceChanges(tmpProject()).writes === 0);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\ncopy edits and undos land in the log automatically\n");
{
  const dir = tmpProject();
  mkdirSync(path.join(dir, "app"), { recursive: true });
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <p>hello there</p>;\n");
  const r = applyEdit(dir, { file: "app/page.tsx", oldText: "hello there", newText: "hi there", runIdSeed: "log1" });
  ok("edit applied", r.ok, r.error);
  undoEdit(dir);
  const c = readSourceChanges(dir);
  const page = c.files.find((f) => f.path === path.join("app", "page.tsx"));
  ok("applyEdit logs a text-edit for the file", !!page && page.kinds.includes("text-edit"), JSON.stringify(c.files));
  ok("undoEdit logs too — the file was rewritten either way", !!page && page.kinds.includes("undo-text-edit"));
  ok('the raw log keeps the "before" → "after" session story',
    /hello there.*hi there/.test(readFileSync(editLogPath(dir), "utf8")));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail ? "✗" : "✓"} state: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
