#!/usr/bin/env node
// Font Lab CLI — entry point.
//
// Subcommands:
//   install            wire Font Lab into your machine + project (skill + MCP server)
//   uninstall          undo the above
//   mcp                run the MCP server (stdio) — what `.mcp.json` launches
//   serve  (default)   run the localhost write-back endpoint the dev panel POSTs a pick to,
//                      persist it to `.font-lab/selection.json` (+ append picks.log.jsonl).
//                      This is the seam where codegen hooks in: pick lands here -> agent ships it.
//
// Usage:
//   npx font-lab install [--project <dir>] [--no-mcp] [--local] [--dry-run]
//   npx font-lab uninstall [--project <dir>]
//   node cli/font-lab.mjs [serve] [--project <dir>] [--port <n>] [--apply]

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";

// ---- subcommand dispatch ---------------------------------------------------
// CRITICAL: a metadata probe must NEVER boot the long-running server. Agents routinely run
// `font-lab --version` / `-v` to sanity-check an install; the old dispatch treated ANY leading
// flag as `serve`, so `--version` silently started the pick endpoint on :7777 and hung (or got
// pkill'd). Only KNOWN serve flags mean serve; every other flag/unknown word prints help.
const first = process.argv[2];
const isServeFlag = (a) => ["--project", "--port", "--host", "--once", "--apply", "-p"].includes(a);
let SUB;
if (!first || ["help", "--help", "-h"].includes(first)) SUB = "help";
else if (["--version", "-v", "version"].includes(first)) SUB = "version";
else if (["install", "uninstall", "mcp", "serve", "upgrade", "run"].includes(first)) SUB = first;
else if (isServeFlag(first)) SUB = "serve";
else SUB = "maybe-tool"; // an unknown WORD may be a tool name; anything else -> help, never surprise-boot the server

if (SUB === "install" || SUB === "uninstall") {
  const { runInstall, runUninstall } = await import("./install.mjs");
  if (SUB === "install") runInstall();
  else runUninstall();
} else if (SUB === "upgrade") {
  await runUpgrade();
} else if (SUB === "mcp") {
  await import("./mcp.mjs"); // self-runs the stdio server on import
} else if (SUB === "run") {
  await runTool();
} else if (SUB === "maybe-tool") {
  // `font-lab init`, `font-lab screenshot_directions`, … — the dogfood typo class: a tool name
  // without `run` used to print the generic help, which read as "init doesn't exist". Any word
  // that resolves in the tool table IS a run call; everything else still gets help (and a flag
  // never lands here, so a metadata probe can't boot the server by accident).
  const { findTool } = await import("./tools.mjs");
  if (!first.startsWith("-") && findTool(first)) await runTool(2);
  else printHelp();
} else if (SUB === "version") {
  try {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
  } catch {
    console.log("unknown");
  }
} else if (SUB === "help") {
  printHelp();
} else {
  runServe();
}

function printHelp() {
  console.log(
    [
      "Font Lab",
      "  font-lab install [--host <list|all>] [--project <dir>] [--no-mcp] [--no-skill] [--local] [--dry-run]",
      "  font-lab uninstall [--project <dir>]",
      "  font-lab upgrade [--project <dir>]  one-command upgrade: package install + panel re-stamp +",
      "                 endpoint shutdown + MCP/skill re-pin (then reload your agent session)",
      "  font-lab mcp                      run the MCP server (stdio)",
      "  font-lab run [<tool>] [<json>]    call any font_lab_* tool one-shot, JSON in/out — the",
      "                 SAME tools as the MCP server (use when MCP isn't live yet: fresh install",
      "                 before a session reload, or a dropped server). `font-lab run` lists them.",
      "                 e.g.: font-lab run font_lab_start '{\"projectDir\":\"/path/to/site\"}'",
      "                       font-lab run analyze --project .",
      "                 (`font-lab <tool>` with no `run` works too: font-lab init --project .)",
      "  font-lab serve [--project <dir>] [--port <n>] [--host <ip>] [--once] [--apply]",
      "                 pick write-back endpoint (loopback-only by default; --once exits on the",
      "                 first panel event — a pick, a 'more options' request, or done ✓ — with",
      "                 the event JSON as the final stdout line, so a background task wakes",
      "                 your agent for any of them)",
      "  font-lab --version                print the version and exit (never starts a server)",
    ].join("\n"),
  );
}

// ---- run: any font_lab_* tool as a one-shot CLI call ---------------------------------------
// The MCP server's twin (same tool table — tools.mjs), for the two MCP dead zones: right after
// `font-lab install` (tools aren't live until the human reloads the session — but the agent has
// work to do NOW) and a dropped/reconnecting server mid-session on cloud harnesses. JSON args
// in (inline, --args, or stdin via '-'), the tool's JSON result on stdout, logs on stderr —
// identical behavior to the MCP call by construction.
async function runTool(argvFrom = 3) {
  const { TOOLS, findTool, missingArgsError, invokeTool, withDeliveryNotes } = await import("./tools.mjs");
  const { refreshAgentHeartbeat } = await import("./state.mjs");
  const argv = process.argv.slice(argvFrom); // 3 after `run <tool>`; 2 for the bare `<tool>` alias
  const flagVal = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const positional = argv.filter((a, i) => (a === "-" || !a.startsWith("--")) && argv[i - 1] !== "--args" && argv[i - 1] !== "--project");
  const name = positional[0];

  if (!name) {
    const listed = argv.includes("--list"); // an explicit list is a success, a bare `run` is usage help
    console.error("font-lab run — call any Font Lab tool one-shot (same table the MCP server serves).");
    console.error("usage: font-lab run <tool> ['<json-args>' | --args '<json>' | - (stdin)] [--project <dir>]\n");
    for (const t of TOOLS) console.error(`  ${t.name.padEnd(32)} ${t.description.split(/[.!—]/)[0].slice(0, 90)}`);
    console.error("\nexample: font-lab run font_lab_start '{\"projectDir\":\"/abs/path\"}'   (or: font-lab run start --project .)");
    process.exit(listed ? 0 : 1);
  }
  const tool = findTool(name);
  if (!tool) {
    console.error(`unknown tool "${name}" — known: ${TOOLS.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  let raw = flagVal("--args") ?? positional[1] ?? null;
  if (raw === "-") {
    raw = "";
    for await (const chunk of process.stdin) raw += chunk;
  }
  let args = {};
  if (raw && raw.trim()) {
    try {
      args = JSON.parse(raw);
    } catch (e) {
      console.error(`--args isn't valid JSON (${e.message}). Pass the tool's arguments as one JSON object, e.g. '{"projectDir":"/abs/path"}'.`);
      process.exit(1);
    }
  }
  // Convenience: --project <dir> fills projectDir so simple calls need no JSON at all.
  const proj = flagVal("--project");
  if (proj && args.projectDir === undefined && tool.inputSchema?.properties?.projectDir) args.projectDir = path.resolve(proj);

  const missing = missingArgsError(tool, args);
  if (missing) {
    console.error(missing);
    console.error(`schema: ${JSON.stringify(tool.inputSchema)}`);
    process.exit(1);
  }
  if (args.projectDir) { try { refreshAgentHeartbeat(args.projectDir); } catch {} }
  const log = (m) => process.stderr.write(String(m) + "\n");
  try {
    const out = await invokeTool(tool, args, { log });
    const payload = withDeliveryNotes(tool.name, args, out);
    console.log(JSON.stringify(payload ?? null, null, 2));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }, null, 2));
    process.exit(2);
  }
}

// ---- upgrade: the four version copies, moved in one command --------------------------------
// One version of font-lab lives in four places that update independently — node_modules (npm),
// the MCP registration (host config), the running :7777 endpoint (boot-time), and the panel
// stamped into the repo (init). This is the single verb that moves them together; every runtime
// drift detector (endpoint /status, the MCP piggyback warning, the panel banner) points here.
// NOT a postinstall hook on purpose: npm hides dependency script output, --ignore-scripts and
// CI make hooks unreliable, and a dependency editing the repo from postinstall is wrong.
async function runUpgrade() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
  };
  const PROJECT = path.resolve(arg("--project", process.cwd()));
  const PORT = Number(arg("--port", "7777"));
  const CONTINUE = process.argv.includes("--continue");
  const { spawnSync } = await import("node:child_process");
  const freshEntry = path.join(PROJECT, "node_modules", "font-lab", "font-lab.mjs");

  if (!CONTINUE) {
    console.log(`Font Lab — upgrade (${PROJECT})`);
    // 1) the package: install @latest as a project dep — the local install is also what the
    //    pinned MCP registration runs, so this step IS the MCP upgrade once pinned.
    const pm = existsSync(path.join(PROJECT, "pnpm-lock.yaml")) ? ["pnpm", "add"]
      : existsSync(path.join(PROJECT, "yarn.lock")) ? ["yarn", "add"]
      : existsSync(path.join(PROJECT, "bun.lockb")) || existsSync(path.join(PROJECT, "bun.lock")) ? ["bun", "add"]
      : ["npm", "install"];
    console.log(`  1/4  ${pm.join(" ")} font-lab@latest`);
    const r = spawnSync(pm[0], [pm[1], "font-lab@latest"], { cwd: PROJECT, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`  ✗ package install failed — fix that, then rerun \`npx font-lab upgrade\`.`);
      process.exit(1);
    }
    // 2-4) hand off to the NEWLY installed package so the rest runs on new logic, not this
    //      (possibly stale) copy. --continue skips the install and never re-delegates.
    if (existsSync(freshEntry) && path.resolve(freshEntry) !== path.resolve(fileURLToPath(import.meta.url))) {
      const rc = spawnSync(process.execPath, [freshEntry, "upgrade", "--continue", "--project", PROJECT, "--port", String(PORT)], { stdio: "inherit" });
      process.exit(rc.status ?? 0);
    }
    // dev checkout / no local install — continue with this copy
  }

  const { VERSION } = await import("./version.mjs");
  const engine = await import("./engine.mjs");

  // 2) MCP registration + skill/AGENTS block, re-pinned by the new package's own installer
  console.log(`  2/4  re-pin MCP + instructions (install)`);
  const { runInstall } = await import("./install.mjs");
  try { runInstall(); } catch (e) { console.error(`  ⚠ install step failed: ${e.message}`); }

  // 3) the panel stamped into the repo — re-stamp from the directions the human already has
  console.log(`  3/4  re-stamp the project panel`);
  const panelPath = ["app", "src/app"].map((d) => path.join(PROJECT, d, "_fontlab", "FontLabDevPanel.tsx")).find((p) => existsSync(p));
  if (!panelPath) console.log(`       no panel installed here — skipped (font_lab_init mounts one)`);
  else {
    try {
      const current = engine.readPreviewSet(PROJECT);
      const res = await engine.init(PROJECT, current.length ? { directions: current, log: () => {} } : { allowFallback: true, log: () => {} });
      console.log(`       panel re-stamped at v${VERSION} (${res.directions.length} directions kept)`);
    } catch (e) {
      console.error(`  ⚠ panel re-stamp failed: ${e.message} — run font_lab_init to refresh it.`);
    }
  }

  // 4) the running endpoint keeps its boot-time version — shut a stale same-project one down
  console.log(`  4/4  check the :${PORT} endpoint`);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/status`, { signal: AbortSignal.timeout(1200) });
    const st = r.ok ? await r.json() : null;
    if (st?.ok && (!st.project || path.resolve(st.project) === PROJECT)) {
      if (st.version !== VERSION) {
        const down = await fetch(`http://127.0.0.1:${PORT}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1200) }).then((x) => x.ok).catch(() => false);
        console.log(down
          ? `       stale endpoint (v${st.version}) shut down — restart it when needed: npx font-lab serve --project ${PROJECT}`
          : `       stale endpoint (v${st.version}) predates graceful shutdown — kill it (lsof -ti:${PORT} | xargs kill) and relaunch; new versions take the port over automatically.`);
      } else console.log(`       endpoint already on v${st.version} — left running`);
    } else if (st?.ok) console.log(`       :${PORT} serves a different project — left alone`);
    else console.log(`       endpoint not running — nothing to restart`);
  } catch {
    console.log(`       endpoint not running — nothing to restart`);
  }

  console.log(`\n  ✓ upgraded to v${VERSION}.`);
  console.log(`  Last step (only you can): RELOAD your agent session so the MCP server restarts on the new version.`);
}

async function runServe() {

const { readHandoffState, writeAppliedStamp, writeRequest, readRequest, writeDoneRequest, readMenuState, ensureFlDir, writeDevServer } = await import("./state.mjs");
const { VERSION, cmpVersions, isRealVersion } = await import("./version.mjs");
const { watch } = await import("node:fs");

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const PORT = Number(arg("--port", "7777"));
// Loopback by default: the panel always POSTs from a browser on this machine, and the
// endpoint accepts writes — no reason to listen on the LAN. `--host 0.0.0.0` opts back in
// (e.g. flipping directions from a phone on the same network).
const HOST = arg("--host", "127.0.0.1");
const PROJECT = path.resolve(arg("--project", process.cwd()));
const AUTO_APPLY = process.argv.includes("--apply"); // pick -> ship, in one step
// --once: exit on the first EVENT — a pick, a "more options" request, or the human's done ✓ —
// with the event JSON as the final stdout line. This turns every panel event into a
// process-exit signal — the one thing every agent harness reliably watches. (An agent runs
// `font-lab serve --once` as a background task, is woken when it exits, handles the event, and
// relaunches it.)
const ONCE = process.argv.includes("--once");
const FLDIR = path.join(PROJECT, ".font-lab");
const SELECTION = path.join(FLDIR, "selection.json");
const PICKLOG = path.join(FLDIR, "picks.log.jsonl");

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
};

// ---- SSE: the panel's live view of the handoff -----------------------------------------
// GET /events streams status snapshots so the panel can show, without polling: endpoint up,
// agent waiting (or --once armed), pick received, apply landed. Watching .font-lab/ means
// out-of-band writers (font_lab_select, apply from another terminal) surface here too.
const sseClients = new Set();
// The version on disk RIGHT NOW — vs VERSION, which was read at boot. `npm install` doesn't
// restart this process, so the two drift after an upgrade; reporting both lets the panel and
// font_lab_status say "endpoint outdated — restart npx font-lab" instead of leaving it silent.
const installedVersion = () => {
  try {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
  } catch {
    return VERSION;
  }
};
const statusPayload = () => {
  const state = readHandoffState(PROJECT);
  return {
    ok: true,
    once: ONCE,
    autoApply: AUTO_APPLY,
    version: VERSION, // running tool version — the panel compares it against its own stamp
    installed: installedVersion(), // package version on disk — differs from `version` after an un-restarted upgrade
    project: PROJECT, // which project this endpoint serves — the port-takeover triage reads it
    ...state,
    // --once means an agent parked a process on this event; count it as parked presence.
    agentParked: ONCE || state.agentParked,
    agentWaiting: ONCE || state.agentWaiting,
    // The menu's shape (mode + count) rides status so the panel can SEE the catalog grow —
    // the "your new options landed" toast diffs this count against what it's rendering.
    menu: readMenuState(PROJECT),
  };
};
// --once shutdown: print the event as the final stdout line (the harness hands it to the agent),
// give the ack + SSE frames a beat to flush, then exit unconditionally — an attached SSE client
// would otherwise hold server.close open. Shared by the pick and request exits.
const exitWithEvent = (payload) => {
  console.log(JSON.stringify(payload));
  setTimeout(() => {
    for (const c of sseClients) {
      try { c.destroy(); } catch {}
    }
    try { server.close(); } catch {}
    setTimeout(() => process.exit(0), 120);
  }, 80);
};
const broadcast = (event, data) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(frame);
};
ensureFlDir(PROJECT); // also drops the self-ignoring .gitignore so state never hits the git diff
let watchDebounce = null;
try {
  watch(FLDIR, () => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => broadcast("status", statusPayload()), 60);
  });
} catch {} // fs.watch is advisory here — POST /select broadcasts directly regardless
// Presence decays silently — a heartbeat expiring or a parked agent dying writes no file, so the
// watcher never fires and the panel's pill would overstate liveness forever. A slow re-broadcast
// keeps it honest; unref'd so it never holds the process open.
const presenceTick = setInterval(() => { if (sseClients.size) broadcast("status", statusPayload()); }, 45_000);
presenceTick.unref?.();

function printPick(sel) {
  const r = sel.roles || {};
  const fam = (x) => (x && x.family) || "?";
  console.log(`\n  ✓ picked "${sel.direction?.name ?? "?"}" (${sel.direction?.vibe ?? "?"})`);
  console.log(`      display ${fam(r.display)}   body ${fam(r.body)}   mono ${fam(r.mono)}`);
  console.log(`      wrote ${path.relative(process.cwd(), SELECTION)}`);
  console.log(`      → run \`npx font-lab-apply\` to ship it (next/font on Next; self-hosted @font-face elsewhere).\n`);
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(statusPayload()));
  }
  // Graceful takeover seam: a NEWER `font-lab serve` (or `font-lab upgrade`) asks this stale
  // endpoint to step aside instead of leaving the human an EADDRINUSE + lsof-and-kill dance.
  // Loopback-only even under --host 0.0.0.0 — it's a local upgrade affordance, not a remote
  // kill switch.
  if (req.method === "POST" && req.url === "/shutdown") {
    const ra = req.socket.remoteAddress || "";
    if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra)) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end('{"ok":false,"error":"shutdown is loopback-only"}');
    }
    console.log(`\n  ↻ shutdown requested (version takeover) — freeing :${PORT} for the newer endpoint`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, version: VERSION }));
    setTimeout(() => {
      for (const c of sseClients) { try { c.destroy(); } catch {} }
      try { server.close(); } catch {}
      setTimeout(() => process.exit(0), 80);
    }, 60);
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/events")) {
    // The panel identifies its dev server here (?origin=location.origin) — the one party that
    // knows the URL for certain. Recorded so font_lab_status can health-check the dev server
    // later (a dead dev server can't report itself) and verify/screenshots can default baseUrl.
    try {
      const origin = new URL(req.url, "http://x").searchParams.get("origin");
      if (origin && /^https?:\/\/[^\s]+$/.test(origin)) writeDevServer(PROJECT, origin);
    } catch {}
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`event: status\ndata: ${JSON.stringify(statusPayload())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.method === "GET" && req.url === "/selection") {
    const cur = existsSync(SELECTION) ? readFileSync(SELECTION, "utf8") : "{}";
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(cur);
  }
  if (req.method === "GET" && req.url === "/request") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(readRequest(PROJECT) || {}));
  }
  // ---- "more options" ask: the panel's "none of these" lands here ------------------------
  // The human wanted fresh directions (with the mini-brief they typed) — persist it and tell the
  // panel whether an agent is listening RIGHT NOW, so it can either say "sent to your agent" or
  // hand over the copy-a-prompt off-ramp. The ask persists on disk, so an agent that connects
  // later still fulfills it (via font_lab_wait_for_request → font_lab_more_directions).
  if (req.method === "POST" && req.url === "/request") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { brief, exclude } = JSON.parse(body || "{}");
        // Sample presence BEFORE writing (the request write itself wakes a blocked waiter, which
        // clears its flag — so afterwards we'd wrongly read "no agent" the instant one takes it).
        // Presence has two grades and the ack carries both: PARKED (a live process is blocked on
        // this project's events — "composing now" is an honest promise) vs RECENT (an agent
        // touched Font Lab lately but acts only when the human next messages it — the panel
        // hands over a wake-up prompt instead of promising motion that won't come).
        const pres = statusPayload();
        const wasParked = pres.agentParked;
        const wasRecent = pres.agentRecent;
        const saved = writeRequest(PROJECT, { brief, exclude });
        // Nobody around at all? The endpoint itself serves the ask from the deterministic
        // curator — slower-quality than an agent's composition, but the click never dead-ends.
        const selfServe = !wasParked && !wasRecent;
        const presence = wasParked
          ? " — an agent is listening (composing now)"
          : wasRecent
            ? " — agent nearby but not parked (panel offers the wake-up prompt; the ask also rides its next tool call)"
            : " — no agent detected (self-serving from the catalog)";
        console.log(`\n  ✎ "more options" requested${brief?.note ? `: "${String(brief.note).slice(0, 60)}"` : ""}${presence}`);
        res.writeHead(200, { "content-type": "application/json" });
        // agentWaiting mirrors agentParked (not merged presence) so an OLD stamped panel also
        // stops claiming "appears in a moment" when nothing is parked — it falls to its off-ramp.
        res.end(JSON.stringify({ ok: true, agentParked: wasParked, agentRecent: wasRecent, agentWaiting: wasParked, selfServe, request: saved }));
        broadcast("request", { at: saved.at, brief: saved.brief });
        broadcast("status", statusPayload());
        if (ONCE) {
          // Same contract as exit-on-pick: --once means "wake me on the first event", and a
          // "more options" ask IS an event — the agent relaunches serve --once after composing.
          exitWithEvent({ event: "request", requested: true, request: saved });
        } else if (selfServe) {
          void (async () => {
            try {
              const engine = await import("./engine.mjs");
              const r = await engine.selfServeMore(PROJECT, saved, { log: (m) => console.log("  " + m) });
              console.log(r.exhausted
                ? `  ⚠ self-serve exhausted: ${r.hint}`
                : `  ✦ self-served ${r.added} direction(s) from the catalog — an agent can still compose tailored ones`);
              broadcast("status", statusPayload());
            } catch (e) {
              console.error(`  self-serve failed: ${e.message}`);
              broadcast("error", { message: `self-serve failed: ${e.message}` });
            }
          })();
        }
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  // ---- "I'm done": the panel's done ✓ lands here -----------------------------------------
  // The human says the choosing session is over. Persisted like the "more options" ask so no
  // listening agent is required at click time: a parked agent (--once / font_lab_wait) gets the
  // event now; otherwise it rides every later tool result (pendingHumanDone) and the turn-start
  // hook until font_lab_finish clears it.
  if (req.method === "POST" && req.url === "/done") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { note } = JSON.parse(body || "{}");
        const pres = statusPayload();
        const saved = writeDoneRequest(PROJECT, { note });
        console.log(`\n  ✔ done — the human finished choosing${pres.agentParked ? " (an agent is listening)" : ""}`);
        console.log(`      → font_lab_finish strips the dev-panel scaffolding and returns the commit plan.`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, agentParked: pres.agentParked, agentRecent: pres.agentRecent, request: saved }));
        broadcast("status", statusPayload());
        if (ONCE) exitWithEvent({ event: "done", done: true, request: saved });
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/select") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const sel = JSON.parse(body);
        // Capture presence BEFORE the write: a blocked waiter resolves (and clears its flag)
        // the instant selection.json lands, so sampling afterwards would tell the human
        // "no agent" right as their agent takes delivery. Only PARKED presence earns the
        // "ships from here" ack — a merely-recent agent won't move until the human messages it,
        // and the panel's unarmed copy (durable pick + "say apply my font pick") is the truth.
        const pres = statusPayload();
        const wasWaiting = pres.agentParked;
        ensureFlDir(PROJECT);
        writeFileSync(SELECTION, JSON.stringify(sel, null, 2) + "\n");
        appendFileSync(
          PICKLOG,
          JSON.stringify({ at: sel.pickedAt, direction: sel.direction?.id, roles: sel.roles }) + "\n",
        );
        printPick(sel);
        // Ack tells the panel what happens next, so it can narrate honestly:
        // an agent is parked on this pick (--once), it'll auto-ship (--apply), or the
        // human should hand it to their agent.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, once: ONCE, autoApply: AUTO_APPLY, agentWaiting: wasWaiting, agentParked: wasWaiting, agentRecent: pres.agentRecent }));
        broadcast("picked", { direction: sel.direction ?? null, pickedAt: sel.pickedAt ?? null });
        broadcast("status", statusPayload());

        const finish = async () => {
          if (AUTO_APPLY) {
            try {
              const { applySelection } = await import("./codegen.mjs");
              const r = await applySelection(PROJECT);
              writeAppliedStamp(PROJECT, r);
              console.log(`  → applied to project: ${r.edited.join(", ")} (\`font-lab undo\` to revert)\n`);
              broadcast("applied", { edited: r.edited, runId: r.runId });
              broadcast("status", statusPayload());
            } catch (e) {
              console.error(`  apply failed: ${e.message}\n`);
              broadcast("error", { message: `apply failed: ${e.message}` });
            }
          }
          if (ONCE) {
            // `event` tags which of the two --once exits this is; `picked`/`selection` are kept
            // for consumers that predate exit-on-request.
            exitWithEvent({ event: "pick", picked: true, selection: sel });
          }
        };
        void finish();
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  // ---- copy edits: the panel's double-click-to-retype lands here -------------------------
  // POST /edit { frame:{url,line,column}, oldText, newText } — resolve the React 19
  // _debugStack call-site frame to original source via the dev server's own source map,
  // then apply a reversible ts-morph edit. POST /undo restores the last edit byte-exactly.
  // Refusals (dynamic text, duplicate phrases, unmappable frames) come back as 409 with a
  // reason — the panel shows them honestly instead of editing the wrong thing.
  if (req.method === "POST" && (req.url === "/edit" || req.url === "/undo")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      try {
        const { applyEdit, undoEdit, findPhrase } = await import("./copyedit.mjs");
        if (req.url === "/undo") {
          const u = undoEdit(PROJECT);
          console.log(`  ↩ copy edit undone (${u.runId})`);
          return send(200, { ok: true, ...u });
        }
        const { frame, oldText, newText } = JSON.parse(body || "{}");
        const seed = Date.now().toString(36);
        let loc = null;
        if (frame && frame.url) {
          try {
            loc = await resolveFrame(frame);
          } catch {
            loc = null; // source map unavailable — fall through to the string path
          }
        }
        // Two attempts, in priority order — each reversible on its own:
        //   1) the resolved call-site file (exact: the only thing that disambiguates duplicates)
        //   2) a project-wide UNIQUE-phrase match — rescues source-map drift, a mis-resolved
        //      file, or no frame at all. We only ever commit to an unambiguous target, so a
        //      duplicate phrase is refused (not silently mis-edited), matching soft-degrade.
        let r = null;
        if (loc) {
          try {
            r = applyEdit(PROJECT, { file: loc.file, line: loc.line, col: loc.col, oldText, newText, runIdSeed: seed });
          } catch (e) {
            r = { ok: false, error: `couldn't open ${loc.file}: ${e.message || e}` };
          }
        }
        if ((!r || !r.ok) && oldText) {
          const hits = findPhrase(PROJECT, oldText);
          if (hits.length === 1) {
            r = applyEdit(PROJECT, { file: hits[0].file, oldText, newText, runIdSeed: seed });
          } else if (!r) {
            // No resolvable frame AND not uniquely locatable by text — say why, actionably, so
            // the revert in the panel reads as an explained boundary, not a silent snap-back, and
            // hand back a ready-to-paste instruction for the user's coding agent (see agentHandoff).
            const why = hits.length === 0
              ? `couldn't find these words as a text literal in ${path.basename(PROJECT)}/ — they may come from data (a DB/CMS/props), or \`npx font-lab\` may be pointed at a different folder than your site`
              : `"${String(oldText).slice(0, 40)}…" appears ${hits.length}× — retype from the exact spot so the call-site pins which one`;
            console.log(`  ⚠ copy edit refused: ${why}`);
            return send(409, { ok: false, error: why, candidates: hits, agentPrompt: agentHandoff({ oldText, newText, hits }) });
          }
        }
        if (!r) return send(409, { ok: false, error: "need a resolvable frame or the original text" });
        if (!r.ok) {
          console.log(`  ⚠ copy edit refused: ${r.error}`);
          const extra = oldText ? { agentPrompt: agentHandoff({ oldText, newText, hits: findPhrase(PROJECT, oldText) }) } : {};
          return send(409, { ...r, ...extra });
        }
        console.log(`  ✎ ${r.file}:${r.line}  "${r.before}" → "${r.after}"`);
        return send(200, r);
      } catch (e) {
        return send(400, { ok: false, error: String(e.message || e) });
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

// When an edit genuinely can't be automated — the words come from data, or the same phrase lives
// in several files with no resolvable call site — we still owe the user a next step. Hand back a
// ready-to-paste instruction for their coding agent: Font Lab is agent-native, so "here's exactly
// what to change and where" turns a dead-end refusal into a one-paste fix.
function agentHandoff({ oldText, newText, hits }) {
  const project = path.basename(PROJECT);
  const where = hits && hits.length
    ? `It appears as static copy in: ${hits.map((h) => `${h.file}:${h.line}`).join(", ")}${hits.length > 1 ? " — change the one the user meant (ask them if it's unclear which page)" : ""}.`
    : `It isn't a static string literal in ${project}/, so it's likely rendered from data (props, a CMS, or a constants/i18n file). Find where that copy originates and change it at the source.`;
  return [
    `In the ${project} project, change the on-page copy:`,
    `  from: ${JSON.stringify(String(oldText))}`,
    `    to: ${JSON.stringify(String(newText))}`,
    where,
    `Match the file's existing quote/entity style (e.g. &apos; for apostrophes), and keep the change reversible.`,
  ].join("\n");
}

// Resolve a bundled call-site frame ({url,line,column} inside the dev bundle) to original
// source using the dev server's own source map. Cached per bundle URL; no bundler plugin.
const sourceMapCache = new Map();
async function resolveFrame({ url, line, column }) {
  if (!sourceMapCache.has(url)) {
    const { SourceMapConsumer } = await import("source-map");
    const resp = await fetch(url + ".map");
    sourceMapCache.set(url, resp.ok ? await new SourceMapConsumer(await resp.json()) : null);
  }
  const consumer = sourceMapCache.get(url);
  if (!consumer) throw new Error(`no source map for ${url}`);
  const orig = consumer.originalPositionFor({ line, column });
  if (!orig.source) throw new Error(`could not resolve ${url}:${line}:${column}`);
  // normalizeSourcePath lives in copyedit.mjs (pure + unit-tested) — a source map's `source` is
  // a bundler-emitted URL whose shape varies by stack, and Font Lab injects into repos we don't
  // control, so path normalization is the field-robustness seam worth testing on its own.
  const { normalizeSourcePath } = await import("./copyedit.mjs");
  return { file: normalizeSourcePath(orig.source), line: orig.line, col: orig.column };
}

  // ---- self-healing bind: EADDRINUSE is triaged, not thrown at the human --------------------
  // The post-upgrade trap from the dogfood: `npm install` doesn't restart a running endpoint, so
  // the next `npx font-lab` hits EADDRINUSE and the human (or agent) starts SIGKILL theater.
  // Instead: ask the squatter what it is. Same project + current → idempotent success (or, for
  // --once, park on the event FILES the healthy endpoint writes — the exit contract survives).
  // Same project + stale → POST /shutdown and take the port over. Anything else → a named error.
  let takeoverDeadline = 0;
  const tryListen = () => server.listen(PORT, HOST, () => {
    console.log(`Font Lab — pick endpoint`);
    console.log(`  endpoint  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (POST /select /edit /undo /request · GET /selection /request /status /events)`);
    console.log(`  project   ${PROJECT}`);
    if (HOST !== "127.0.0.1") console.log(`  binding   ${HOST} (non-loopback — anything on your network can post a pick)`);
    if (ONCE) console.log(`  mode      --once: exits on the first pick OR "more options" request (the exit is your wake-up signal; the last stdout line is the event JSON)`);
    if (AUTO_APPLY) console.log(`  mode      --apply: pick ships immediately (reversible via font-lab undo)`);
    console.log(`  Open your dev site, flip directions in the panel (← →), and hit Pick.`);
    console.log(`  Waiting for a pick…`);
  });
  server.on("error", async (err) => {
    if (err.code !== "EADDRINUSE") {
      console.error(`  ✗ serve: ${err.message}`);
      process.exit(1);
    }
    if (takeoverDeadline) {
      // mid-takeover: the old endpoint is exiting — keep retrying until the deadline
      if (Date.now() < takeoverDeadline) return void setTimeout(tryListen, 300);
      console.error(`  ✗ :${PORT} didn't free up after the old endpoint acknowledged shutdown — check it manually (lsof -ti:${PORT}).`);
      process.exit(1);
    }
    let st = null;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/status`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) st = await r.json();
    } catch {}
    if (!st || st.ok !== true || st.version === undefined) {
      console.error(`  ✗ :${PORT} is taken by something that isn't a Font Lab endpoint. Free the port or pass --port <n>.`);
      process.exit(1);
    }
    if (st.project && path.resolve(st.project) !== PROJECT) {
      console.error(`  ✗ :${PORT} already serves a DIFFERENT project (${st.project}).`);
      console.error(`    Stop that endpoint first, or run this one with --port <n> (the panel expects :7777, so prefer stopping the other).`);
      process.exit(1);
    }
    const squatterStale = isRealVersion(st.version) && isRealVersion(VERSION) && cmpVersions(VERSION, st.version) > 0;
    if (!squatterStale) {
      if (ONCE) {
        console.log(`  endpoint already running on :${PORT} (v${st.version}, same project) — parking on .font-lab events instead`);
        const engine = await import("./engine.mjs");
        for (;;) {
          const ev = await engine.waitForEvent(PROJECT, { timeoutMs: 3600_000, ignoreExistingPick: true });
          if (ev.event !== "timeout") {
            console.log(JSON.stringify(ev));
            process.exit(0);
          }
        }
      }
      console.log(`  ✓ endpoint already running on :${PORT} (v${st.version}, same project) — nothing to do.`);
      process.exit(0);
    }
    console.log(`  ↻ :${PORT} runs a stale endpoint (v${st.version} < v${VERSION}, same project) — taking over…`);
    let acked = false;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1500) });
      acked = r.ok;
    } catch {}
    if (!acked) {
      console.error(`  ✗ the old endpoint predates graceful shutdown (pre-0.14) — kill it manually (lsof -ti:${PORT} | xargs kill), then rerun.`);
      process.exit(1);
    }
    takeoverDeadline = Date.now() + 6000;
    setTimeout(tryListen, 300);
  });
  tryListen();
}
