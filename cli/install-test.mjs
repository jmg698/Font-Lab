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
  writeJsonMcp, removeJsonMcp, writeTomlMcp, removeTomlMcp, writeAgents, removeAgents, agentsBlock,
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
