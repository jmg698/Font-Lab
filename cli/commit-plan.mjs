// The commit plan — the machine-readable answer to "what do I actually commit?", built by
// folding Font Lab's own edit ledger (edits.log.jsonl) against what git actually sees.
//
// The ledger alone can't be the plan: undone writes stay logged on purpose (the file WAS
// rewritten), files the human edited themselves never enter it, and a repo that predates the
// self-ignoring scaffold has tracked files no .gitignore can hide. So every classification
// here is cross-checked against `git status --porcelain` / `git ls-files`, and the output
// carries ready-to-run commands — the agent relays them; the human runs them.
//
// Piles:
//   ship         the human's work (copy edits, font applies, rewires) — dirty in git, commit it
//   clean        logged by Font Lab but byte-identical to HEAD (undone, or already committed)
//   verify       rewritten-then-restored files that still differ from HEAD — inspect git diff
//   scaffold     the dev-panel pile (app/_fontlab, public/fontlab preview staging, the mount)
//   installHooks the install grafts (AGENTS.md block, .mcp.json, rules, hooks) — keep or uninstall
//   notFontLab   dirty files Font Lab never wrote — the human's own parallel work, listed, never
//                prescribed
//
// Degrades honestly without git (no binary, not a repo): classification falls back to the
// ledger alone and says so, instead of pretending the cross-check happened.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  readSourceChanges,
  readHandoffState,
  scaffoldMounted,
  PANEL_DIRS,
  PREVIEW_FONT_DIR,
  FL_DIR,
  GITIGNORE_MARK,
} from "./state.mjs";

const SHIP_KINDS = new Set(["font-apply", "rewire", "text-edit"]);
const SCAFFOLD_KINDS = new Set(["scaffold", "unscaffold"]);

const stripSlash = (p) => String(p).replace(/\/+$/, "");
const underDir = (p, dir) => p === dir || p.startsWith(dir + "/");

// ---- git probes (each degrades to null instead of throwing) --------------------------------

function git(projectDir, args) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitInfo(projectDir) {
  try {
    const out = git(projectDir, ["rev-parse", "--is-inside-work-tree"]).trim();
    return { available: true, inRepo: out === "true" };
  } catch (e) {
    return { available: e?.code !== "ENOENT", inRepo: false };
  }
}

// `git status --porcelain -z`: entries NUL-separated; a rename is two records (new, then old).
// Returns [{ path, xy, untracked }] with dir entries kept as-reported (e.g. "public/fontlab/").
// Porcelain paths are REPO-ROOT-relative (unlike ls-files, which is cwd-relative) — in a
// monorepo the project may live in a subdir, so strip the project's prefix and drop entries
// outside it entirely: a sibling package's dirty files are not this plan's business, and a
// prefix mismatch must never silently demote the human's real work to "clean".
function porcelain(projectDir) {
  let raw, prefix;
  try {
    prefix = git(projectDir, ["rev-parse", "--show-prefix"]).trim();
    raw = git(projectDir, ["status", "--porcelain", "-z"]);
  } catch {
    return null;
  }
  const parts = raw.split("\0").filter((s) => s.length);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    let p = rec.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++; // the following record is the rename/copy source
    if (prefix) {
      if (!p.startsWith(prefix)) continue; // outside this project
      p = p.slice(prefix.length);
    }
    entries.push({ path: p, xy, untracked: xy === "??" });
  }
  return entries;
}

function lsFiles(projectDir, paths) {
  try {
    const raw = git(projectDir, ["ls-files", "-z", "--", ...paths]);
    return raw.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

// ---- the plan ------------------------------------------------------------------------------

export function buildCommitPlan(projectDir) {
  const dir = path.resolve(projectDir);
  const changes = readSourceChanges(dir);
  const state = readHandoffState(dir);
  const gitState = gitInfo(dir);
  const entries = gitState.inRepo ? porcelain(dir) : null;

  // Everything git sees, plus a prefix lookup so a logged dir ("public/fontlab/") matches the
  // files git reports under it and vice versa.
  const dirty = entries ?? [];
  const dirtyPaths = dirty.map((e) => stripSlash(e.path));
  const isDirty = (logged) => {
    const p = stripSlash(logged);
    return dirty.some((e) => {
      const g = stripSlash(e.path);
      return g === p || underDir(g, p) || underDir(p, g);
    });
  };

  // public/fontlab is preview staging only while the panel story is in play — on a css-entry
  // ship those woff2 are runtime assets. The ledger is the tiebreaker: a scaffold-kind entry
  // naming it, or a mounted panel, marks it scaffold.
  const panelInPlay =
    scaffoldMounted(dir) ||
    changes.files.some((f) => underDir(stripSlash(f.path), PREVIEW_FONT_DIR) && f.kinds.some((k) => SCAFFOLD_KINDS.has(k)));
  const scaffoldRoots = [...PANEL_DIRS, ...(panelInPlay ? [PREVIEW_FONT_DIR] : [])];
  const isScaffoldPath = (p) => scaffoldRoots.some((root) => underDir(stripSlash(p), root));

  // ---- fold the ledger into piles, git-verified where git exists -------------------------
  const ship = [];
  const clean = [];
  const verify = [];
  const loggedPaths = [];
  for (const f of changes.files) {
    const p = stripSlash(f.path);
    loggedPaths.push(p);
    if (isScaffoldPath(p)) continue; // the scaffold pile is assembled from disk+git below
    const hasShip = f.kinds.some((k) => SHIP_KINDS.has(k));
    const hasScaffoldKind = f.kinds.some((k) => SCAFFOLD_KINDS.has(k));
    if (gitState.inRepo && !isDirty(p)) {
      // Rewritten at some point, byte-identical to HEAD now — undone, or already committed.
      clean.push({ path: p, kinds: f.kinds });
      continue;
    }
    if (hasShip) {
      const entry = { path: p, kinds: f.kinds };
      if (hasScaffoldKind && scaffoldMounted(dir))
        entry.note = "also carries the dev-panel mount — run font_lab_finish first so only the product change remains";
      ship.push(entry);
    } else if (!hasScaffoldKind) {
      // Only undo-* kinds and still dirty: the restore didn't land it back on HEAD. Don't
      // prescribe a commit — hand the human the diff question.
      verify.push({ path: p, kinds: f.kinds });
    }
  }

  // ---- the scaffold pile: what's on disk, what git can see, what git already tracks -------
  const presentDirs = scaffoldRoots.filter((r) => existsSync(path.join(dir, r)));
  const selfIgnored = presentDirs.filter((r) => {
    try {
      return readFileSync(path.join(dir, r, ".gitignore"), "utf8").startsWith(GITIGNORE_MARK);
    } catch {
      return false;
    }
  });
  const visibleInGit = gitState.inRepo ? dirtyPaths.filter((p) => isScaffoldPath(p)) : [];
  const trackedFiles = gitState.inRepo ? lsFiles(dir, [...scaffoldRoots, FL_DIR]) : [];
  const trackedRoots = [...new Set(trackedFiles.map((f) => [...scaffoldRoots, FL_DIR].find((r) => underDir(f, r))).filter(Boolean))];
  const layoutMounted = scaffoldMounted(dir);

  // ---- install hooks: in-repo grafts that are legitimately a human decision ---------------
  const hookCandidates = [
    { path: "AGENTS.md", ours: (t) => t.includes("<!-- font-lab:start -->") },
    { path: ".mcp.json", ours: (t) => t.includes('"font-lab"') },
    { path: path.join(".vscode", "mcp.json"), ours: (t) => t.includes('"font-lab"') },
    { path: path.join(".cursor", "rules", "font-lab.mdc"), ours: () => true },
    { path: path.join(".claude", "settings.json"), ours: (t) => t.includes("pending-pick-hook.mjs") },
  ];
  const installHooks = [];
  for (const c of hookCandidates) {
    const abs = path.join(dir, c.path);
    if (!existsSync(abs)) continue;
    let ours = false;
    try {
      ours = c.ours(readFileSync(abs, "utf8"));
    } catch {}
    if (!ours) continue;
    const rel = c.path.split(path.sep).join("/");
    installHooks.push({ path: rel, inGit: gitState.inRepo ? (isDirty(rel) ? "uncommitted" : "committed-or-clean") : "unknown" });
  }

  // ---- everything else dirty: the human's own work, listed but never prescribed -----------
  const known = (p) =>
    loggedPaths.some((lp) => underDir(p, lp) || underDir(lp, p)) ||
    isScaffoldPath(p) ||
    underDir(p, FL_DIR) ||
    installHooks.some((h) => underDir(p, h.path) || underDir(h.path, p));
  const notFontLab = gitState.inRepo ? dirtyPaths.filter((p) => !known(p)) : [];

  // ---- suggested message + ready-to-run commands ------------------------------------------
  const textEdits = ship.filter((f) => f.kinds.includes("text-edit")).length;
  const appliedCurrent = !!state.applied?.current;
  const fam = (r) => state.selection?.roles?.[r]?.family;
  let suggestedMessage = null;
  if (appliedCurrent && state.selection?.direction) {
    const families = [fam("display"), fam("body")].filter(Boolean).join(" / ");
    suggestedMessage = `Ship "${state.selection.direction.name ?? state.selection.direction.id ?? "font pick"}"${families ? ` — ${families}` : ""}`;
    if (textEdits) suggestedMessage += ` · ${textEdits} copy edit${textEdits === 1 ? "" : "s"}`;
  } else if (textEdits) {
    suggestedMessage = `Copy edits via Font Lab (${textEdits} file${textEdits === 1 ? "" : "s"})`;
  }

  const q = (p) => (/[^A-Za-z0-9._\/-]/.test(p) ? JSON.stringify(p) : p);
  const commands = [];
  const trackedFix = trackedRoots.length
    ? `git rm -r --cached -- ${trackedRoots.map(q).join(" ")}  # stop tracking Font Lab scaffolding (now self-ignored)`
    : null;
  if (trackedFix) commands.push(trackedFix);
  if (ship.length) {
    commands.push(`git add -- ${ship.map((f) => q(f.path)).join(" ")}`);
    if (suggestedMessage) commands.push(`git commit -m ${JSON.stringify(suggestedMessage)}`);
  }

  const bits = [];
  if (ship.length) bits.push(`${ship.length} file${ship.length === 1 ? "" : "s"} to commit`);
  if (layoutMounted || presentDirs.length) bits.push("dev-panel scaffolding still mounted — font_lab_finish removes it");
  if (trackedRoots.length) bits.push(`${trackedRoots.length} scaffold path${trackedRoots.length === 1 ? "" : "s"} tracked by git (see commands)`);
  if (verify.length) bits.push(`${verify.length} restored file${verify.length === 1 ? "" : "s"} to eyeball in git diff`);
  if (!bits.length) bits.push(gitState.inRepo ? "working tree carries no Font Lab changes to commit" : "no Font Lab source changes logged");

  return {
    git: gitState.inRepo
      ? { available: true, inRepo: true }
      : { ...gitState, note: gitState.available ? "not a git repo — plan built from Font Lab's edit log alone" : "git not found — plan built from Font Lab's edit log alone" },
    ship: {
      files: ship,
      note: "The human's work — copy edits, the font apply, rewires. One commit, message about the content.",
    },
    scaffold: {
      mounted: layoutMounted,
      dirs: presentDirs,
      selfIgnored,
      visibleInGit,
      tracked: trackedRoots.length ? { roots: trackedRoots, files: trackedFiles.length, fix: trackedFix } : null,
      note: presentDirs.length || layoutMounted
        ? "Font Lab's dev tooling — font_lab_finish strips it; or leave it (self-ignored, invisible to git) if the human keeps exploring."
        : "no panel scaffolding present",
    },
    installHooks: {
      files: installHooks,
      note: installHooks.length
        ? "Install wiring (MCP/instructions/hooks). Keep them committed if the team should have Font Lab ready; font_lab_finish with uninstall:true removes them."
        : "none present",
    },
    verify: { files: verify, note: verify.length ? "rewritten then restored, but still differs from HEAD — check git diff before committing" : "" },
    clean: { files: clean, note: clean.length ? "logged by Font Lab but identical to HEAD now (undone or already committed) — nothing to do" : "" },
    notFontLab: {
      files: notFontLab,
      note: notFontLab.length ? "dirty in git but never written by Font Lab — the human's own parallel work; not yours to stage" : "",
    },
    suggestedMessage,
    commands,
    summary: bits.join("; "),
  };
}
