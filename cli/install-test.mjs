// Host-aware installer (D) — verifies the MCP config writers (mcpServers/servers JSON + Codex
// TOML), AGENTS.md emission, idempotency, merge-preservation, and removal. Dependency-free:
//   node cli/install-test.mjs
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeJsonMcp, removeJsonMcp, writeTomlMcp, removeTomlMcp, writeAgents, removeAgents, agentsBlock, mcpEntryFor,
  writeClaudeHook, removeClaudeHook, writeCursorRules, removeCursorRules,
} from "./install.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(path.join(os.tmpdir(), "fl-install-"));
const ENTRY = { command: "npx", args: ["-y", "font-lab", "mcp"] };
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

try {
  // ── mcpServers JSON family (Claude / Cursor / Windsurf / Gemini) ───────────
  const claudeMcp = path.join(TMP, ".mcp.json");
  ok(writeJsonMcp(claudeMcp, "mcpServers", ENTRY, false) === true, "writeJsonMcp creates the file + returns changed");
  let j = JSON.parse(readFileSync(claudeMcp, "utf8"));
  ok(j.mcpServers["font-lab"].command === "npx" && j.mcpServers["font-lab"].args.join(" ") === "-y font-lab mcp", "mcpServers entry has the right command/args");
  ok(writeJsonMcp(claudeMcp, "mcpServers", ENTRY, false) === false, "writeJsonMcp is idempotent (no change on re-run)");

  // preserves a co-existing server
  writeFileSync(claudeMcp, JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2));
  writeJsonMcp(claudeMcp, "mcpServers", ENTRY, false);
  j = JSON.parse(readFileSync(claudeMcp, "utf8"));
  ok(j.mcpServers.other && j.mcpServers["font-lab"], "writeJsonMcp preserves other servers");
  ok(removeJsonMcp(claudeMcp, "mcpServers", false) === true && JSON.parse(readFileSync(claudeMcp, "utf8")).mcpServers.other && !JSON.parse(readFileSync(claudeMcp, "utf8")).mcpServers["font-lab"], "removeJsonMcp drops only our entry, keeps others");

  // a file we created (only our entry) is removed entirely on uninstall
  const lone = path.join(TMP, "lone.json");
  writeJsonMcp(lone, "mcpServers", ENTRY, false);
  removeJsonMcp(lone, "mcpServers", false);
  ok(!existsSync(lone), "removeJsonMcp deletes a file that held only our entry");

  // ── VS Code uses the `servers` key, not `mcpServers` ──────────────────────
  const vscode = path.join(TMP, ".vscode", "mcp.json");
  writeJsonMcp(vscode, "servers", ENTRY, false);
  ok(JSON.parse(readFileSync(vscode, "utf8")).servers["font-lab"], "VS Code writer uses the `servers` key");

  // ── Codex TOML ────────────────────────────────────────────────────────────
  const toml = path.join(TMP, "config.toml");
  writeFileSync(toml, '[other]\nx = 1\n'); // pre-existing section must survive
  ok(writeTomlMcp(toml, ENTRY, false) === true, "writeTomlMcp appends our section");
  let t = readFileSync(toml, "utf8");
  ok(/\[other\]/.test(t) && /\[mcp_servers\.font-lab\]/.test(t) && /command = "npx"/.test(t) && /args = \["-y","font-lab","mcp"\]/.test(t), "TOML keeps [other] and adds a valid [mcp_servers.font-lab]");
  ok(writeTomlMcp(toml, ENTRY, false) === false, "writeTomlMcp is idempotent");
  ok(removeTomlMcp(toml, false) === true && /\[other\]/.test(readFileSync(toml, "utf8")) && !/font-lab/.test(readFileSync(toml, "utf8")), "removeTomlMcp strips only our section, keeps [other]");

  // ── AGENTS.md ─────────────────────────────────────────────────────────────
  const proj = path.join(TMP, "proj");
  mkdirSync(proj, { recursive: true });
  writeFileSync(path.join(proj, "AGENTS.md"), "# My project rules\n\nDo the thing.\n");
  const w = writeAgents(proj, false);
  let ag = readFileSync(w.file, "utf8");
  ok(/# My project rules/.test(ag) && /font_lab_start/.test(ag) && ag.includes("<!-- font-lab:start -->"), "writeAgents appends a fenced block, preserving existing content");
  ok(writeAgents(proj, false).changed === false, "writeAgents is idempotent");
  ok(removeAgents(proj, false) === true && !/font_lab_start/.test(readFileSync(path.join(proj, "AGENTS.md"), "utf8")) && /# My project rules/.test(readFileSync(path.join(proj, "AGENTS.md"), "utf8")), "removeAgents strips our block, keeps the user's content");
  // a created-from-scratch AGENTS.md is removed entirely
  const proj2 = path.join(TMP, "proj2");
  mkdirSync(proj2, { recursive: true });
  writeAgents(proj2, false);
  removeAgents(proj2, false);
  ok(!existsSync(path.join(proj2, "AGENTS.md")), "removeAgents deletes an AGENTS.md it created alone");
  ok(/Start & intake/.test(agentsBlock()) && /human always makes the taste decision/.test(agentsBlock()), "agentsBlock carries the intake + human-picks protocol");

  // ── entry pinning: project-scoped configs pin to node_modules; global → npx @latest ──
  const pinProj = path.join(TMP, "pinproj");
  mkdirSync(path.join(pinProj, "node_modules", "font-lab"), { recursive: true });
  writeFileSync(path.join(pinProj, "node_modules", "font-lab", "mcp.mjs"), "// stub\n");
  const e1 = mcpEntryFor("claude", pinProj, { local: false });
  ok(e1.command === "node" && e1.args[0] === path.join("node_modules", "font-lab", "mcp.mjs"), "project-scoped host + local dep pins to node_modules (npm install IS the MCP upgrade)");
  const e2 = mcpEntryFor("cursor", pinProj, { local: false });
  ok(e2.command === "npx" && e2.args.includes("font-lab@latest"), "global-config host uses npx @latest (re-resolves per session)");
  const e3 = mcpEntryFor("claude", path.join(TMP, "nodep"), { local: false });
  ok(e3.command === "npx" && e3.args.includes("font-lab@latest"), "project host without a local dep falls back to npx @latest");

  // ── TOML re-pin: a changed registration REPLACES the stale section ────────
  const toml2 = path.join(TMP, "repin.toml");
  writeFileSync(toml2, "[other]\nx = 1\n");
  writeTomlMcp(toml2, ENTRY, false);
  const pinned = { command: "node", args: ["node_modules/font-lab/mcp.mjs"] };
  ok(writeTomlMcp(toml2, pinned, false) === true, "writeTomlMcp reports change when the entry differs");
  const t2 = readFileSync(toml2, "utf8");
  ok(/\[other\]/.test(t2) && /node_modules\/font-lab/.test(t2) && !/"-y"/.test(t2), "TOML re-pin replaces the stale block, keeps [other]");
  ok(writeTomlMcp(toml2, pinned, false) === false, "re-pinned TOML is idempotent");

  // ── Claude Code hook (turn-start pick delivery) ───────────────────────────
  const hookProj = path.join(TMP, "hookproj");
  mkdirSync(hookProj, { recursive: true });
  const noPath = writeClaudeHook(hookProj, false, { local: false });
  ok(noPath.file === null && /installed in the project/.test(noPath.skipped), "hook is skipped without a stable script path (no local install)");
  mkdirSync(path.join(hookProj, "node_modules", "font-lab"), { recursive: true });
  writeFileSync(path.join(hookProj, "node_modules", "font-lab", "pending-pick-hook.mjs"), "// stub\n");
  // a user's pre-existing hook must survive our merge
  const settingsFile = path.join(hookProj, ".claude", "settings.json");
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo theirs" }] }] } }, null, 2));
  const hk = writeClaudeHook(hookProj, false, { local: false });
  ok(hk.changed === true, "writeClaudeHook adds our entry");
  let hj = JSON.parse(readFileSync(settingsFile, "utf8"));
  const cmds = hj.hooks.UserPromptSubmit.flatMap((m) => m.hooks).map((h) => h.command);
  ok(cmds.some((c) => c.includes("pending-pick-hook.mjs")) && cmds.includes("echo theirs"), "hook merge keeps the user's own hooks");
  ok(writeClaudeHook(hookProj, false, { local: false }).changed === false, "writeClaudeHook is idempotent");
  ok(removeClaudeHook(hookProj, false) === true, "removeClaudeHook strips our entry");
  hj = JSON.parse(readFileSync(settingsFile, "utf8"));
  ok(hj.hooks.UserPromptSubmit.flatMap((m) => m.hooks).every((h) => !h.command.includes("pending-pick")) && hj.hooks.UserPromptSubmit.length === 1, "removal keeps the user's hooks intact");

  // the hook SCRIPT: prints on a pending pick, silent once applied, never exits non-zero
  const flDir = path.join(hookProj, ".font-lab");
  mkdirSync(flDir, { recursive: true });
  writeFileSync(path.join(flDir, "selection.json"), JSON.stringify({
    pickedAt: new Date().toISOString(),
    direction: { name: "Hook Test" },
    preview: { route: "/", census: [], scope: [{ role: "display", autoShipSeam: null, clusters: [], islands: [] }] },
  }));
  const hookOut = execFileSync("node", [path.join(HERE, "pending-pick-hook.mjs")], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: hookProj } });
  ok(/UNDELIVERED PICK/.test(hookOut) && /Hook Test/.test(hookOut) && /agent wires: display/.test(hookOut), "hook script surfaces the pending pick with scope");
  writeFileSync(path.join(flDir, "applied.json"), JSON.stringify({ at: new Date(Date.now() + 1000).toISOString() }));
  const hookQuiet = execFileSync("node", [path.join(HERE, "pending-pick-hook.mjs")], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: hookProj } });
  ok(hookQuiet.trim() === "", "hook script is silent once the pick is applied");

  // ── Cursor rules file ─────────────────────────────────────────────────────
  const cr = writeCursorRules(hookProj, false);
  ok(cr.changed && /alwaysApply: true/.test(readFileSync(cr.file, "utf8")) && /font_lab_status/.test(readFileSync(cr.file, "utf8")), "cursor rules file written with alwaysApply");
  ok(writeCursorRules(hookProj, false).changed === false, "cursor rules write is idempotent");
  ok(removeCursorRules(hookProj, false) === true && !existsSync(cr.file), "cursor rules removed on uninstall");

  // ── dry-run integration: no writes, lists hosts; bad host errors ──────────
  const out = execFileSync("node", [path.join(HERE, "install.mjs"), "--host", "all", "--project", path.join(TMP, "dry"), "--dry-run"], { encoding: "utf8" });
  ok(/hosts/.test(out) && /Cursor/.test(out) && /Codex/.test(out) && !existsSync(path.join(TMP, "dry", ".mcp.json")), "dry-run --host all lists every host and writes nothing");
  let errored = false;
  try { execFileSync("node", [path.join(HERE, "install.mjs"), "--host", "bogus", "--dry-run"], { encoding: "utf8", stdio: "pipe" }); }
  catch { errored = true; }
  ok(errored, "an unknown --host exits non-zero");

  console.log(`\ninstall: ${pass} checks passed`);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
