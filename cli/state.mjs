// Font Lab handoff state — the tiny shared vocabulary between the pick endpoint (serve),
// the engine (wait_for_pick / status / apply), and codegen (the applied stamp).
//
// Everything lives in <project>/.font-lab/ as plain JSON so any process — the panel's
// endpoint, an MCP tool call, a bare CLI — can read the same truth without coordination:
//   selection.json   the human's pick (written by the panel endpoint / select)
//   applied.json     stamp of the last successful apply (written by codegen)
//   agent-waiting.json  present while an agent is blocked in waitForPick (presence signal)
//   menu.json        how the mounted menu was built (composed vs fallback) — the provisional flag
//   request.json     the human's in-panel "more options" ask, queued until an agent fulfills it

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

export const FL_DIR = ".font-lab";
export const SELECTION_FILE = "selection.json";
export const APPLIED_FILE = "applied.json";
export const WAITING_FILE = "agent-waiting.json";
export const MENU_FILE = "menu.json";
export const REQUEST_FILE = "request.json";

export const flDir = (projectDir) => path.join(projectDir, FL_DIR);
export const selectionPath = (projectDir) => path.join(flDir(projectDir), SELECTION_FILE);
export const appliedPath = (projectDir) => path.join(flDir(projectDir), APPLIED_FILE);
export const waitingPath = (projectDir) => path.join(flDir(projectDir), WAITING_FILE);
export const menuPath = (projectDir) => path.join(flDir(projectDir), MENU_FILE);
export const requestPath = (projectDir) => path.join(flDir(projectDir), REQUEST_FILE);

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

export function writeAppliedStamp(projectDir, result) {
  mkdirSync(flDir(projectDir), { recursive: true });
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
  mkdirSync(flDir(projectDir), { recursive: true });
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
  mkdirSync(flDir(projectDir), { recursive: true });
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
  mkdirSync(flDir(projectDir), { recursive: true });
  if (on) writeFileSync(waitingPath(projectDir), JSON.stringify({ since: new Date().toISOString(), pid: process.pid }) + "\n");
  else rmSync(waitingPath(projectDir), { force: true });
}

// One assembled snapshot of the handoff — what the panel's status pill and font_lab_status
// both render. `applied` is only "the current pick shipped" when the stamp postdates the pick.
export function readHandoffState(projectDir) {
  const selection = readJson(selectionPath(projectDir));
  const applied = readJson(appliedPath(projectDir));
  const waiting = readJson(waitingPath(projectDir));
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
    agentWaiting: !!waiting,
    waitingSince: waiting?.since ?? null,
    // a pending "more options" ask (so the panel can show "waiting for your agent" across reloads)
    request: request?.status === "pending" ? { at: request.at ?? null, brief: request.brief ?? {} } : null,
  };
}
