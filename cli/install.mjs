#!/usr/bin/env node
// `font-lab install` — the one-command setup that makes Font Lab self-installing, the way
// `npx impeccable install` works. Two wiring actions, mirroring impeccable's pattern:
//
//   1. Copy the `font-lab` SKILL into the global skills dir (~/.claude/skills/font-lab) so the
//      agent DISCOVERS it in every session — you just say "pick new fonts" and it reaches for it.
//   2. Register the `font-lab` MCP server into the target project's `.mcp.json` so the agent has
//      the font_lab_* tools to actually drive the loop.
//
// Both steps are idempotent (re-running is a no-op) and reversible (`font-lab uninstall`).
//
//   npx font-lab install [--project <dir>] [--no-mcp] [--no-skill] [--local] [--dry-run]
//   npx font-lab uninstall [--project <dir>]
//
// Flags:
//   --project <dir>   project to wire the MCP server into (default: cwd)
//   --no-mcp          skip the .mcp.json registration (skill only)
//   --no-skill        skip the global skill copy (MCP only)
//   --local           register the MCP server as `node <this-checkout>/mcp.mjs` instead of the
//                     published `npx` form — use this to test from a git clone before publishing
//   --skills-dir <d>  override the skills dir (default: $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills)
//   --dry-run         print what would change, write nothing

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

const PKG_NAME = "font-lab"; // single source of truth for the published name
const SKILL_NAME = "font-lab";
const MCP_KEY = "font-lab";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // the `cli/` dir
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);
const rel = (p) => path.relative(process.cwd(), p) || ".";

// ---- shared resolution -----------------------------------------------------

// The SKILL source: bundled inside the package (cli/skill/font-lab, created by `prepack`)
// when installed via npm, or the repo's top-level skill/font-lab when run from a git checkout.
function resolveSkillSource() {
  const candidates = [
    path.join(HERE, "skill", SKILL_NAME),
    path.join(HERE, "..", "skill", SKILL_NAME),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "SKILL.md"))) return c;
  }
  return null;
}

function skillsDir() {
  const override = arg("--skills-dir", null);
  if (override) return path.resolve(override);
  const base = process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), ".claude");
  return path.join(base, "skills");
}

// The command the agent's host will run to launch the MCP server.
//   published (default):  npx -y font-lab mcp
//   --local (dev/test):   node <abs>/cli/mcp.mjs
function mcpServerEntry() {
  if (has("--local")) {
    return { command: "node", args: [path.join(HERE, "mcp.mjs")] };
  }
  return { command: "npx", args: ["-y", PKG_NAME, "mcp"] };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ---- install ---------------------------------------------------------------

export function runInstall() {
  const dry = has("--dry-run");
  const doSkill = !has("--no-skill");
  const doMcp = !has("--no-mcp");
  const project = path.resolve(arg("--project", process.cwd()));
  const tag = dry ? " (dry-run, nothing written)" : "";
  const steps = [];

  console.log(`Font Lab — install${tag}`);

  if (doSkill) {
    const src = resolveSkillSource();
    if (!src) {
      console.error(
        `  ✗ skill source not found (looked in cli/skill/${SKILL_NAME} and ../skill/${SKILL_NAME}).`,
      );
      console.error(`    If you're running from a git clone, run from the repo root; if from npm,`);
      console.error(`    this is a packaging bug (the skill wasn't bundled).`);
      process.exit(1);
    }
    const dest = path.join(skillsDir(), SKILL_NAME);
    if (!dry) {
      mkdirSync(path.dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true }); // clean copy so updates fully replace
      cpSync(src, dest, { recursive: true });
    }
    steps.push(`skill   → ${dest}`);
  }

  if (doMcp) {
    const mcpFile = path.join(project, ".mcp.json");
    const entry = mcpServerEntry();
    const existing = existsSync(mcpFile) ? readJson(mcpFile) || {} : {};
    const servers = existing.mcpServers && typeof existing.mcpServers === "object" ? existing.mcpServers : {};
    const before = JSON.stringify(servers[MCP_KEY] || null);
    const after = JSON.stringify(entry);
    const changed = before !== after;
    if (!dry && changed) {
      const next = { ...existing, mcpServers: { ...servers, [MCP_KEY]: entry } };
      writeFileSync(mcpFile, JSON.stringify(next, null, 2) + "\n");
    }
    steps.push(
      `mcp     → ${rel(mcpFile)}  ["${MCP_KEY}"] = ${entry.command} ${entry.args.join(" ")}` +
        (changed ? "" : "  (already set)"),
    );
  }

  for (const s of steps) console.log(`  ${s}`);
  console.log();
  if (doMcp) {
    console.log(`  Note: a newly registered MCP server is picked up when the agent/session reloads`);
    console.log(`        its config — restart the session (or reconnect MCP) if the tools aren't live yet.`);
  }
  console.log(`  Then just ask: "use Font Lab to pick new fonts". Undo with \`font-lab uninstall\`.`);
}

// ---- uninstall -------------------------------------------------------------

export function runUninstall() {
  const dry = has("--dry-run");
  const project = path.resolve(arg("--project", process.cwd()));
  const tag = dry ? " (dry-run, nothing written)" : "";
  console.log(`Font Lab — uninstall${tag}`);

  // 1. remove the global skill
  const dest = path.join(skillsDir(), SKILL_NAME);
  if (existsSync(dest)) {
    if (!dry) rmSync(dest, { recursive: true, force: true });
    console.log(`  removed skill   ${dest}`);
  } else {
    console.log(`  skill           not installed (${dest})`);
  }

  // 2. drop the MCP server entry (leave any others untouched)
  const mcpFile = path.join(project, ".mcp.json");
  if (existsSync(mcpFile) && statSync(mcpFile).isFile()) {
    const json = readJson(mcpFile);
    if (json && json.mcpServers && json.mcpServers[MCP_KEY]) {
      if (!dry) {
        delete json.mcpServers[MCP_KEY];
        // If we left the file empty (no other servers and no other top-level keys), remove
        // it — install likely created it, so a bare `{"mcpServers":{}}` shouldn't linger.
        const otherKeys = Object.keys(json).filter((k) => k !== "mcpServers");
        const emptied = Object.keys(json.mcpServers).length === 0 && otherKeys.length === 0;
        if (emptied) rmSync(mcpFile, { force: true });
        else writeFileSync(mcpFile, JSON.stringify(json, null, 2) + "\n");
        console.log(`  removed mcp     ${rel(mcpFile)} ["${MCP_KEY}"]${emptied ? " (removed empty .mcp.json)" : ""}`);
      } else {
        console.log(`  removed mcp     ${rel(mcpFile)} ["${MCP_KEY}"]`);
      }
    } else {
      console.log(`  mcp             entry not present in ${rel(mcpFile)}`);
    }
  } else {
    console.log(`  mcp             no .mcp.json in ${rel(project)}`);
  }
}

// Allow running directly as a bin (`font-lab-install`) in addition to the
// `font-lab install` subcommand dispatched from font-lab.mjs.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || "")) {
  if (process.argv.includes("uninstall")) runUninstall();
  else runInstall();
}
