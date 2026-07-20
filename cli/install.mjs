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
import { writeInstallManifest, clearInstallManifest } from "./state.mjs";
import { VERSION } from "./version.mjs";

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

// `mcpScope` says whether the host's MCP config travels WITH the project ("project": a file
// inside the repo, launched with cwd = project root) or lives once per machine ("global") — it
// decides which pinning form the registration gets (see mcpEntryFor).
const HOSTS = {
  claude: {
    label: "Claude Code",
    mcp: (project) => ({ file: path.join(project, ".mcp.json"), format: "json", key: "mcpServers" }),
    mcpScope: "project",
    instructions: "skill",
    detect: (project) => existsSync(path.join(HOME, ".claude")) || !!process.env.CLAUDE_CONFIG_DIR || existsSync(path.join(project, ".mcp.json")),
  },
  cursor: {
    label: "Cursor",
    mcp: () => ({ file: path.join(HOME, ".cursor", "mcp.json"), format: "json", key: "mcpServers" }),
    mcpScope: "global",
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".cursor")),
  },
  codex: {
    label: "Codex",
    mcp: () => ({ file: path.join(HOME, ".codex", "config.toml"), format: "toml" }),
    mcpScope: "global",
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".codex")),
  },
  windsurf: {
    label: "Windsurf",
    mcp: () => ({ file: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"), format: "json", key: "mcpServers" }),
    mcpScope: "global",
    instructions: "agents",
    detect: () => existsSync(path.join(HOME, ".codeium", "windsurf")),
  },
  vscode: {
    label: "VS Code",
    mcp: (project) => ({ file: path.join(project, ".vscode", "mcp.json"), format: "json", key: "servers" }),
    mcpScope: "project",
    instructions: "agents",
    detect: (project) => existsSync(path.join(project, ".vscode")),
  },
  gemini: {
    label: "Gemini CLI",
    mcp: () => ({ file: path.join(HOME, ".gemini", "settings.json"), format: "json", key: "mcpServers" }),
    mcpScope: "global",
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

// The command the agent's host will run to launch the MCP server. Version drift lives or dies
// here: `npx -y font-lab` freezes at whatever the npx cache resolved FIRST and never follows
// `npm install font-lab@latest` — the dogfood's "MCP 0.11 while the panel is 0.13" trap. So:
//   project-scoped configs, font-lab installed as a dep:
//       node node_modules/font-lab/mcp.mjs     — npm install IS the MCP upgrade (relative path:
//                                                these configs launch with cwd = project root,
//                                                and the committed file stays portable)
//   global configs (and no local dep):
//       npx -y font-lab@latest mcp             — @latest re-resolves per session instead of
//                                                serving the first-cached version forever
//   --local (dev/test): node <this-checkout>/mcp.mjs
export function mcpEntryFor(host, project, { local = has("--local") } = {}) {
  if (local) return { command: "node", args: [path.join(HERE, "mcp.mjs")] };
  if (HOSTS[host]?.mcpScope === "project" && existsSync(path.join(project, "node_modules", PKG_NAME, "mcp.mjs")))
    return { command: "node", args: [path.join("node_modules", PKG_NAME, "mcp.mjs")] };
  return { command: "npx", args: ["-y", `${PKG_NAME}@latest`, "mcp"] };
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

// Minimal TOML merge (line/section based, not a full parser): append our section if absent,
// REPLACE it when the registration changed (so upgrades re-pin instead of silently keeping a
// stale launch command), strip it on removal. We never rewrite the rest of the file, so other
// servers/settings are preserved.
export function writeTomlMcp(file, entry, dry) {
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const block = tomlBlock(entry);
  if (existing.includes(`[mcp_servers.${MCP_KEY}]`)) {
    const re = new RegExp(`\\n*\\[mcp_servers\\.${escapeRe(MCP_KEY)}\\][\\s\\S]*?(?=\\n\\[|$)`);
    const current = (existing.match(re) || [""])[0].trim();
    if (current === block.trim()) return false; // already pinned to this exact entry
    if (!dry) writeFileSync(file, existing.replace(re, "\n" + block.trimEnd() + "\n").replace(/\n{3,}/g, "\n\n"));
    return true;
  }
  if (!dry) {
    mkdirSync(path.dirname(file), { recursive: true });
    const pad = existing ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    writeFileSync(file, existing + pad + block);
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
    "When the user wants to choose, change, compare, or improve the FONTS / typography of this app — any framework: Next.js, Vite, Astro, Remix, SvelteKit, TanStack, … — drive the `font_lab_*` MCP tools. **Do as much of the setup yourself as your environment allows before involving the human — then hand them only what you genuinely can't do.** Route by `font_lab_analyze`'s `capabilities` (`shipNote` names the path): the live panel is Next-only, but every stack still previews on the REAL site (`font_lab_screenshot_directions` — no panel needed, and it starts the dev server itself when none is running; `font_lab_preview` is the no-dev-server fallback) and auto-ships where there's a CSS seam (`font_lab_apply`) — a non-Next stack is a different route, never a reason to stop.",
    "",
    "**MCP tools not live yet (fresh install) or the server dropped?** Every tool is also `npx font-lab run <tool> '<json-args>'` — the same table, same JSON out (`npx font-lab run` lists them). Never block on a session reload and never hand-roll an MCP client.",
    "",
    "**Setup — who starts what (this is where it usually goes wrong):** the live panel needs TWO long-running local processes up at the same time — the **dev server** (your project's `npm run dev` / `pnpm dev` / …) and the **pick + edit endpoint** (`npx font-lab --project <dir>`, on :7777). Neither ever exits.",
    "- **If you have a local terminal** (Cursor, Claude Code, Windsurf, VS Code, Gemini CLI): **start BOTH yourself as background tasks and leave them running** (skip whichever is already up). Do NOT run them in the foreground — they never return and your turn will hang. Then tell the human to open their site.",
    "- **If you're a cloud / container agent** (`font_lab_start`'s `environment` block detects this): the human cannot reach this machine's localhost — the live panel and :7777 are not the choosing moment here, so say so up front and never hand over a localhost URL. Run the whole loop yourself headlessly: screenshots (chat-sized `heroShot` images) → `font_lab_select` → `apply` → `font_lab_verify`; make copy edits directly in source. In an EPHEMERAL workspace (work lost on reclaim), run `font_lab_finish` first (scaffolding out, commit plan in), then commit the ship pile on your working branch with the plan's commands and say what you committed — never push anywhere the human didn't designate.",
    "- **Only the human can:** reload this session once after install so the MCP tools load (the `run` CLI covers you until then), and make the actual pick / retype copy in their browser.",
    "",
    "1. **Start & intake** — `font_lab_start({ projectDir })` analyzes the project and returns a design brief + the `environment` block. **Ask the human its framing questions first** (what feeling? how bold a departure? brand to evoke or avoid?) and wait for answers before proposing any fonts.",
    "2. **Compose for their brief** — `font_lab_compose_directions({ projectDir, directions, brief })` with tailored directions (display + body + mono, each with a one-line rationale). ALWAYS pass projectDir — the composed set persists as the default menu that screenshots/select resolve against. Reach PAST the overexposed defaults (Inter, Geist, Space Grotesk, …). You're not limited to the catalog — any of ~1,500 Google fonts works; confirm uncertain faces with `font_lab_check_fonts`. (`font_lab_curate` is the no-brief fallback.)",
    "3. **Let the human choose** — `font_lab_screenshot_directions` (works anywhere; manages the dev server; show the `heroShot` images) or the live panel. **Never auto-pick** — the human always makes the taste decision. On the live path, **ARM FIRST, INVITE SECOND**: the LAST thing you do before telling the human to open their site is enter the listen state — `npx font-lab serve --once` as a background task (exits on the first panel event; use when your harness wakes you on background-task exit) or park on `font_lab_wait` (blocks; re-call immediately on EVERY timeout). Ending your setup turn unarmed is how picks get missed. If the timing misses anyway, nothing is lost: the pick piggybacks on every font_lab_* result as `pendingHumanPick` (with its ship scope) until applied — act on it when you see it. Never \"check back later\" — idle agents can't poll. `font_lab_status` says where the loop stands anytime.",
    "4. **Ship** — `font_lab_apply` writes the exact code for the stack (next/font + Tailwind on Next; self-hosted @font-face through Tailwind @theme / v3 utilities / the project's own font vars elsewhere), reversibly (`font_lab_undo`). It verifies every family is buildable before writing; after applying, close the loop with `font_lab_verify` (it starts the dev server itself if needed) and report the receipt honestly.",
    "",
    "**Copy edits ride the same endpoint:** with the panel up and `:7777` running, the human can double-click any text on the page, retype it, and it saves to their source (reversibly). If edits appear to save then revert, it's almost always one of: the endpoint isn't running, it's pointed at the wrong folder (`--project` must be the site root), or the site isn't in dev mode — tell the human which to fix rather than leaving it looking broken.",
    "",
    "**When they're done, hand the repo back clean with `font_lab_finish`:** the panel's *done ✓* button, the human saying they're finished, or a `pendingCleanup` note on any tool result all mean the same thing — call `font_lab_finish({ projectDir })`. It strips the dev-panel scaffolding (the `layout.tsx` mount, `app/_fontlab/`, `public/fontlab/` preview fonts) and returns a git-verified `commitPlan`: the ship pile (their copy edits + font apply, with ready-to-run `git add` / `git commit` commands) separated from anything that isn't theirs. Relay the commands; never `git commit`/`git push` yourself unless they explicitly ask. The scaffolding and `.font-lab/` are self-ignoring (nested .gitignore), so `git status` shows the product diff only; pass `uninstall:true` when the human wants Font Lab's MCP/instructions wiring gone too.",
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

// ---- host-native turn-start delivery ----------------------------------------------------
// Claude Code: a UserPromptSubmit hook whose stdout is injected into context — the agent
// learns about an undelivered pick on the human's next message, whatever it says. This is the
// strongest delivery layer on hosts with real hooks. Cursor has no reliable hook today, so it
// gets an always-applied rules file (soft: the model must comply) — do not advertise
// "next-turn automatic" on Cursor; the MCP piggyback is the floor there.

const HOOK_MARK = "font-lab/pending-pick-hook.mjs"; // identifies our entry for idempotency/removal

export function writeClaudeHook(project, dry, { local = has("--local") } = {}) {
  // Only when there's a stable script path to point at: the project's own install, or this
  // checkout under --local. An npx-cache path would go stale on the next upgrade.
  const script = local
    ? path.join(HERE, "pending-pick-hook.mjs")
    : existsSync(path.join(project, "node_modules", PKG_NAME, "pending-pick-hook.mjs"))
      ? ["$CLAUDE_PROJECT_DIR", "node_modules", PKG_NAME, "pending-pick-hook.mjs"].join("/")
      : null;
  if (!script) return { file: null, changed: false, skipped: "needs font-lab installed in the project (npm i -D font-lab) for a stable hook path" };
  const file = path.join(project, ".claude", "settings.json");
  const json = (existsSync(file) && readJson(file)) || {};
  json.hooks = json.hooks && typeof json.hooks === "object" ? json.hooks : {};
  const arr = (json.hooks.UserPromptSubmit = Array.isArray(json.hooks.UserPromptSubmit) ? json.hooks.UserPromptSubmit : []);
  const command = `node "${script}"`;
  let changed = false;
  const ours = arr.flatMap((m) => m?.hooks || []).filter((h) => String(h?.command || "").includes(HOOK_MARK));
  if (ours.length) {
    for (const h of ours) if (h.command !== command) { h.command = command; changed = true; } // re-pin
  } else {
    arr.push({ hooks: [{ type: "command", command }] });
    changed = true;
  }
  if (!dry && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }
  return { file, changed };
}

export function removeClaudeHook(project, dry) {
  const file = path.join(project, ".claude", "settings.json");
  if (!existsSync(file)) return false;
  const json = readJson(file);
  const arr = json?.hooks?.UserPromptSubmit;
  if (!Array.isArray(arr)) return false;
  let changed = false;
  for (const m of arr) {
    const before = (m?.hooks || []).length;
    m.hooks = (m?.hooks || []).filter((h) => !String(h?.command || "").includes(HOOK_MARK));
    if (m.hooks.length !== before) changed = true;
  }
  if (!changed) return false;
  if (!dry) {
    json.hooks.UserPromptSubmit = arr.filter((m) => (m.hooks || []).length);
    if (!json.hooks.UserPromptSubmit.length) delete json.hooks.UserPromptSubmit;
    if (!Object.keys(json.hooks).length) delete json.hooks;
    if (!Object.keys(json).length) rmSync(file, { force: true });
    else writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }
  return true;
}

const CURSOR_RULES_REL = path.join(".cursor", "rules", "font-lab.mdc");

export function cursorRulesContent() {
  return [
    "---",
    "description: Font Lab — pick delivery and typography workflow",
    "alwaysApply: true",
    "---",
    "",
    "<!-- managed by `font-lab install`; removed by `font-lab uninstall` -->",
    "",
    "Before ANY reply about fonts/typography — or when the user mentions picking something in the",
    "Font Lab panel — call `font_lab_status({ projectDir })` (this project's root) FIRST. The human",
    "may have picked in the live panel while no agent was listening: an unapplied pick shows up",
    "there, and rides every font_lab_* tool result as `pendingHumanPick` with its ship scope.",
    "When you see one, offer `font_lab_apply`, then `font_lab_verify` for the convergence receipt.",
    "",
  ].join("\n");
}

export function writeCursorRules(project, dry) {
  const file = path.join(project, CURSOR_RULES_REL);
  const content = cursorRulesContent();
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
  const changed = existing !== content;
  if (!dry && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return { file, changed };
}

export function removeCursorRules(project, dry) {
  const file = path.join(project, CURSOR_RULES_REL);
  if (!existsSync(file)) return false;
  if (!dry) rmSync(file, { force: true });
  return true;
}

function writeMcpFor(host, project, dry) {
  const entry = mcpEntryFor(host, project);
  const m = HOSTS[host].mcp(project);
  const changed = m.format === "toml" ? writeTomlMcp(m.file, entry, dry) : writeJsonMcp(m.file, m.key, entry, dry);
  return { file: m.file, changed, entry };
}

// ---- install / uninstall ---------------------------------------------------

export function runInstall() {
  const dry = has("--dry-run");
  const doInstr = !has("--no-skill");
  const doMcp = !has("--no-mcp");
  const project = path.resolve(arg("--project", process.cwd()));
  const hosts = selectHosts(project);
  const tag = dry ? " (dry-run, nothing written)" : "";
  const steps = [];
  // The footprint receipt: every path this install wires, in and out of the repo. Written to
  // .font-lab/install.json so status can show the whole footprint and finish/uninstall can
  // explain exactly what stays or goes.
  const footprint = [];

  console.log(`Font Lab — install${tag}`);
  console.log(`  hosts   ${hosts.map((h) => HOSTS[h].label).join(", ")}`);

  if (doMcp) {
    for (const h of hosts) {
      const { file, changed, entry } = writeMcpFor(h, project, dry);
      const cmd = [entry.command, ...entry.args].join(" ");
      steps.push(`mcp[${h}]  → ${tildify(file)}  (${cmd})${changed ? "" : "  (already set)"}`);
      footprint.push({ kind: "mcp", host: h, scope: HOSTS[h].mcpScope, path: tildify(file) });
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
      footprint.push({ kind: "skill", host: "claude", scope: "global", path: tildify(dest) });
      const hk = writeClaudeHook(project, dry);
      steps.push(hk.file
        ? `hook    → ${rel(hk.file)}${hk.changed ? "" : "  (already set)"}  (undelivered pick surfaces at turn start)`
        : `hook    skipped — ${hk.skipped}`);
      if (hk.file) footprint.push({ kind: "hook", host: "claude", scope: "project", path: rel(hk.file) });
    }
    if (hosts.includes("cursor")) {
      const cr = writeCursorRules(project, dry);
      steps.push(`rules   → ${rel(cr.file)}${cr.changed ? "" : "  (already current)"}  (check font_lab_status before font replies)`);
      footprint.push({ kind: "rules", host: "cursor", scope: "project", path: rel(cr.file) });
    }
    if (hosts.some((h) => HOSTS[h].instructions === "agents")) {
      const { file, changed } = writeAgents(project, dry);
      steps.push(`agents  → ${rel(file)}${changed ? "" : "  (already current)"}`);
      footprint.push({ kind: "agents", scope: "project", path: rel(file) });
    }
  }

  if (!dry) writeInstallManifest(project, { version: VERSION, at: new Date().toISOString(), hosts, entries: footprint });

  for (const s of steps) console.log(`  ${s}`);
  console.log();
  if (doMcp) {
    console.log(`  Note: a newly registered MCP server is picked up when the agent/session reloads its`);
    console.log(`        config. Until then (and any time MCP drops), every tool works as a one-shot CLI:`);
    console.log(`          npx font-lab run <tool> '<json-args>'     (npx font-lab run  lists them)`);
    console.log(`        Same tool table, same JSON out — don't block on the reload; start the loop now.`);
  }
  console.log(`  For the agent: do as much as your environment allows.`);
  console.log(`        With a local terminal (Cursor/Claude Code/…), start the dev server AND`);
  console.log(`        \`npx font-lab --project <dir>\` (:7777) YOURSELF as background tasks and leave`);
  console.log(`        them running — the :7777 endpoint records picks AND saves in-panel copy edits.`);
  console.log(`        As a cloud/container agent (human can't reach this localhost): skip both — drive`);
  console.log(`        the pick with font_lab_screenshot_directions (it starts the dev server itself`);
  console.log(`        and returns chat-sized heroShot images), then select → apply → verify.`);
  console.log(`  Then just ask: "use Font Lab to pick new fonts". Undo with \`font-lab uninstall\`.`);
}

// The programmatic core of uninstall — every host's MCP registration, the Claude skill, the
// AGENTS.md block, and the turn-start delivery hooks — callable by font_lab_finish
// ({ uninstall: true }) as well as the CLI. Returns what was removed; prints nothing.
export function uninstallAll(project, { dry = false } = {}) {
  const removed = [];

  // MCP from every known host (so you don't have to remember which you installed)
  for (const [h, def] of Object.entries(HOSTS)) {
    const m = def.mcp(project);
    const r = m.format === "toml" ? removeTomlMcp(m.file, dry) : removeJsonMcp(m.file, m.key, dry);
    if (r) removed.push({ what: `mcp[${h}]`, file: tildify(m.file) });
  }

  // the Claude skill
  const dest = path.join(skillsDir(), SKILL_NAME);
  if (existsSync(dest)) {
    if (!dry) rmSync(dest, { recursive: true, force: true });
    removed.push({ what: "skill", file: tildify(dest) });
  }

  // the AGENTS.md block
  if (removeAgents(project, dry)) removed.push({ what: "agents", file: rel(path.join(project, "AGENTS.md")) });

  // host-native turn-start delivery (Claude Code hook, Cursor rules)
  if (removeClaudeHook(project, dry)) removed.push({ what: "hook", file: rel(path.join(project, ".claude", "settings.json")) });
  if (removeCursorRules(project, dry)) removed.push({ what: "rules", file: rel(path.join(project, CURSOR_RULES_REL)) });

  if (!dry) clearInstallManifest(project); // the footprint receipt goes with the footprint

  return removed;
}

export function runUninstall() {
  const dry = has("--dry-run");
  const project = path.resolve(arg("--project", process.cwd()));
  const tag = dry ? " (dry-run, nothing written)" : "";
  console.log(`Font Lab — uninstall${tag}`);

  const removed = uninstallAll(project, { dry });
  for (const r of removed) console.log(`  removed ${r.what.padEnd(8)} ${r.file}`);
  if (!removed.length) console.log(`  nothing to remove (Font Lab wasn't installed for any host here).`);
}

// Allow running directly as a bin (`font-lab-install`) in addition to the `font-lab install`
// subcommand dispatched from font-lab.mjs.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || "")) {
  if (process.argv.includes("uninstall")) runUninstall();
  else runInstall();
}
