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
//   edits.log.jsonl  append-only record of every SOURCE file Font Lab wrote — "what do I commit?"
//
// None of it is source. The dir ignores itself (see ensureFlDir), so a session's worth of
// state never lands in the human's git diff at commit time.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
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

// ---- self-ignoring dirs ------------------------------------------------------------------
// The trick that keeps Font Lab out of the human's git diff: a `*` .gitignore INSIDE a dir we
// own keeps everything there out of `git status` without ever touching the root .gitignore
// (the .next / cargo-target pattern — git honors nested ignore files even untracked). The
// first line always starts with GITIGNORE_MARK so we can recognize OUR file later and remove
// it without ever clobbering a .gitignore the human wrote themselves (their edit is the opt-out).

export const GITIGNORE_MARK = "# Font Lab";

export function ensureSelfIgnoredDir(dir, note) {
  mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, ".gitignore");
  if (!existsSync(gi)) {
    try {
      writeFileSync(gi, `${GITIGNORE_MARK} ${note} — regenerated as needed; never commit.\n*\n`);
    } catch {} // a state write must not fail because the marker couldn't be written
  }
  return dir;
}

// Remove a .gitignore only when WE wrote it (first line carries the mark). Used when a dir
// changes meaning from preview staging to ship destination (css-entry apply self-hosts real
// runtime assets into <staticDir>/fontlab/ — those bytes belong in the repo), and by the
// tracked-scaffold opt-in.
export function removeFontLabGitignore(dir) {
  const gi = path.join(dir, ".gitignore");
  try {
    if (existsSync(gi) && readFileSync(gi, "utf8").startsWith(GITIGNORE_MARK)) {
      rmSync(gi, { force: true });
      return true;
    }
  } catch {}
  return false;
}

// Every .font-lab writer funnels through here so the state dir is born self-ignoring.
// Existing installs heal on their next state write.
export function ensureFlDir(projectDir) {
  return ensureSelfIgnoredDir(flDir(projectDir), "local state (backups, picks, heartbeats)");
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

// ---- the source-edit log -----------------------------------------------------------------
// Font Lab knows exactly which source files it wrote (copy edits, font applies, rewires,
// undos, panel scaffolding) — but it used to discard that the moment each toast faded, leaving
// the human to reverse-engineer "what do I actually commit?" out of a 100-file git status.
// Every source write now appends one JSON line here; readSourceChanges() folds the log into
// the deduped list font_lab_status and GET /status expose.

export const EDITLOG_FILE = "edits.log.jsonl";
export const editLogPath = (projectDir) => path.join(flDir(projectDir), EDITLOG_FILE);

// Best-effort by design: a logging failure must never fail the edit it records.
export function appendSourceEdit(projectDir, { kind, files, runId, detail } = {}) {
  try {
    ensureFlDir(projectDir);
    const entry = {
      at: new Date().toISOString(),
      kind: kind || "edit",
      files: (files || []).filter(Boolean).map(String),
      ...(runId ? { runId } : {}),
      ...(detail ? { detail: String(detail).slice(0, 200) } : {}),
    };
    appendFileSync(editLogPath(projectDir), JSON.stringify(entry) + "\n");
    return entry;
  } catch {
    return null;
  }
}

// The deduped "what changed" view: every source path Font Lab has written, most recently
// touched first, each carrying the kinds of writes that hit it. `scaffold`/`unscaffold`-only
// paths are the dev-tooling pile (commit separately, or not at all); everything else is the
// human's actual work. Undone writes stay listed on purpose — the file WAS rewritten (the
// restore included), and `git diff` is the judge of whether it ended up back where it started.
export function readSourceChanges(projectDir) {
  let lines = [];
  try {
    lines = readFileSync(editLogPath(projectDir), "utf8").split("\n").filter(Boolean);
  } catch {}
  const byPath = new Map();
  let lastAt = null;
  let writes = 0;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    writes++;
    if (e.at) lastAt = e.at;
    for (const p of e.files || []) {
      const cur = byPath.get(p) || { path: p, kinds: [], writes: 0, lastAt: null };
      if (e.kind && !cur.kinds.includes(e.kind)) cur.kinds.push(e.kind);
      cur.writes++;
      cur.lastAt = e.at || cur.lastAt;
      byPath.delete(p); // re-insert so Map order is by most recent touch
      byPath.set(p, cur);
    }
  }
  return { writes, lastAt, files: [...byPath.values()].reverse() };
}

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

// ---- the "I'm done" signal ---------------------------------------------------------------
// The panel's Done button (and font-lab serve's POST /done) land here: the human says the
// choosing session is over. Persisted like the "more options" ask so it survives no agent
// listening at click time; font_lab_finish (or any tool result's pendingCleanup note) picks it
// up. Cleared by finish.

export const DONE_FILE = "done.json";
export const donePath = (projectDir) => path.join(flDir(projectDir), DONE_FILE);

export function writeDoneRequest(projectDir, { note } = {}) {
  ensureFlDir(projectDir);
  const req = { status: "pending", at: new Date().toISOString(), ...(note ? { note: String(note).slice(0, 200) } : {}) };
  writeFileSync(donePath(projectDir), JSON.stringify(req, null, 2) + "\n");
  return req;
}

export const readDoneRequest = (projectDir) => {
  const r = readJson(donePath(projectDir));
  return r?.status === "pending" ? r : null;
};
export const clearDoneRequest = (projectDir) => rmSync(donePath(projectDir), { force: true });

// ---- scaffold presence -------------------------------------------------------------------
// The tiny fs-only answer to "is the dev-panel scaffolding still in the project?" — shared by
// the commit plan, the pendingCleanup piggyback, and the turn-start hook (which must stay
// light: no engine import). The layout marker string is the same fence engine.init writes.

export const INIT_MARKER = "// font-lab:init:start";

// The dirs Font Lab may scaffold for the live panel, relative to the project root. public/
// fontlab is scaffold ONLY on the panel path — a css-entry apply ships real runtime assets
// there, which is why classification always cross-checks panelScaffold too.
export const PANEL_DIRS = ["app/_fontlab", "src/app/_fontlab"];
export const PREVIEW_FONT_DIR = "public/fontlab";

export function scaffoldMounted(projectDir) {
  for (const d of PANEL_DIRS) if (existsSync(path.join(projectDir, d))) return true;
  for (const d of ["app", "src/app"]) {
    try {
      if (readFileSync(path.join(projectDir, d, "layout.tsx"), "utf8").includes(INIT_MARKER)) return true;
    } catch {}
  }
  return false;
}

// The human's choice to keep the panel scaffolding tracked in git (`font_lab_init` with
// tracked:true). Persisted so a later prepare/more-directions rebuild doesn't silently re-add
// the self-ignore they opted out of.
export const SCAFFOLD_PREFS_FILE = "scaffold.json";
export const scaffoldPrefsPath = (projectDir) => path.join(flDir(projectDir), SCAFFOLD_PREFS_FILE);

export function writeScaffoldPrefs(projectDir, { tracked } = {}) {
  ensureFlDir(projectDir);
  const prefs = { tracked: tracked === true, at: new Date().toISOString() };
  writeFileSync(scaffoldPrefsPath(projectDir), JSON.stringify(prefs, null, 2) + "\n");
  return prefs;
}

export const readScaffoldPrefs = (projectDir) => readJson(scaffoldPrefsPath(projectDir));

// ---- the install footprint ---------------------------------------------------------------
// `font-lab install` touches files in AND out of the repo (MCP configs, skill dir, AGENTS.md
// block, hooks). The manifest is the receipt: what got wired, where, at which version — so
// status can show the full footprint honestly and the commit plan can classify the in-repo
// hooks. Removal stays registry-driven (install.mjs knows every host); the manifest documents.

export const INSTALL_MANIFEST_FILE = "install.json";
export const installManifestPath = (projectDir) => path.join(flDir(projectDir), INSTALL_MANIFEST_FILE);

export function writeInstallManifest(projectDir, manifest) {
  try {
    ensureFlDir(projectDir);
    writeFileSync(installManifestPath(projectDir), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  } catch {
    return null;
  }
}

export const readInstallManifest = (projectDir) => readJson(installManifestPath(projectDir));
export const clearInstallManifest = (projectDir) => rmSync(installManifestPath(projectDir), { force: true });

export function setAgentWaiting(projectDir, on) {
  ensureFlDir(projectDir);
  if (on) writeFileSync(waitingPath(projectDir), JSON.stringify({ since: new Date().toISOString(), pid: process.pid }) + "\n");
  else rmSync(waitingPath(projectDir), { force: true });
}

// The dev server's origin, as reported by the panel itself (EventSource connect carries
// ?origin=location.origin). The panel is the only party that KNOWS the dev URL for certain —
// and it can't report the server being DOWN (no server, no panel), so the record here is what
// lets font_lab_status health-check it after the fact, and what verify/screenshots default
// their baseUrl to.
export const DEVSERVER_FILE = "devserver.json";
export const devServerPath = (projectDir) => path.join(flDir(projectDir), DEVSERVER_FILE);

export function writeDevServer(projectDir, origin) {
  try {
    ensureFlDir(projectDir);
    writeFileSync(devServerPath(projectDir), JSON.stringify({ origin, at: new Date().toISOString() }) + "\n");
  } catch {}
}

export const readDevServer = (projectDir) => readJson(devServerPath(projectDir));

// ---- the capture-blocked marker ------------------------------------------------------------
// The real-site screenshot path (font_lab_screenshot_directions) is THE choosing surface on
// every non-panel stack — the generic specimen sheet exists only for when it genuinely can't
// run. This marker is how that ladder is ENFORCED instead of documented: a real capture attempt
// that fails on infrastructure (no Playwright driver, no launchable browser, the dev server
// wouldn't start, the page wouldn't render) records WHY here, and only then does the specimen
// sheet unlock (font_lab_preview / font_lab_preview_screenshots check it). A successful capture
// clears it. Nothing else writes it — so "the sheet was used" always implies "screenshots were
// actually tried first" (or force:true, the human's explicit ask for the offline artifact).

export const CAPTURE_BLOCKED_FILE = "capture-blocked.json";
export const captureBlockedPath = (projectDir) => path.join(flDir(projectDir), CAPTURE_BLOCKED_FILE);

export function writeCaptureBlocked(projectDir, { stage, error } = {}) {
  try {
    ensureFlDir(projectDir);
    const rec = { stage: stage || "capture", error: String(error || "").slice(0, 600), at: new Date().toISOString() };
    writeFileSync(captureBlockedPath(projectDir), JSON.stringify(rec, null, 2) + "\n");
    return rec;
  } catch {
    return null;
  }
}

export const readCaptureBlocked = (projectDir) => readJson(captureBlockedPath(projectDir));
export const clearCaptureBlocked = (projectDir) => rmSync(captureBlockedPath(projectDir), { force: true });

export function refreshAgentHeartbeat(projectDir) {
  try {
    ensureFlDir(projectDir);
    writeFileSync(heartbeatPath(projectDir), JSON.stringify({ at: Date.now(), pid: process.pid }) + "\n");
  } catch {}
}

export function clearAgentHeartbeat(projectDir) {
  try { rmSync(heartbeatPath(projectDir), { force: true }); } catch {}
}

// ---- the undelivered pick ------------------------------------------------------------------
// The durable-delivery predicate: a selection newer than the last apply stamp is a pick the
// human made that no agent has shipped yet. It has NO expiry — a pick is a standing decision,
// and auto-expiring it would re-lose the very thing this exists to deliver. Past a week we say
// it's old so the agent confirms it still stands instead of silently applying.

const formatAge = (ms) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "moments";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

// Render the pick's ship scope (declared by the panel at pick time — selection.preview.scope)
// into one agent-readable sentence: which roles auto-ship, which the agent wires, and which
// island clusters global wiring can't reach. Null when the pick predates scope declaration
// (e.g. written by font_lab_select rather than the panel).
export function describePickScope(selection) {
  const scope = selection?.preview?.scope;
  if (!Array.isArray(scope) || !scope.length) return null;
  const auto = scope.filter((s) => s.autoShipSeam).map((s) => s.role);
  const wired = scope.filter((s) => !s.autoShipSeam).map((s) => s.role);
  const islands = scope.flatMap((s) => (s.islands || []).map((c) => c.label || `${s.role} island`));
  const route = selection.preview?.route || "/";
  const parts = [];
  if (auto.length) parts.push(`auto-ships: ${auto.join(", ")}`);
  if (wired.length) parts.push(`agent wires: ${wired.join(", ")} (no auto-ship seam — font_lab_apply won't reach these)`);
  if (islands.length)
    parts.push(
      `${islands.length} island cluster${islands.length === 1 ? "" : "s"} on ${route} (${[...new Set(islands)].slice(0, 3).join(" · ")}) — ask the human before changing intentional per-route fonts`,
    );
  return parts.length ? parts.join("; ") : null;
}

export function pendingPick(projectDir) {
  const selection = readJson(selectionPath(projectDir));
  if (!selection) return null;
  const applied = readJson(appliedPath(projectDir));
  if (applied && Date.parse(applied.at || 0) >= Date.parse(selection.pickedAt || 0)) return null;
  const ageMs = Math.max(0, Date.now() - (Date.parse(selection.pickedAt || "") || Date.now()));
  return {
    direction: selection.direction ?? null,
    pickedAt: selection.pickedAt ?? null,
    age: formatAge(ageMs),
    stale: ageMs > 7 * 24 * 3600_000,
    roles: selection.roles ?? null,
    route: selection.preview?.route ?? null,
    scope: describePickScope(selection),
  };
}

// A parked marker is only as live as the process that wrote it — an agent host killed mid-wait
// (an IDE reload, a SIGKILL) leaves the file behind, and trusting it would show "AGENT LISTENING"
// forever. Signal 0 probes without sending; EPERM still means the process exists.
const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code === "EPERM"; }
};

// One assembled snapshot of the handoff — what the panel's status pill and font_lab_status
// both render. `applied` is only "the current pick shipped" when the stamp postdates the pick.
export function readHandoffState(projectDir) {
  const selection = readJson(selectionPath(projectDir));
  const applied = readJson(appliedPath(projectDir));
  const waiting = readJson(waitingPath(projectDir));
  const parked = !!waiting && (!waiting.pid || pidAlive(waiting.pid));
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
    // Two grades of presence, split because they promise different things. `agentParked`: a live
    // process is blocked on this project's events RIGHT NOW (wait loop / serve --once) — "your
    // agent is composing" is true. `agentRecent`: an MCP tool ran in the last 2 minutes — the
    // agent exists but, on turn-based hosts, acts only when the human next messages it.
    // Conflating them is how the panel once said "sent to your agent ✓" to nobody (see
    // docs/DOGFOOD-REPORT.md). `agentWaiting` keeps the merged value for old consumers.
    agentParked: parked,
    agentRecent: !!heartbeatFresh,
    agentWaiting: parked || !!heartbeatFresh,
    waitingSince: waiting?.since ?? null,
    request: request?.status === "pending" ? { at: request.at ?? null, brief: request.brief ?? {} } : null,
    // The human's in-panel "I'm done" click, pending until font_lab_finish clears it.
    done: readDoneRequest(projectDir),
    // "What did Font Lab actually change?" — the deduped source files, for the commit moment.
    sourceChanges: readSourceChanges(projectDir),
  };
}
