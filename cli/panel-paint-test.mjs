#!/usr/bin/env node
// v2.0 integration test — the census+paint panel and the ship receipt, driven end-to-end on a
// REAL project (default: the jack-mcgovern-site dogfood — the site whose dead display chain and
// /fontlab island defeated the variable-override model). Needs network (font fetch) + a browser,
// so it's a manual/integration gate, not part of the offline suites.
//
//   node cli/panel-paint-test.mjs [--project /path/to/site] [--port 4179]
//
// What must hold (the v2.0 slice of the RFC's exit criteria):
//   1. init mounts the panel + fl-census; the panel censuses at boot (clusters exist, labels sane)
//   2. one ArrowRight flip paints 100% of heading AND body AND label text on / and /fontlab
//      (glyph widths move — not just computed strings), island included
//   3. before-toggle (B) clears paint; flip returns it
//   4. copy edit still works on a painted heading: dblclick opens the run editor, Escape restores,
//      DOM structure byte-identical through paint
//   5. Pick posts a selection that DECLARES ship scope: census + per-role clusters/islands/seams
//   6. verifyShip tells the truth both ways: unshipped targets -> converged:false + work order
//      naming the residue with provenance; already-rendering targets -> converged:true
//   7. the target repo is left byte-identical (uninit + cleanup)

import { spawn, execSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PROJECT = path.resolve(arg("--project", "/home/user/jack-mcgovern-site"));
const PORT = +arg("--port", "4179");
const BASE = `http://localhost:${PORT}`; // NOT 127.0.0.1 — Next 15 treats it as cross-origin for HMR
const PICK_PORT = 7777;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const assert = (name, ok, extra = "") => {
  if (ok) { passed++; console.log(`PASS  ${name} ${extra}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
};

const engine = await import(pathToFileURL(path.join(HERE, "engine.mjs")).href);

// ---- guard: target repo must start clean (we restore it byte-identical at the end) ----------
const gitStatus = () => execSync("git status --porcelain", { cwd: PROJECT, encoding: "utf8" }).trim();
if (gitStatus()) {
  console.error(`target repo ${PROJECT} is not clean — refusing to run (this test mutates and restores it)`);
  process.exit(1);
}

let server = null, pickServer = null, browser = null;
async function startDevServer() {
  server = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], { cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    try { const r = await fetch(BASE + "/", { redirect: "manual" }); if (r.status < 500) return; } catch {}
    await sleep(1500);
  }
  throw new Error("dev server never became ready:\n" + out.slice(-2000));
}
function cleanup() {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  if (pickServer?.pid) { try { process.kill(-pickServer.pid, "SIGTERM"); } catch {} }
}
process.on("exit", cleanup);

async function freshPage(route) {
  // bypassCSP: this site ships a strict CSP in dev (connect-src 'self') that would block the
  // panel's :7777 fetches and the HMR socket in ANY browser — a recorded product hazard
  // (spike/cluster-paint/RESULTS.md finding 1), bypassed here to test the machinery itself.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  await page.goto(BASE + route, { waitUntil: "load", timeout: 90_000 });
  await page.waitForSelector("#fontlab-panel-host", { timeout: 30_000 });
  await sleep(1200); // RSC streaming / census boot settle
  return page;
}

// Painted voices -> the family each is painted with (from the parity stack "FL <family>, …").
const paintedFamilies = (page) =>
  page.evaluate(() => {
    const fc = window.__flCensus;
    const out = {};
    for (const [voice, stack] of Object.entries(fc.paintedVoices())) out[voice] = fc.pretty(String(stack).split(",")[0].trim().replace(/^["']|["']$/g, ""));
    return out;
  });
const coverageOf = (page, voice, family) => page.evaluate(([v, f]) => window.__flCensus.voiceCoverage(v, f), [voice, family]);

try {
  console.log("▶ init (starter menu ok — this is a machinery test)");
  const init = await engine.init(PROJECT, { allowFallback: true, log: () => {} });
  assert("init: panel + census module written",
    existsSync(path.join(PROJECT, "app/_fontlab/FontLabDevPanel.tsx")) && existsSync(path.join(PROJECT, "app/_fontlab/fl-census.ts")));

  console.log(`▶ dev server on :${PORT}`);
  await startDevServer();

  const pw = await import(pathToFileURL(path.join(PROJECT, "node_modules", "playwright", "index.mjs")).href);
  try { browser = await pw.chromium.launch({ headless: true }); }
  catch { browser = await pw.chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" }); }

  // ---- 1+2: census at boot, one-flip paint coverage on both routes -------------------------
  for (const route of ["/", "/fontlab"]) {
    const page = await freshPage(route);
    const report = await page.evaluate(() => window.__flCensus.report());
    assert(`census[${route}]: clusters exist at boot`, report.length >= 2 && report.length <= 6, `(${report.length}: ${report.map((c) => c.label).join(" · ")})`);

    const widthsBefore = await page.evaluate(() => window.__flCensus.voiceWidths("heading"));
    await page.keyboard.press("ArrowRight"); // direction 01
    await page.evaluate(async () => { await document.fonts.ready; });
    await sleep(600);

    const fams = await paintedFamilies(page);
    assert(`flip[${route}]: all three voices painted`, !!(fams.heading && fams.body && fams.label), JSON.stringify(fams));
    for (const voice of ["heading", "body", "label"]) {
      if (!fams[voice]) continue;
      const cov = await coverageOf(page, voice, fams[voice]);
      assert(`flip[${route}]: ${voice} coverage 100%`, cov.pct >= 99.9, `(${cov.pct}% of ${cov.totalChars} chars → ${fams[voice]})`);
    }
    const widthsAfter = await page.evaluate(() => window.__flCensus.voiceWidths("heading"));
    assert(`flip[${route}]: heading glyph widths moved`, Math.abs(widthsAfter - widthsBefore) > 1, `(${widthsBefore} → ${widthsAfter})`);

    // ---- 3: before-toggle clears paint; returning restores it ------------------------------
    await page.keyboard.press("b");
    await sleep(200);
    const cleared = await page.evaluate(() => Object.keys(window.__flCensus.paintedVoices()).length);
    assert(`before[${route}]: paint cleared`, cleared === 0);
    await page.keyboard.press("b");
    await sleep(200);
    const covBack = await coverageOf(page, "heading", fams.heading);
    assert(`before[${route}]: flip restored after B`, covBack.pct >= 99.9, `(${covBack.pct}%)`);
    await page.close();
  }

  // ---- 4: copy edit intact on a painted heading --------------------------------------------
  {
    const page = await freshPage("/");
    await page.keyboard.press("ArrowRight");
    await sleep(400);
    const probe = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-flv="heading"]')].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 8 && r.height > 8 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3);
      });
      if (!el) return null;
      el.setAttribute("data-fl-test-probe", "1");
      const r = el.getBoundingClientRect();
      const structure = [...el.childNodes].map((n) => (n.nodeType === 3 ? "#text:" + n.textContent : n.nodeName)).join("|");
      return { x: r.left + Math.min(30, r.width / 2), y: r.top + r.height / 2, structure };
    });
    assert("edit: found a painted heading to probe", !!probe);
    if (probe) {
      await page.mouse.dblclick(probe.x, probe.y);
      await sleep(300);
      const editing = await page.evaluate(() => {
        const el = document.querySelector("[data-fl-test-probe]");
        return !!(el && (el.getAttribute("contenteditable") || el.querySelector("[contenteditable]") || el.closest("[contenteditable]")));
      });
      assert("edit: dblclick opens the run editor on painted text", editing);
      await page.keyboard.press("Escape");
      await sleep(300);
      const after = await page.evaluate(() => {
        const el = document.querySelector("[data-fl-test-probe]");
        if (!el) return null;
        const structure = [...el.childNodes].map((n) => (n.nodeType === 3 ? "#text:" + n.textContent : n.nodeName)).join("|");
        el.removeAttribute("data-fl-test-probe");
        return { structure, editable: !!el.getAttribute("contenteditable") };
      });
      assert("edit: escape restores; structure byte-identical through paint+edit", !!after && after.structure === probe.structure && !after.editable);
    }
    await page.close();
  }

  // ---- 5: pick declares ship scope (census + clusters + islands + seams) -------------------
  {
    rmSync(path.join(PROJECT, ".font-lab", "selection.json"), { force: true });
    pickServer = spawn("node", [path.join(HERE, "font-lab.mjs"), "serve", "--project", PROJECT], { stdio: ["ignore", "pipe", "pipe"], detached: true });
    await sleep(1200);
    const page = await freshPage("/fontlab"); // pick on the island route — scope must name it
    await page.keyboard.press("ArrowRight");
    await sleep(400);
    await page.keyboard.press("Enter"); // PICK
    const selPath = path.join(PROJECT, ".font-lab", "selection.json");
    const t0 = Date.now();
    while (!existsSync(selPath) && Date.now() - t0 < 15_000) await sleep(300);
    assert("pick: selection.json written", existsSync(selPath));
    if (existsSync(selPath)) {
      const sel = JSON.parse(readFileSync(selPath, "utf8"));
      assert("pick: carries cluster-paint preview block", sel.preview?.mechanism === "cluster-paint" && Array.isArray(sel.preview?.census) && sel.preview.census.length > 0,
        `(census: ${sel.preview?.census?.length ?? 0} clusters on ${sel.preview?.route})`);
      const scope = sel.preview?.scope || [];
      assert("pick: scope declared for all three roles", scope.length === 3 && scope.every((s) => "autoShipSeam" in s && Array.isArray(s.clusters)));
      const display = scope.find((s) => s.role === "display");
      assert("pick: island route pick names inline/route provenance", !!display && display.islands.length > 0,
        `(display islands: ${display?.islands?.map((c) => c.label).join(" · ") || "none"})`);
    }
    await page.close();
  }

  // ---- 6: the receipt tells the truth both ways --------------------------------------------
  {
    process.env.FONT_LAB_CHROMIUM = process.env.FONT_LAB_CHROMIUM || "/opt/pw-browsers/chromium";
    // (a) the pick was never applied → must NOT converge, and the residue must name the gap
    const neg = await engine.verifyShip(PROJECT, { baseUrl: BASE, routes: ["/", "/fontlab"] });
    assert("receipt: unapplied pick → converged:false", neg.converged === false);
    assert("receipt: residue names clusters with provenance", neg.receipt.residue.length > 0 && neg.receipt.residue.every((r) => r.prov && r.label && r.sample !== undefined),
      `(${neg.receipt.residue.length} residue clusters)`);
    assert("receipt: work order ready for the agent", typeof neg.workOrder === "string" && neg.workOrder.includes("font_lab_verify"),
      "");
    assert("receipt: receipt.json written", existsSync(path.join(PROJECT, ".font-lab", "receipt.json")));

    // (b) what the site ALREADY renders → must converge (no false alarms)
    const bodyNow = neg.receipt.routes.find((r) => r.route === "/").clusters.find((c) => c.voice === "body");
    const pos = await engine.verifyShip(PROJECT, { baseUrl: BASE, routes: ["/"], targets: { body: bodyNow.family } });
    assert("receipt: already-rendering target → converged:true", pos.converged === true, `(body = ${bodyNow.family})`);
  }
} finally {
  // ---- 7: leave the target repo byte-identical ----------------------------------------------
  console.log("▶ restore target repo");
  try { if (browser) await browser.close(); } catch {}
  cleanup();
  try { engine.uninit(PROJECT); } catch (e) { console.log("  uninit: " + e.message); }
  rmSync(path.join(PROJECT, ".font-lab"), { recursive: true, force: true });
  try {
    execSync("git checkout -- . && git clean -fdq app public 2>/dev/null || git clean -fdq", { cwd: PROJECT });
  } catch {}
  assert("restore: target repo byte-identical (git)", gitStatus() === "", gitStatus() ? `\n${gitStatus()}` : "");
}

console.log(`\npanel-paint: ${passed}/${passed + failed} assertions passed`);
process.exit(failed ? 1 : 0);
