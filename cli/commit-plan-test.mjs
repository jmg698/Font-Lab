// The commit plan — buildCommitPlan folds Font Lab's edit ledger against REAL git state, so
// "what do I actually commit?" comes back as verified piles + ready-to-run commands, not a
// guess from the log. Covered here: ship classification, the undone-file demotion (logged but
// clean ⇒ never staged), scaffold visibility + the tracked-scaffold `git rm -r --cached` fix,
// the self-ignore actually hiding scaffold from porcelain, install-hook detection, the
// human's-own-work bucket, and the honest no-git degradation. Run: node commit-plan-test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCommitPlan } from "./commit-plan.mjs";
import { appendSourceEdit, ensureSelfIgnoredDir, writeAppliedStamp, ensureFlDir } from "./state.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") =>
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}  ${extra}`));

const git = (dir, ...args) =>
  execFileSync("git", ["-c", "user.name=fl-test", "-c", "user.email=fl@test", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// A tiny committed Next-shaped repo the scenarios mutate.
function seedRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "fl-plan-"));
  mkdirSync(path.join(dir, "app"), { recursive: true });
  writeFileSync(path.join(dir, "app/layout.tsx"), "export default (p) => p.children;\n");
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <h1>hello</h1>;\n");
  writeFileSync(path.join(dir, "app/globals.css"), ":root{}\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return dir;
}

console.log("\nship vs clean — git is the judge, not the ledger\n");
{
  const dir = seedRepo();
  // The session: a copy edit that STUCK, and a font apply that was fully undone.
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <h1>hi there</h1>;\n");
  appendSourceEdit(dir, { kind: "text-edit", files: ["app/page.tsx"], runId: "e1" });
  appendSourceEdit(dir, { kind: "font-apply", files: ["app/globals.css"], runId: "r1" });
  appendSourceEdit(dir, { kind: "undo-apply", files: ["app/globals.css"], runId: "r1" }); // restored byte-identical

  const plan = buildCommitPlan(dir);
  ok("git detected", plan.git.available && plan.git.inRepo);
  ok("the stuck copy edit lands in ship", plan.ship.files.some((f) => f.path === "app/page.tsx"));
  ok("the undone apply is demoted to clean — never staged", plan.clean.files.some((f) => f.path === "app/globals.css") && !plan.ship.files.some((f) => f.path === "app/globals.css"));
  ok("commands carry a ready git add for ship only", plan.commands.some((c) => c.includes("git add -- app/page.tsx")), plan.commands.join(" | "));
  ok("copy-only session gets a copy-edit message", /Copy edits via Font Lab/.test(plan.suggestedMessage || ""), plan.suggestedMessage);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\nan applied pick names the commit\n");
{
  const dir = seedRepo();
  writeFileSync(path.join(dir, "app/globals.css"), ":root{--font-display:x}\n");
  appendSourceEdit(dir, { kind: "font-apply", files: ["app/globals.css"], runId: "r2" });
  ensureFlDir(dir);
  writeFileSync(path.join(dir, ".font-lab", "selection.json"), JSON.stringify({
    pickedAt: "2026-07-19T10:00:00Z",
    direction: { id: "ed", name: "Editorial Contrast" },
    roles: { display: { family: "Fraunces" }, body: { family: "Inter" }, mono: { family: "Spline Sans Mono" } },
  }));
  writeAppliedStamp(dir, { runId: "r2", direction: { id: "ed" } }); // stamp postdates the pick
  const plan = buildCommitPlan(dir);
  ok("suggested message carries direction + families", /Editorial Contrast/.test(plan.suggestedMessage) && /Fraunces \/ Inter/.test(plan.suggestedMessage), plan.suggestedMessage);
  ok("a git commit command is offered (for the HUMAN to run)", plan.commands.some((c) => c.startsWith("git commit -m")));
  rmSync(dir, { recursive: true, force: true });
}

console.log("\nscaffold — self-ignored is invisible; tracked gets the one-time fix\n");
{
  const dir = seedRepo();
  // A self-ignored panel install: dirs exist, git sees nothing.
  ensureSelfIgnoredDir(path.join(dir, "app", "_fontlab"), "dev-panel scaffolding");
  writeFileSync(path.join(dir, "app", "_fontlab", "FontLabDevPanel.tsx"), "// panel\n");
  ensureSelfIgnoredDir(path.join(dir, "public", "fontlab"), "dev-panel scaffolding");
  writeFileSync(path.join(dir, "public", "fontlab", "fraunces.woff2"), "woff2");
  appendSourceEdit(dir, { kind: "scaffold", files: ["app/_fontlab/FontLabDevPanel.tsx", "public/fontlab/"] });

  const plan = buildCommitPlan(dir);
  ok("scaffold dirs reported present", plan.scaffold.dirs.includes("app/_fontlab") && plan.scaffold.dirs.includes("public/fontlab"));
  ok("both read as self-ignored", plan.scaffold.selfIgnored.length === 2);
  ok("git porcelain shows NO scaffold (the whole point)", plan.scaffold.visibleInGit.length === 0, JSON.stringify(plan.scaffold.visibleInGit));
  ok("scaffold never contaminates ship", !plan.ship.files.some((f) => f.path.includes("_fontlab") || f.path.includes("public/fontlab")));
  ok("no tracked-scaffold fix needed", plan.scaffold.tracked === null);
  rmSync(dir, { recursive: true, force: true });
}

console.log("\na repo that predates the self-ignore — tracked scaffold gets git rm --cached\n");
{
  const dir = seedRepo();
  mkdirSync(path.join(dir, "app", "_fontlab"), { recursive: true });
  writeFileSync(path.join(dir, "app", "_fontlab", "FontLabDevPanel.tsx"), "// old panel\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "committed the scaffold back in the day");
  const plan = buildCommitPlan(dir);
  ok("tracked scaffold detected", plan.scaffold.tracked?.roots.includes("app/_fontlab"), JSON.stringify(plan.scaffold.tracked));
  ok("the fix is the one-time git rm -r --cached", /git rm -r --cached -- app\/_fontlab/.test(plan.scaffold.tracked?.fix || ""));
  ok("the fix leads the command list", /git rm -r --cached/.test(plan.commands[0] || ""));
  rmSync(dir, { recursive: true, force: true });
}

console.log("\ninstall hooks + the human's own work — named, never staged\n");
{
  const dir = seedRepo();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { "font-lab": { command: "npx" } } }, null, 2));
  writeFileSync(path.join(dir, "AGENTS.md"), "<!-- font-lab:start -->\nfont lab block\n<!-- font-lab:end -->\n");
  writeFileSync(path.join(dir, "app/unrelated.ts"), "export const theirOwnWork = 1;\n"); // the human's parallel edit
  const plan = buildCommitPlan(dir);
  ok("install hooks recognized by OUR markers", plan.installHooks.files.some((f) => f.path === ".mcp.json") && plan.installHooks.files.some((f) => f.path === "AGENTS.md"));
  ok("the human's own dirty file lands in notFontLab", plan.notFontLab.files.includes("app/unrelated.ts"), JSON.stringify(plan.notFontLab.files));
  ok("  and is never in ship or the commands", !plan.ship.files.some((f) => f.path === "app/unrelated.ts") && !plan.commands.join(" ").includes("unrelated"));
  rmSync(dir, { recursive: true, force: true });
}

console.log("\na monorepo subdir project — porcelain's root-relative paths are re-based\n");
{
  const root = mkdtempSync(path.join(tmpdir(), "fl-plan-mono-"));
  const dir = path.join(root, "packages", "web");
  mkdirSync(path.join(dir, "app"), { recursive: true });
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <h1>hello</h1>;\n");
  writeFileSync(path.join(root, "packages", "other.ts"), "export const sibling = 1;\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <h1>hi</h1>;\n"); // the human's edit
  writeFileSync(path.join(root, "packages", "other.ts"), "export const sibling = 2;\n"); // a sibling package's edit
  appendSourceEdit(dir, { kind: "text-edit", files: ["app/page.tsx"], runId: "m1" });

  const plan = buildCommitPlan(dir);
  ok("the project-relative ledger path matches root-relative porcelain", plan.ship.files.some((f) => f.path === "app/page.tsx"), JSON.stringify(plan.ship.files));
  ok("  (never wrongly demoted to clean)", !plan.clean.files.some((f) => f.path === "app/page.tsx"));
  ok("a sibling package's dirty file is out of scope, not 'notFontLab'", !plan.notFontLab.files.some((p) => p.includes("other.ts")), JSON.stringify(plan.notFontLab.files));
  rmSync(root, { recursive: true, force: true });
}

console.log("\nno git — the plan degrades honestly to the ledger\n");
{
  const dir = mkdtempSync(path.join(tmpdir(), "fl-plan-nogit-"));
  mkdirSync(path.join(dir, "app"), { recursive: true });
  writeFileSync(path.join(dir, "app/page.tsx"), "x\n");
  appendSourceEdit(dir, { kind: "text-edit", files: ["app/page.tsx"], runId: "e9" });
  const plan = buildCommitPlan(dir);
  ok("says it's not a repo", plan.git.inRepo === false && /edit log alone/.test(plan.git.note || ""), JSON.stringify(plan.git));
  ok("still classifies from the ledger", plan.ship.files.some((f) => f.path === "app/page.tsx"));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail ? "✗" : "✓"} commit-plan: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
