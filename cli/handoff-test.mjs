// Handoff loop — verify the pick actually reaches the agent, offline:
//   serve --once exits on pick (the background-task wake-up), SSE /events narrates the loop
//   to the panel, /status assembles the snapshot, engine.waitForPick blocks + flags presence,
//   and the applied stamp flips readHandoffState to "shipped".

import { spawn } from "node:child_process";
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import * as engine from "./engine.mjs";
import { writeAppliedStamp, readHandoffState, selectionPath } from "./state.mjs";

const SERVE = fileURLToPath(new URL("./font-lab.mjs", import.meta.url));
const TMP = fileURLToPath(new URL("./out/handoff-fixture/", import.meta.url));

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

const SELECTION = {
  version: 1,
  pickedAt: new Date().toISOString(),
  direction: { id: "technical-poise", name: "Technical Poise", vibe: "technical" },
  roles: {
    display: { family: "Cabinet Grotesk", source: "foundry", parity: "best-effort", weights: [400, 700] },
    body: { family: "Gantari", source: "google", parity: "guaranteed", weights: [400, 600] },
    mono: { family: "Spline Sans Mono", source: "google", parity: "guaranteed", weights: [400] },
  },
};

const post = (port, body) =>
  fetch(`http://127.0.0.1:${port}/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json() }),
  );
const get = (port, p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json());

// Collect SSE frames from /events until the socket closes (or 4s cap).
const collectSse = (port) =>
  new Promise((resolve) => {
    const frames = [];
    const req = http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => {
      res.on("data", (c) => frames.push(String(c)));
      res.on("end", () => resolve(frames.join("")));
      res.on("error", () => resolve(frames.join("")));
    });
    req.on("error", () => resolve(frames.join("")));
    setTimeout(() => {
      req.destroy();
      resolve(frames.join(""));
    }, 4000);
  });

const startServe = (port, ...flags) => {
  const child = spawn(process.execPath, [SERVE, "serve", "--project", TMP, "--port", String(port), ...flags], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => (out += String(c)));
  return { child, out: () => out };
};
const waitExit = (child, ms) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });

try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  // ---- Phase 1: serve --once = exit-on-pick ------------------------------------
  {
    const { child, out } = startServe(7794, "--once");
    await sleep(500);
    assert("health responds", (await get(7794, "/health")).ok === true);
    const st = await get(7794, "/status");
    assert("--once counts as agent waiting", st.agentWaiting === true && st.once === true);

    const ssePromise = collectSse(7794);
    await sleep(150);
    const ack = await post(7794, SELECTION);
    assert("pick ack carries handoff facts", ack.status === 200 && ack.body.ok === true && ack.body.once === true && ack.body.agentWaiting === true);

    const code = await waitExit(child, 2500);
    assert("--once exits on pick", code === 0, `exit code ${code}`);
    const lastLine = out().trim().split("\n").pop();
    let parsed = null;
    try {
      parsed = JSON.parse(lastLine);
    } catch {}
    assert("final stdout line is the selection JSON", parsed?.picked === true && parsed?.selection?.direction?.id === "technical-poise");
    assert("selection.json written", existsSync(selectionPath(TMP)));

    const sse = await ssePromise;
    assert("SSE announced the pick", /event: picked/.test(sse) && /technical-poise/.test(sse));
    assert("SSE status precedes pick (initial snapshot)", sse.indexOf("event: status") !== -1 && sse.indexOf("event: status") < sse.indexOf("event: picked"));
  }

  // ---- Phase 2: plain serve stays up; status reflects no agent ------------------
  {
    rmSync(TMP + ".font-lab", { recursive: true, force: true });
    const { child } = startServe(7795);
    await sleep(500);
    const st = await get(7795, "/status");
    assert("plain serve: no agent waiting", st.agentWaiting === false && st.once === false);
    await post(7795, SELECTION);
    await sleep(300);
    assert("plain serve stays up after pick", child.exitCode === null);
    const st2 = await get(7795, "/status");
    assert("status shows the pick", st2.selection?.direction?.id === "technical-poise");

    // engine.status sees the endpoint + merges its state
    const es = await engine.status(TMP, { port: 7795 });
    assert("engine.status: endpoint up", es.endpoint.up === true && es.endpoint.port === 7795);
    child.kill();
  }

  // ---- Phase 3: waitForPick blocks, flags presence, resolves --------------------
  {
    rmSync(TMP + ".font-lab", { recursive: true, force: true });
    mkdirSync(TMP + ".font-lab", { recursive: true });
    const p = engine.waitForPick(TMP, { timeoutMs: 5000 });
    await sleep(300);
    assert("agent-waiting flag set while blocked", existsSync(TMP + ".font-lab/agent-waiting.json"));
    writeFileSync(selectionPath(TMP), JSON.stringify(SELECTION));
    const r = await p;
    assert("waitForPick resolves on pick", r.picked === true && r.selection.direction.id === "technical-poise");
    assert("agent-waiting flag cleared", !existsSync(TMP + ".font-lab/agent-waiting.json"));

    const immediate = await engine.waitForPick(TMP, { timeoutMs: 1000 });
    assert("existing pick returns immediately", immediate.picked === true && immediate.waitedMs === 0);

    const t = await engine.waitForPick(TMP, { timeoutMs: 600, ignoreExisting: true });
    assert("ignoreExisting waits for a NEW pick (times out)", t.picked === false && t.timedOut === true && !!t.hint);
  }

  // ---- Phase 4: applied stamp flips state to shipped -----------------------------
  {
    const before = readHandoffState(TMP);
    assert("pre-apply: not shipped", before.applied === null);
    writeAppliedStamp(TMP, { runId: "r1", mode: "next-font", direction: SELECTION.direction, edited: ["app/layout.tsx"] });
    const after = readHandoffState(TMP);
    assert("post-apply: shipped + current", after.applied?.current === true && after.applied.runId === "r1");
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
