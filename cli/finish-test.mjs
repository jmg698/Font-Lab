// The finishing move, end to end — init leaves a SELF-IGNORING scaffold (git status shows the
// product diff, not the dev tooling), the panel's done ✓ persists like a pick, and
// engine.finish strips the scaffolding + returns the git-verified commit plan; with
// uninstall:true the install wiring goes too. This is the session that used to end in "which
// of these 100 files do I commit?", proven to end clean instead. Run: node finish-test.mjs

// Sandbox HOME before anything imports install.mjs (it binds os.homedir() at module load):
// finish({uninstall:true}) sweeps global MCP configs/skills, and the sweep must hit a throwaway
// HOME, never the real one.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const FAKE_HOME = mkdtempSync(path.join(tmpdir(), "fl-finish-home-"));
process.env.HOME = FAKE_HOME;
delete process.env.CLAUDE_CONFIG_DIR;

const engine = await import("./engine.mjs");
const { writeDoneRequest, readDoneRequest, readScaffoldPrefs } = await import("./state.mjs");

const HERE = path.dirname(fileURLToPath(new URL(import.meta.url)));
const CLEAN = path.join(HERE, "..", "examples", "clean-next-site");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") =>
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}  ${extra}`));

const git = (dir, ...args) =>
  execFileSync("git", ["-c", "user.name=fl-test", "-c", "user.email=fl@test", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function seedProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "fl-finish-"));
  mkdirSync(path.join(dir, "app"), { recursive: true });
  for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) cpSync(path.join(CLEAN, f), path.join(dir, f));
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <h1>hello</h1>;\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return dir;
}
const porcelain = (dir) => git(dir, "status", "--porcelain").split("\n").filter(Boolean);

console.log("\ninit → the scaffold never reaches git status\n");
const dir = seedProject();
const origLayout = readFileSync(path.join(dir, "app/layout.tsx"), "utf8");
await engine.init(dir, { allowFallback: true, fetch: false });
{
  ok("panel scaffolded", existsSync(path.join(dir, "app/_fontlab/FontLabDevPanel.tsx")));
  ok("app/_fontlab born self-ignoring", /^\*$/m.test(readFileSync(path.join(dir, "app/_fontlab/.gitignore"), "utf8")));
  ok("public/fontlab born self-ignoring", /^\*$/m.test(readFileSync(path.join(dir, "public/fontlab/.gitignore"), "utf8")));
  const p = porcelain(dir);
  ok("git status shows NO scaffold dirs, no .font-lab", !p.some((l) => /_fontlab|public\/fontlab|\.font-lab/.test(l)), p.join(" | "));
  ok("  only the layout mount is visible (the one shared-file graft)", p.length === 1 && / app\/layout\.tsx$/.test(p[0]), p.join(" | "));
}

console.log("\nthe panel's done ✓ persists like a pick, and finish consumes it\n");
{
  // The human's session: one copy edit that sticks.
  writeFileSync(path.join(dir, "app/page.tsx"), "export default () => <h1>hi there</h1>;\n");
  const { appendSourceEdit } = await import("./state.mjs");
  appendSourceEdit(dir, { kind: "text-edit", files: ["app/page.tsx"], runId: "e1" });

  writeDoneRequest(dir);
  ok("done pending before finish", !!readDoneRequest(dir));

  const r = await engine.finish(dir);
  ok("finish reports it fulfilled the done request", r.fulfilledDoneRequest === true);
  ok("scaffolding stripped (dirs gone)", !existsSync(path.join(dir, "app/_fontlab")) && !existsSync(path.join(dir, "public/fontlab")));
  ok("layout restored byte-identical (mount out, nothing else touched)", readFileSync(path.join(dir, "app/layout.tsx"), "utf8") === origLayout);
  ok("done request cleared", readDoneRequest(dir) === null);

  const plan = r.commitPlan;
  ok("commit plan rides the finish result", !!plan && plan.git.inRepo);
  ok("  ship = the human's copy edit", plan.ship.files.some((f) => f.path === "app/page.tsx"));
  ok("  layout (mount undone) demoted to clean", plan.clean.files.some((f) => f.path === "app/layout.tsx"), JSON.stringify(plan.clean));
  ok("  scaffold reports unmounted", plan.scaffold.mounted === false && plan.scaffold.dirs.length === 0);
  const p = porcelain(dir);
  ok("git status after finish = the product diff exactly", p.length === 1 && / app\/page\.tsx$/.test(p[0]), p.join(" | "));
}

console.log("\nfinish is idempotent and safe with nothing mounted\n");
{
  const r2 = await engine.finish(dir);
  ok("re-finish is a quiet no-op", r2.finished === true && r2.scaffold.removed?.length === 0 && r2.fulfilledDoneRequest === false, JSON.stringify(r2.scaffold));
}

console.log("\nfinish --uninstall sweeps the project hooks (sandboxed HOME takes the global sweep)\n");
{
  // Re-init, then wire project-scoped install grafts like a real install would.
  await engine.init(dir, { allowFallback: true, fetch: false });
  const install = await import("./install.mjs");
  install.writeJsonMcp(path.join(dir, ".mcp.json"), "mcpServers", { command: "npx", args: ["-y", "font-lab@latest", "mcp"] }, false);
  install.writeAgents(dir, false);
  install.writeCursorRules(dir, false);

  const r = await engine.finish(dir, { uninstall: true });
  ok("scaffolding gone again", !existsSync(path.join(dir, "app/_fontlab")));
  const removed = (r.uninstalled || []).map((x) => x.what);
  ok("uninstall removed the project grafts", removed.includes("mcp[claude]") && removed.includes("agents") && removed.includes("rules"), removed.join(","));
  ok("  .mcp.json gone (we created it, only our entry)", !existsSync(path.join(dir, ".mcp.json")));
  ok("  AGENTS.md gone (ours alone)", !existsSync(path.join(dir, "AGENTS.md")));
  ok("  cursor rules gone", !existsSync(path.join(dir, ".cursor", "rules", "font-lab.mdc")));
  ok("nothing escaped into the sandboxed HOME", !existsSync(path.join(FAKE_HOME, ".claude", "skills", "font-lab")));
}

console.log("\nthe tracked opt-in: init tracked:true lifts the self-ignore, and it persists\n");
{
  const dir2 = seedProject();
  await engine.init(dir2, { allowFallback: true, fetch: false, tracked: true });
  ok("tracked pref persisted", readScaffoldPrefs(dir2)?.tracked === true);
  ok("no self-ignore inside app/_fontlab", !existsSync(path.join(dir2, "app/_fontlab/.gitignore")));
  ok("scaffold IS visible to git (the team's explicit choice)", porcelain(dir2).some((l) => /_fontlab/.test(l)));
  // A later rebuild must respect the choice, not silently re-ignore.
  await engine.preparePreview(dir2, { allowFallback: true, fetch: false });
  ok("a rebuild honors the tracked choice", !existsSync(path.join(dir2, "app/_fontlab/.gitignore")));
  rmSync(dir2, { recursive: true, force: true });
}

rmSync(dir, { recursive: true, force: true });
rmSync(FAKE_HOME, { recursive: true, force: true });

console.log(`\n${fail ? "✗" : "✓"} finish: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
