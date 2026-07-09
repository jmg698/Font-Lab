#!/usr/bin/env node
// `font-lab install` — the one-command, HOST-AWARE setup that wires Font Lab into whatever agent
// you use. Two kinds of wiring, per host:
//
//   1. MCP server  → so the agent has the font_lab_* tools. Different hosts read different config
//      files/formats; we write the right one for each (the `mcpServers` JSON family, VS Code's
//      `servers` key, or Codex's TOML).
//   2. Instructions → so the agent DISCOVERS Font Lab and follows the intake-first protocol.
//      Claude reads a skill (~/.claude/skills/font-lab); everyone else reads an AGENTS.md block.
//
// With no --host, it AUTO-DETECTS which agents are present and wires them all. Everything is
// idempotent (re-running is a no-op) and reversible (`font-lab uninstall` cleans every host).
//
//   npx font-lab install [--host <list|all>] [--project <dir>] [--no-mcp] [--no-skill] [--local] [--dry-run]
//   npx font-lab uninstall [--project <dir>]
//
// Flags:
//   --host <list>     comma-separated: claude,cursor,codex,windsurf,vscode,gemini (or `all`).
//                     Omit to auto-detect installed agents (falls back to claude).
//   --project <dir>   project to wire project-scoped config into (default: cwd)
//   --no-mcp          skip the MCP registration (instructions only)
//   --no-skill        skip the instructions (skill / AGENTS.md) — MCP only
//   --local           register the MCP server as `node <this-checkout>/mcp.mjs` instead of the
//                     published `npx` form — use this to test from a git clone before publishing
//   --skills-dir <d>  override the Claude skills dir (default: $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills)
//   --dry-run         print what would change, write nothing

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

const PKG_NAME = "font-lab"; // single source of truth for the published name
const SKILL_NAME = "font-lab";
const MCP_KEY = "font-lab";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // the `cli/` dir
const HOME = os.homedir();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);
const rel = (p) => path.relative(process.cwd(), p) || ".";
const tildify = (p) => (p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- the host registry -----------------------------------------------------
// Each host says WHERE its MCP config lives + its format, and which instruction surface it reads
// ("skill" = Claude's skills dir; "agents" = an AGENTS.md block in the project). `detect` is a
// cheap "does this agent appear installed?" check used by auto-detection.

const HOSTS = {
  claude: {
    label: "Claude Code",
    mcp: (project) => ({ file: path.join(project, ".mcp.json"), format: "json", key: "mcpServers" }),
    instructions: "skill",
    detect: (project) => existsSync(path.join(HOME, ".claude")) || !!process.env.CLAUDE_CONFIG_DIR || existsSync(path.join(project, ".mcp.json")),
  },
  cursor: {
    label: "Cursor",
    mcp: () => ({ file: path.join(HOME, ".cursor", "mcp.json"), format: "json", key: "mcpServers" }),
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".cursor")),
  },
  codex: {
    label: "Codex",
    mcp: () => ({ file: path.join(HOME, ".codex", "config.toml"), format: "toml" }),
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".codex")),
  },
  windsurf: {
    label: "Windsurf",
    mcp: () => ({ file: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"), format: "json", key: "mcpServers" }),
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".codeium", "windsurf")),
  },
  vscode: {
    label: "VS Code",
    mcp: (project) => ({ file: path.join(project, ".vscode", "mcp.json"), format: "json", key: "servers" }),
    instructions: "agents",
    detect: (project) => existsSync(path.join(project, ".vscode")),
  },
  gemini: {
    label: "Gemini CLI",
    mcp: () => ({ file: path.join(HOME, ".gemini", "settings.json"), format: "json", key: "mcpServers" }),
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".gemini")),
  },
};

function selectHosts(project) {
  const raw = arg("--host", null);
  if (raw && raw.toLowerCase() !== "auto") {
    const names = raw.toLowerCase() === "all" ? Object.keys(HOSTS) : raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const bad = names.filter((n) => !HOSTS[n]);
    if (bad.length) {
      console.error(`  ✗ unknown host(s): ${bad.join(", ")}. Known: ${Object.keys(HOSTS).join(", ")}`);
      process.exit(1);
    }
    return [...new Set(names)];
  }
  const detected = Object.keys(HOSTS).filter((n) => HOSTS[n].detect(project));
  return detected.length ? detected : ["claude"]; // back-compat default
}

// The command the agent's host will run to launch the MCP server.
//   published (default):  npx -y font-lab mcp
//   --local (dev/test):   node <abs>/cli/mcp.mjs
function mcpEntry() {
  if (has("--local")) return { command: "node", args: [path.join(HERE, "mcp.mjs")] };
  return { command: "npx", args: ["-y", PKG_NAME, "mcp"] };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ---- MCP config writers (one per format), idempotent + reversible ----------

export function writeJsonMcp(file, key, entry, dry) {
  const existing = existsSync(file) ? readJson(file) || {} : {};
  const servers = existing[key] && typeof existing[key] === "object" ? existing[key] : {};
  const changed = JSON.stringify(servers[MCP_KEY] || null) !== JSON.stringify(entry);
  if (!dry && changed) {
    const next = { ...existing, [key]: { ...servers, [MCP_KEY]: entry } };
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  }
  return changed;
}

export function removeJsonMcp(file, key, dry) {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const json = readJson(file);
  if (!json || !json[key] || !json[key][MCP_KEY]) return false;
  if (!dry) {
    delete json[key][MCP_KEY];
    const otherKeys = Object.keys(json).filter((k) => k !== key);
    const emptied = Object.keys(json[key]).length === 0 && otherKeys.length === 0;
    if (emptied) rmSync(file, { force: true }); // we likely created the file; don't leave a bare shell
    else writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }
  return true;
}

function tomlBlock(entry) {
  return `[mcp_servers.${MCP_KEY}]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`;
}

// Minimal TOML merge (line/section based, not a full parser): append our section if absent, strip
// it on removal. We never rewrite the rest of the file, so other servers/settings are preserved.
export function writeTomlMcp(file, entry, dry) {
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (existing.includes(`[mcp_servers.${MCP_KEY}]`)) return false; // already present
  if (!dry) {
    mkdirSync(path.dirname(file), { recursive: true });
    const pad = existing ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    writeFileSync(file, existing + pad + tomlBlock(entry));
  }
  return true;
}

export function removeTomlMcp(file, dry) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const re = new RegExp(`\\n*\\[mcp_servers\\.${escapeRe(MCP_KEY)}\\][\\s\\S]*?(?=\\n\\[|$)`);
  if (!re.test(text)) return false;
  if (!dry) {
    const stripped = text.replace(re, "").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
    if (stripped.trim() === "") rmSync(file, { force: true });
    else writeFileSync(file, stripped);
  }
  return true;
}

// ---- instruction surfaces --------------------------------------------------

// The SKILL source: bundled inside the package (cli/skill/font-lab, created by `prepack`) when
// installed via npm, or the repo's top-level skill/font-lab when run from a git checkout.
function resolveSkillSource() {
  for (const c of [path.join(HERE, "skill", SKILL_NAME), path.join(HERE, "..", "skill", SKILL_NAME)]) {
    if (existsSync(path.join(c, "SKILL.md"))) return c;
  }
  return null;
}

function skillsDir() {
  const override = arg("--skills-dir", null);
  if (override) return path.resolve(override);
  const base = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, ".claude");
  return path.join(base, "skills");
}

const AGENTS_START = "<!-- font-lab:start -->";
const AGENTS_END = "<!-- font-lab:end -->";

// The cross-agent analog of the skill: a concise, intake-first protocol block for hosts that read
// AGENTS.md (Cursor, Codex, Windsurf, VS Code, Gemini, …). Kept short on purpose.
export function agentsBlock() {
  return [
    AGENTS_START,
    "## Font Lab — pick & ship fonts (and edit copy) on the real site",
    "",
    "When the user wants to choose, change, compare, or improve the FONTS / typography of this Next.js + Tailwind app, drive the `font_lab_*` MCP tools. **Do as much of the setup yourself as your environment allows before involving the human — then hand them only what you genuinely can't do.**",
    "",
    "**Setup — who starts what (this is where it usually goes wrong):** the live panel needs TWO long-running local processes up at the same time — the **dev server** (your project's `npm run dev` / `pnpm dev` / …) and the **pick + edit endpoint** (`npx font-lab --project <dir>`, on :7777). Neither ever exits.",
    "- **If you have a local terminal** (Cursor, Claude Code, Windsurf, VS Code, Gemini CLI): **start BOTH yourself as background tasks and leave them running** (skip whichever is already up). Do NOT run them in the foreground — they never return and your turn will hang. Then tell the human to open their site.",
    "- **If you're a cloud / container agent** with no access to the user's localhost: you can still install, scaffold the panel, and ship — but you **cannot start or reach** those processes. Give the human the exact commands and the URL to open (`font_lab_live_instructions` prints them for this project), and drive the pick from screenshots (`font_lab_screenshot_directions`).",
    "- **Only the human can:** reload this session once after install so the MCP tools load, and make the actual pick / retype copy in their browser.",
    "",
    "1. **Start & intake** — `font_lab_start({ projectDir })` analyzes the project and returns a design brief. **Ask the human its framing questions first** (what feeling? how bold a departure? brand to evoke or avoid?) and wait for answers before proposing any fonts.",
    "2. **Compose for their brief** — `font_lab_compose_directions(...)` with tailored directions (display + body + mono, each with a one-line rationale). Reach PAST the overexposed defaults (Inter, Geist, Space Grotesk, …). You're not limited to the catalog — any of ~1,500 Google fonts works; confirm uncertain faces with `font_lab_check_fonts`. (`font_lab_curate` is the no-brief fallback.)",
    "3. **Let the human choose** — `font_lab_screenshot_directions` (works anywhere) or the live panel. **Never auto-pick** — the human always makes the taste decision. On the live path, receive the pick by running `npx font-lab serve --once` as a background task (it exits when the pick lands) or by calling `font_lab_wait_for_pick` (blocks; re-call on timeout). Never \"check back later\" — idle agents can't poll. `font_lab_status` says where the loop stands anytime.",
    "4. **Ship** — `font_lab_apply` writes the exact next/font + Tailwind code, reversibly (`font_lab_undo`). It verifies every family is buildable before writing; after applying, run the project's build to confirm and report honestly.",
    "",
    "**Copy edits ride the same endpoint:** with the panel up and `:7777` running, the human can double-click any text on the page, retype it, and it saves to their source (reversibly). If edits appear to save then revert, it's almost always one of: the endpoint isn't running, it's pointed at the wrong folder (`--project` must be the site root), or the site isn't in dev mode — tell the human which to fix rather than leaving it looking broken.",
    "",
    "**When they're done, hand the repo back clean:** `font_lab_status` → `sourceChanges` lists every source file Font Lab wrote this session (copy edits, font applies, panel scaffolding). Propose the commit plan from it — their content edits in one commit, Font Lab's scaffolding (the `layout.tsx` mount, `app/_fontlab/`, `public/fontlab/`) as a separate chore commit or left uncommitted — and never `git commit`/`git push` unless they explicitly ask. `.font-lab/` is runtime state and ignores itself; it never belongs in a commit.",
    "",
    "Prefer `guaranteed` (WYSIWYG) faces; when only `best-effort` is possible, relay the fidelity warning honestly.",
    AGENTS_END,
  ].join("\n");
}

export function writeAgents(project, dry) {
  const file = path.join(project, "AGENTS.md");
  const block = agentsBlock();
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const re = new RegExp(`${escapeRe(AGENTS_START)}[\\s\\S]*?${escapeRe(AGENTS_END)}`);
  const next = re.test(existing) ? existing.replace(re, block) : (existing ? existing.replace(/\s*$/, "") + "\n\n" : "") + block + "\n";
  const changed = next !== existing;
  if (!dry && changed) writeFileSync(file, next);
  return { file, changed };
}

export function removeAgents(project, dry) {
  const file = path.join(project, "AGENTS.md");
  if (!existsSync(file)) return false;
  const existing = readFileSync(file, "utf8");
  const re = new RegExp(`\\n*${escapeRe(AGENTS_START)}[\\s\\S]*?${escapeRe(AGENTS_END)}\\n*`, "g");
  if (!re.test(existing)) return false;
  if (!dry) {
    const stripped = existing.replace(re, "\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
    if (stripped.trim() === "") rmSync(file, { force: true });
    else writeFileSync(file, stripped);
  }
  return true;
}

function writeMcpFor(host, project, entry, dry) {
  const m = HOSTS[host].mcp(project);
  const changed = m.format === "toml" ? writeTomlMcp(m.file, entry, dry) : writeJsonMcp(m.file, m.key, entry, dry);
  return { file: m.file, changed };
}

// ---- install / uninstall ---------------------------------------------------

export function runInstall() {
  const dry = has("--dry-run");
  const doInstr = !has("--no-skill");
  const doMcp = !has("--no-mcp");
  const project = path.resolve(arg("--project", process.cwd()));
  const hosts = selectHosts(project);
  const entry = mcpEntry();
  const tag = dry ? " (dry-run, nothing written)" : "";
  const steps = [];

  console.log(`Font Lab — install${tag}`);
  console.log(`  hosts   ${hosts.map((h) => HOSTS[h].label).join(", ")}`);

  if (doMcp) {
    for (const h of hosts) {
      const { file, changed } = writeMcpFor(h, project, entry, dry);
      steps.push(`mcp[${h}]  → ${tildify(file)}${changed ? "" : "  (already set)"}`);
    }
  }

  if (doInstr) {
    if (hosts.includes("claude")) {
      const src = resolveSkillSource();
      if (!src) {
        console.error(`  ✗ skill source not found (looked in cli/skill/${SKILL_NAME} and ../skill/${SKILL_NAME}).`);
        console.error(`    From a git clone, run from the repo root; from npm, this is a packaging bug.`);
        process.exit(1);
      }
      const dest = path.join(skillsDir(), SKILL_NAME);
      if (!dry) {
        mkdirSync(path.dirname(dest), { recursive: true });
        rmSync(dest, { recursive: true, force: true }); // clean copy so updates fully replace
        cpSync(src, dest, { recursive: true });
      }
      steps.push(`skill   → ${tildify(dest)}`);
    }
    if (hosts.some((h) => HOSTS[h].instructions === "agents")) {
      const { file, changed } = writeAgents(project, dry);
      steps.push(`agents  → ${rel(file)}${changed ? "" : "  (already current)"}`);
    }
  }

  for (const s of steps) console.log(`  ${s}`);
  console.log();
  if (doMcp) {
    console.log(`  Note: a newly registered MCP server is picked up when the agent/session reloads its`);
    console.log(`        config — restart the session (or reconnect MCP) if the tools aren't live yet.`);
  }
  console.log(`  For the agent: once the tools are live, do as much as your environment allows.`);
  console.log(`        With a local terminal (Cursor/Claude Code/…), start the dev server AND`);
  console.log(`        \`npx font-lab --project <dir>\` (:7777) YOURSELF as background tasks and leave`);
  console.log(`        them running. As a cloud agent, hand those commands to the human instead.`);
  console.log(`        The :7777 endpoint records picks AND saves in-panel copy edits.`);
  console.log(`  Then just ask: "use Font Lab to pick new fonts". Undo with \`font-lab uninstall\`.`);
}

export function runUninstall() {
  const dry = has("--dry-run");
  const project = path.resolve(arg("--project", process.cwd()));
  const tag = dry ? " (dry-run, nothing written)" : "";
  console.log(`Font Lab — uninstall${tag}`);

  // MCP from every known host (so you don't have to remember which you installed)
  let any = false;
  for (const [h, def] of Object.entries(HOSTS)) {
    const m = def.mcp(project);
    const removed = m.format === "toml" ? removeTomlMcp(m.file, dry) : removeJsonMcp(m.file, m.key, dry);
    if (removed) {
      console.log(`  removed mcp[${h}]  ${tildify(m.file)}`);
      any = true;
    }
  }

  // the Claude skill
  const dest = path.join(skillsDir(), SKILL_NAME);
  if (existsSync(dest)) {
    if (!dry) rmSync(dest, { recursive: true, force: true });
    console.log(`  removed skill   ${tildify(dest)}`);
    any = true;
  }

  // the AGENTS.md block
  if (removeAgents(project, dry)) {
    console.log(`  removed agents  ${rel(path.join(project, "AGENTS.md"))}`);
    any = true;
  }

  if (!any) console.log(`  nothing to remove (Font Lab wasn't installed for any host here).`);
}

// Allow running directly as a bin (`font-lab-install`) in addition to the `font-lab install`
// subcommand dispatched from font-lab.mjs.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || "")) {
  if (process.argv.includes("uninstall")) runUninstall();
  else runInstall();
}
