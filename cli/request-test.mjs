// Layer 3 — the in-panel "more options" demand channel, offline:
//   POST /request persists the ask + reports agent presence, /status + /request expose it,
//   engine.waitForRequest blocks + flags presence + resolves, and fulfilling it via expandPreview
//   clears the request. This is the loop that lets a human on the starter menu pull fresh,
//   tailored directions without leaving the panel.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import * as engine from "./engine.mjs";
import { writeRequest, readRequest, clearRequest, readHandoffState, requestPath, writeDoneRequest, readDoneRequest, clearDoneRequest } from "./state.mjs";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SERVE = HERE + "font-lab.mjs";
const CLEAN = path.join(ROOT, "examples/clean-next-site");
const TMP = HERE + ".req-tmp/";

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

const get = (port, p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json());
const post = (port, p, body) =>
  fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json() }),
  );

try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  // ---- Part 1: pure state round-trip ------------------------------------------
  {
    const brief = { feeling: "editorial & literary", departure: "a clear shift", brand: "like a magazine", note: "more serifs" };
    writeRequest(TMP, { brief, exclude: ["Inter", "Geist"] });
    const r = readRequest(TMP);
    assert("writeRequest persists a pending ask", r?.status === "pending" && r.brief.note === "more serifs" && r.exclude.includes("Geist"));
    assert("readHandoffState surfaces the pending request", readHandoffState(TMP).request?.brief?.feeling === "editorial & literary");
    clearRequest(TMP);
    assert("clearRequest removes it", !existsSync(requestPath(TMP)) && readHandoffState(TMP).request === null);

    // A multi-select vibe from the panel arrives as an array of feelings — persisted verbatim so the
    // agent receives every vibe the human combined (e.g. technical AND minimal), not just one.
    writeRequest(TMP, { brief: { feeling: ["technical & precise", "quiet & minimal"], departure: "a clear shift" }, exclude: [] });
    const multi = readHandoffState(TMP).request?.brief?.feeling;
    assert("multi-select feeling round-trips as an array", Array.isArray(multi) && multi.length === 2 && multi[0] === "technical & precise",
      JSON.stringify(multi));
    clearRequest(TMP);
  }

  // ---- Part 2: engine.waitForRequest blocks, flags presence, resolves ---------
  {
    rmSync(path.join(TMP, ".font-lab"), { recursive: true, force: true });
    mkdirSync(path.join(TMP, ".font-lab"), { recursive: true });
    const p = engine.waitForRequest(TMP, { timeoutMs: 5000 });
    await sleep(300);
    assert("agent-waiting flag set while listening for a request", existsSync(path.join(TMP, ".font-lab/agent-waiting.json")));
    writeRequest(TMP, { brief: { note: "warmer" }, exclude: [] });
    const r = await p;
    assert("waitForRequest resolves on the ask", r.requested === true && r.request.brief.note === "warmer");
    assert("agent-waiting flag cleared after", !existsSync(path.join(TMP, ".font-lab/agent-waiting.json")));

    // an already-pending request resolves immediately
    const immediate = await engine.waitForRequest(TMP, { timeoutMs: 500 });
    assert("a pending request resolves immediately", immediate.requested === true && immediate.waitedMs === 0);
    clearRequest(TMP);
    const timedOut = await engine.waitForRequest(TMP, { timeoutMs: 400 });
    assert("no request → times out with a hint", timedOut.requested === false && timedOut.timedOut === true && !!timedOut.hint);
  }

  // ---- Part 3: fulfilling via expandPreview clears the request ----------------
  {
    const proj = path.join(TMP, "proj");
    mkdirSync(path.join(proj, "app/_fontlab"), { recursive: true });
    for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) cpSync(path.join(CLEAN, f), path.join(proj, f));
    // seed a preview set (composed) so expandPreview has something to merge into
    const base = await engine.composeDirections([{ name: "Base", display: "Fraunces", body: "Hanken Grotesk", mono: "Spline Sans Mono", vibe: "editorial", rationale: "r" }]);
    await engine.preparePreview(proj, { directions: base.directions, fetch: false });
    writeRequest(proj, { brief: { note: "bolder" }, exclude: ["Fraunces"] });
    const r = await engine.expandPreview(proj, { directions: [{ id: "add-1", name: "Add", vibe: "bold", rationale: "r", roles: { display: { family: "Syne", weights: [400] }, body: { family: "Albert Sans", weights: [400] }, mono: { family: "Spline Sans Mono", weights: [400] } } }], fetch: false });
    assert("expandPreview reports it fulfilled the request", r.fulfilledRequest === true);
    assert("expandPreview cleared the pending request", readRequest(proj) === null);
    assert("expandPreview flips the menu to composed", JSON.parse(readFileSync(path.join(proj, ".font-lab/menu.json"), "utf8")).mode === "composed");
  }

  // ---- Part 4: endpoint round-trip (POST /request + /status + /request) -------
  {
    const child = spawn(process.execPath, [SERVE, "serve", "--project", TMP, "--port", "7796"], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await sleep(500);
      assert("endpoint health up", (await get(7796, "/health")).ok === true);
      // presence grades: a fresh MCP heartbeat means "agent nearby, NOT parked" — the panel gets
      // the wake-prompt path (no self-serve, no "composing now" promise). Asserting request
      // visibility HERE is deliberate: with self-serve suppressed, nothing consumes the ask.
      writeFileSync(path.join(TMP, ".font-lab/mcp-heartbeat.json"), JSON.stringify({ at: Date.now(), pid: process.pid }) + "\n");
      const ack = await post(7796, "/request", { brief: { feeling: "bold & expressive" }, exclude: ["Inter"] });
      assert(
        "fresh heartbeat → wake-prompt path (recent, not parked, no self-serve)",
        ack.status === 200 && ack.body.ok === true && ack.body.agentParked === false && ack.body.agentRecent === true && ack.body.selfServe === false && ack.body.agentWaiting === false,
        JSON.stringify(ack.body),
      );
      const st = await get(7796, "/status");
      assert("/status surfaces the pending request", st.request?.brief?.feeling === "bold & expressive");
      assert("/status carries both presence grades", st.agentParked === false && st.agentRecent === true);
      const rq = await get(7796, "/request");
      assert("GET /request returns the saved ask", rq.status === "pending" && rq.exclude.includes("Inter"));

      // a parked marker whose process is DEAD must not count as a listening agent — an agent
      // host killed mid-wait leaves the file behind, and it must not show "AGENT LISTENING"
      const dead = spawn(process.execPath, ["-e", ""]);
      await new Promise((resolve) => dead.on("exit", resolve));
      writeFileSync(path.join(TMP, ".font-lab/agent-waiting.json"), JSON.stringify({ since: new Date().toISOString(), pid: dead.pid }) + "\n");
      const st2 = await get(7796, "/status");
      assert("dead-pid waiting marker is not parked presence", st2.agentParked === false, JSON.stringify({ agentParked: st2.agentParked }));
      rmSync(path.join(TMP, ".font-lab/agent-waiting.json"), { force: true });
      rmSync(path.join(TMP, ".font-lab/mcp-heartbeat.json"), { force: true });

      // no agent anywhere → the ack engages self-serve so the click never dead-ends (the async
      // fulfillment may consume the request afterwards — by design — so only the ack is asserted)
      const ack2 = await post(7796, "/request", { brief: { note: "again" }, exclude: [] });
      assert(
        "POST /request acks with presence (no agent → self-serve engaged)",
        ack2.status === 200 && ack2.body.ok === true && ack2.body.agentWaiting === false && ack2.body.agentParked === false && ack2.body.agentRecent === false && ack2.body.selfServe === true,
        JSON.stringify(ack2.body),
      );
    } finally {
      child.kill();
    }
  }

  // ---- Part 5: the done ✓ channel — same durable delivery as picks and requests ----------
  {
    // POST /done persists + acks presence; /status carries it until finish clears it.
    const child = spawn(process.execPath, [SERVE, "serve", "--project", TMP, "--port", "7797"], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await sleep(500);
      const ack = await post(7797, "/done", {});
      assert("POST /done acks with presence", ack.status === 200 && ack.body.ok === true && ack.body.agentParked === false, JSON.stringify(ack.body));
      assert("the done signal persists on disk", readDoneRequest(TMP)?.status === "pending");
      const st = await get(7797, "/status");
      assert("/status carries the pending done", st.done?.status === "pending");
    } finally {
      child.kill();
    }
    clearDoneRequest(TMP);

    // font_lab_wait resolves on it — the unified event loop covers the session's off-switch too.
    clearRequest(TMP); // part 4's self-serve ask may still be pending (its fulfillment is async by design)
    const p = engine.waitForEvent(TMP, { timeoutMs: 5000 });
    await sleep(300);
    writeDoneRequest(TMP);
    const ev = await p;
    assert("waitForEvent resolves with { event: 'done' }", ev.event === "done" && ev.done === true, JSON.stringify(ev));
    clearDoneRequest(TMP);

    // --once exits on done ✓ with the event JSON as its final stdout line — the background-task
    // wake-up contract, extended to the session's end.
    const once = spawn(process.execPath, [SERVE, "serve", "--once", "--project", TMP, "--port", "7798"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    once.stdout.on("data", (c) => (out += c));
    await sleep(500);
    await post(7798, "/done", {});
    const code = await new Promise((resolve) => once.on("exit", resolve));
    const last = out.trim().split("\n").pop();
    let evt = null;
    try { evt = JSON.parse(last); } catch {}
    assert("--once exits on done ✓ with the event JSON last", code === 0 && evt?.event === "done" && evt?.done === true, last);
    clearDoneRequest(TMP);
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\nrequest: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("request PASS");
