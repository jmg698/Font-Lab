// Font Lab handoff state — the tiny shared vocabulary between the pick endpoint (serve),
// the engine (wait_for_pick / status / apply), and codegen (the applied stamp).
//
// Everything lives in <project>/.font-lab/ as plain JSON so any process — the panel's
// endpoint, an MCP tool call, a bare CLI — can read the same truth without coordination:
//   selection.json   the human's pick (written by the panel endpoint / select)
//   applied.json     stamp of the last successful apply (written by codegen)
//   agent-waiting.json  present while an agent is blocked in waitForPick (presence signal)
//   mcp-heartbeat.json  refreshed on every MCP tool call — "an agent touched Font Lab recently"
//   menu.json        how the mounted menu was built (composed vs fallback) — the provisional flag
//   request.json     the human's in-panel "more options" ask, queued until an agent fulfills it
//
// None of it is source. The dir ignores itself (see ensureFlDir), so a session's worth of
// state never lands in the human's git diff at commit time.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const FL_DIR = ".font-lab";
export const SELECTION_FILE = "selection.json";
export const APPLIED_FILE = "applied.json";
export const WAITING_FILE = "agent-waiting.json";
export const MENU_FILE = "menu.json";
export const REQUEST_FILE = "request.json";
export const HEARTBEAT_FILE = "mcp-heartbeat.json";

export const flDir = (projectDir) => path.join(projectDir, FL_DIR);
export const selectionPath = (projectDir) => path.join(flDir(projectDir), SELECTION_FILE);
export const appliedPath = (projectDir) => path.join(flDir(projectDir), APPLIED_FILE);
export const waitingPath = (projectDir) => path.join(flDir(projectDir), WAITING_FILE);
export const menuPath = (projectDir) => path.join(flDir(projectDir), MENU_FILE);
export const requestPath = (projectDir) => path.join(flDir(projectDir), REQUEST_FILE);
export const heartbeatPath = (projectDir) => path.join(flDir(projectDir), HEARTBEAT_FILE);

// Every .font-lab writer funnels through here so the state dir is born self-ignoring: a `*`
// .gitignore INSIDE it keeps all of this runtime state out of the human's git diff without ever
// touching their root .gitignore (the .next / cargo-target pattern — git honors nested ignore
// files even untracked). Existing installs heal on their next state write. Never overwrites a
// .gitignore the human put there themselves; deleting ours is the opt-out.
export function ensureFlDir(projectDir) {
  const dir = flDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, ".gitignore");
  if (!existsSync(gi)) {
    try {
      writeFileSync(gi, "# Font Lab local state (backups, picks, heartbeats) — regenerated as needed; never commit.\n*\n");
    } catch {} // a state write must not fail because the marker couldn't be written
  }
  return dir;
}

// Backups are undo state, not history: undo only ever restores the run named by latest.txt /
// latest-edit.txt, and older runs exist purely as a manual-recovery courtesy. Left uncapped, a
// copy-editing session leaves one edit-* folder per saved retype — the 50-folder wall a human
// hits at commit time. So every backup() write prunes its own family (copy-edit runs vs apply
// runs), oldest first, keeping the newest BACKUP_KEEP plus whatever the latest pointers name.
export const BACKUP_KEEP = 20;
export function pruneBackups(projectDir, { family, keep = BACKUP_KEEP } = {}) {
  const dir = path.join(flDir(projectDir), "backups");
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // no backups yet
  }
  // Runs named by a latest pointer are never deleted, whatever their mtime says.
  const pinned = new Set(
    ["latest.txt", "latest-edit.txt"]
      .map((f) => { try { return readFileSync(path.join(dir, f), "utf8").trim(); } catch { return null; } })
      .filter(Boolean),
  );
  const inFamily = (name) => (family === "edit" ? name.startsWith("edit-") : !name.startsWith("edit-"));
  const runs = entries
    .filter((e) => e.isDirectory() && inFamily(e.name))
    .map((e) => { try { return { name: e.name, mtime: statSync(path.join(dir, e.name)).mtimeMs }; } catch { return null; } })
    .filter(Boolean)
    // newest first; both run-naming schemes (edit-<base36 ms>, ISO stamps) sort chronologically
    // by name, so the name breaks mtime ties deterministically
    .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const pruned = [];
  for (const { name } of runs.slice(Math.max(0, keep))) {
    if (pinned.has(name)) continue;
    try {
      rmSync(path.join(dir, name), { recursive: true, force: true });
      pruned.push(name);
    } catch {} // pruning is best-effort; a locked dir must not fail the edit that triggered it
  }
  return pruned;
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

export function writeAppliedStamp(projectDir, result) {
  ensureFlDir(projectDir);
  const stamp = {
    at: new Date().toISOString(),
    runId: result?.runId ?? null,
    mode: result?.mode ?? "next-font",
    direction: result?.direction ?? null,
    edited: result?.edited ?? [],
  };
  writeFileSync(appliedPath(projectDir), JSON.stringify(stamp, null, 2) + "\n");
  return stamp;
}

export const clearAppliedStamp = (projectDir) => rmSync(appliedPath(projectDir), { force: true });

// Record HOW the currently-mounted menu was built: "composed" (agent tailored it to a brief) or
// "fallback" (the deterministic starter menu, mounted via allowFallback while debugging or when no
// brief was gathered). This is the truth the panel, status, and apply read so a menu that was never
// tailored to the project can't silently masquerade as one that was.
export function writeMenuState(projectDir, { mode, count } = {}) {
  ensureFlDir(projectDir);
  const state = { mode: mode || "composed", tailored: mode === "composed", count: count ?? null, at: new Date().toISOString() };
  writeFileSync(menuPath(projectDir), JSON.stringify(state, null, 2) + "\n");
  return state;
}

export const readMenuState = (projectDir) => readJson(menuPath(projectDir));

// The human's in-panel "more options" ask, queued on disk until an agent fulfills it. Carries the
// mini-brief they typed (feeling / departure / brand / free note) and the families already on
// screen, so the agent composes something genuinely NEW instead of repeating what they've rejected.
// Persisting it means the ask survives an agent connecting late — it isn't lost if none is listening
// at click time.
export function writeRequest(projectDir, { brief, exclude } = {}) {
  ensureFlDir(projectDir);
  const req = {
    status: "pending",
    brief: brief || {},
    exclude: Array.isArray(exclude) ? exclude : [],
    at: new Date().toISOString(),
  };
  writeFileSync(requestPath(projectDir), JSON.stringify(req, null, 2) + "\n");
  return req;
}

export const readRequest = (projectDir) => readJson(requestPath(projectDir));
export const clearRequest = (projectDir) => rmSync(requestPath(projectDir), { force: true });

export function setAgentWaiting(projectDir, on) {
  ensureFlDir(projectDir);
  if (on) writeFileSync(waitingPath(projectDir), JSON.stringify({ since: new Date().toISOString(), pid: process.pid }) + "\n");
  else rmSync(waitingPath(projectDir), { force: true });
}

export function refreshAgentHeartbeat(projectDir) {
  try {
    ensureFlDir(projectDir);
    writeFileSync(heartbeatPath(projectDir), JSON.stringify({ at: Date.now(), pid: process.pid }) + "\n");
  } catch {}
}

export function clearAgentHeartbeat(projectDir) {
  try { rmSync(heartbeatPath(projectDir), { force: true }); } catch {}
}

// One assembled snapshot of the handoff — what the panel's status pill and font_lab_status
// both render. `applied` is only "the current pick shipped" when the stamp postdates the pick.
export function readHandoffState(projectDir) {
  const selection = readJson(selectionPath(projectDir));
  const applied = readJson(appliedPath(projectDir));
  const waiting = readJson(waitingPath(projectDir));
  const heartbeat = readJson(heartbeatPath(projectDir));
  const heartbeatFresh = heartbeat?.at && (Date.now() - heartbeat.at) < 2 * 60 * 1000;
  const appliedCurrent = !!(
    applied &&
    selection &&
    Date.parse(applied.at || 0) >= Date.parse(selection.pickedAt || 0)
  );
  const request = readJson(requestPath(projectDir));
  return {
    selection: selection
      ? { direction: selection.direction ?? null, pickedAt: selection.pickedAt ?? null, roles: selection.roles ?? null }
      : null,
    applied: applied ? { ...applied, current: appliedCurrent } : null,
    agentWaiting: !!waiting || !!heartbeatFresh,
    waitingSince: waiting?.since ?? null,
    request: request?.status === "pending" ? { at: request.at ?? null, brief: request.brief ?? {} } : null,
  };
}
