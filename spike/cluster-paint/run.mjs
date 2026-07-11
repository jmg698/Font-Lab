#!/usr/bin/env node
// Cluster + paint spike driver. Boots the target project's dev server, injects census.js,
// and runs the five exit criteria from PLAN.md against / and /fontlab. Writes out/report.json.
//
//   node spike/cluster-paint/run.mjs --project /path/to/jack-mcgovern-site [--port 4173] [--skip-ship]
//
// Reuses production machinery: playwright from the TARGET project's node_modules, the
// source-map frame resolution from cli/font-lab.mjs, and cli/copyedit.mjs applyEdit/undoEdit.

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "..", "cli");
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const PROJECT = path.resolve(arg("--project", "/home/user/jack-mcgovern-site"));
const PORT = +arg("--port", "4173");
const BASE = `http://localhost:${PORT}`; // NOT 127.0.0.1 — Next 15 dev treats it as cross-origin and drops the HMR websocket
const ROUTES = ["/", "/fontlab"];
const PAINT_FAMILY = "Georgia"; // system-installed: proves the mechanism with zero network
const SHIP = { display: "Fraunces", body: "Public Sans", mono: "JetBrains Mono" }; // verified Google families
const report = { startedAt: null, project: PROJECT, criteria: {}, routes: {}, notes: [] };
const log = (s) => console.log(`  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- dev server ------------------------------------------------------------
let server = null;
async function startDevServer() {
  console.log(`▶ dev server: ${PROJECT} on :${PORT}`);
  server = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], { cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    try {
      const r = await fetch(BASE + "/", { redirect: "manual" });
      if (r.status < 500) return;
    } catch {}
    await sleep(1500);
  }
  throw new Error("dev server never became ready:\n" + out.slice(-2000));
}
function stopDevServer() {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
}

// ---- browser ----------------------------------------------------------------
async function launch() {
  const pw = await import(pathToFileURL(path.join(PROJECT, "node_modules", "playwright", "index.mjs")).href);
  try { return await pw.chromium.launch({ headless: true }); }
  catch { return await pw.chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" }); }
}
async function freshPage(browser, route) {
  // bypassCSP: this site's next.config.mjs sends a strict CSP in dev too (connect-src 'self' +
  // upgrade-insecure-requests), which silently kills the HMR websocket and would block external
  // preview fonts — a real-world hazard recorded in RESULTS.md; the product must detect/handle it
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  await page.goto(BASE + route, { waitUntil: "load", timeout: 90_000 });
  await sleep(1500); // let RSC streaming / animations settle
  await page.addScriptTag({ path: path.join(HERE, "census.js") });
  await page.evaluate(() => window.__flSpike.census());
  return page;
}
// If a dev full-reload wiped the injected script, re-inject + re-census + re-flip and record it.
async function ensureSpike(page, flipFam) {
  const alive = await page.evaluate(() => !!window.__flSpike).catch(() => false);
  if (alive) return false;
  await page.addScriptTag({ path: path.join(HERE, "census.js") });
  await page.evaluate(() => window.__flSpike.census());
  if (flipFam) await page.evaluate((fam) => window.__flSpike.flipVoice("heading", fam), flipFam);
  report.notes.push("full reload occurred; spike re-injected (a mounted panel would survive this as a component)");
  return true;
}

// ---- source-map frame resolution (mirrors cli/font-lab.mjs resolveFrame) ----
async function resolveFrame({ url, line, column }) {
  const { normalizeSourcePath } = await import(pathToFileURL(path.join(CLI, "copyedit.mjs")).href);
  // server-component stacks carry the original path already (webpack-internal:///./app/page.tsx);
  // only client chunk URLs need the dev server's source map
  if (!/^https?:\/\//.test(url)) return { file: normalizeSourcePath(url), line, col: column };
  const { SourceMapConsumer } = await import(pathToFileURL(path.join(CLI, "node_modules", "source-map", "source-map.js")).href);
  const resp = await fetch(url + ".map");
  if (!resp.ok) throw new Error(`no source map for ${url}`);
  const consumer = await new SourceMapConsumer(await resp.json());
  const orig = consumer.originalPositionFor({ line, column });
  if (!orig.source) throw new Error(`could not resolve ${url}:${line}:${column}`);
  return { file: normalizeSourcePath(orig.source), line: orig.line, col: orig.column };
}

// ---- criteria ----------------------------------------------------------------
async function criterion1and3(browser) {
  for (const route of ROUTES) {
    const page = await freshPage(browser, route);
    const clusters = await page.evaluate(() => window.__flSpike.report());
    const before = await page.evaluate(() => window.__flSpike.voiceWidths("heading"));
    await page.evaluate((fam) => window.__flSpike.flipVoice("heading", fam), PAINT_FAMILY);
    await sleep(400);
    const cov = await page.evaluate((fam) => window.__flSpike.voiceCoverage("heading", fam), PAINT_FAMILY);
    const after = await page.evaluate(() => window.__flSpike.voiceWidths("heading"));
    report.routes[route] = { clusters, headingFlip: cov, widthsBefore: before, widthsAfter: after, metricsMoved: before !== after };
    log(`${route}: ${clusters.length} clusters; heading flip → ${cov.pct}% (${cov.hitChars}/${cov.totalChars} chars); widths ${before} → ${after}`);
    for (const c of clusters) log(`    ${c.id} ${c.label}  ${c.share}% · ${c.elements} els · "${c.sample}"`);
    await page.close();
  }
  const capOk = report.routes["/"].clusters.length <= 4 && report.routes["/fontlab"].clusters.length <= 5;
  report.criteria.c1_preview = { pass: ROUTES.every((r) => report.routes[r].headingFlip.pct >= 90 && report.routes[r].metricsMoved) };
  report.criteria.c3_clusterSanity = { pass: capOk, counts: Object.fromEntries(ROUTES.map((r) => [r, report.routes[r].clusters.length])) };
}

async function criterion2(browser) {
  const page = await freshPage(browser, "/");
  await page.evaluate((fam) => window.__flSpike.flipVoice("heading", fam), PAINT_FAMILY);
  const pct = async () => {
    await ensureSpike(page, PAINT_FAMILY);
    return (await page.evaluate((fam) => window.__flSpike.voiceCoverage("heading", fam), PAINT_FAMILY)).pct;
  };
  const scrollThen = await (async () => { await page.mouse.wheel(0, 20000); await sleep(800); return pct(); })();
  // real HMR: touch app/page.tsx, wait for fast refresh, expect the restamp loop to recover paint
  const pageFile = path.join(PROJECT, "app", "page.tsx");
  const orig = readFileSync(pageFile, "utf8");
  writeFileSync(pageFile, orig + "\n// __fl_spike_hmr__\n");
  let hmrPct = 0;
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000) { await sleep(1000); hmrPct = await pct(); if (hmrPct >= 90) break; }
  } finally { writeFileSync(pageFile, orig); }
  let afterRevert = 0;
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) { await sleep(1000); afterRevert = await pct(); if (afterRevert >= 90) break; }
  }
  const cycled = await (async () => {
    await page.evaluate(() => window.__flSpike.clearPaint());
    await page.evaluate((fam) => window.__flSpike.flipVoice("heading", fam), PAINT_FAMILY);
    await sleep(200);
    return pct();
  })();
  const restamps = await page.evaluate(() => window.__flSpike.restampCount());
  report.criteria.c2_stability = { pass: scrollThen >= 90 && hmrPct >= 90 && afterRevert >= 90 && cycled >= 90, scrollThen, hmrPct, afterRevert, cycled, restamps };
  log(`stability: scroll ${scrollThen}% · post-HMR ${hmrPct}% · post-revert ${afterRevert}% · re-flip ${cycled}% · restamps ${restamps}`);
  await page.close();
}

async function criterion4(browser) {
  const results = [];
  for (const route of ROUTES) {
    const page = await freshPage(browser, route);
    const { applyEdit, undoEdit, findPhrase } = await import(pathToFileURL(path.join(CLI, "copyedit.mjs")).href);
    // candidates first (pre-paint structures embedded), then paint, then resolve like
    // production does: debug-stack frame when present, unique-phrase search when not
    const cands = await page.evaluate(() => window.__flSpike.editProbes("heading"));
    await page.evaluate((fam) => window.__flSpike.flipVoice("heading", fam), PAINT_FAMILY);
    await sleep(300);
    // resolve AND land the edit per candidate: an honest ambiguity refusal from the
    // write-back (production behavior) means "pick a better run", so we try the next one
    const marker = "EDITSPIKE"; // survives tidyRetype whitespace collapse, unambiguous in the DOM
    let chosen = null, resolved = null, applied = null;
    for (const cand of cands) {
      let res = null;
      if (cand.site) {
        try { res = { ...(await resolveFrame(cand.site)), via: "frame" }; } catch {}
      }
      if (!res) {
        const hits = findPhrase(PROJECT, cand.runText);
        if (hits.length === 1) res = { file: hits[0].file, via: "phrase" };
      }
      if (!res) continue;
      const r = applyEdit(PROJECT, { file: res.file, line: res.line, col: res.col, oldText: cand.runText, newText: cand.runText.trim() + " " + marker, runIdSeed: "spike" });
      if (r && r.ok !== false) { chosen = cand; resolved = res; applied = r; break; }
    }
    if (!chosen) {
      const why = `none of ${cands.length} heading candidates resolved (frames: ${cands.filter((c) => c.site).length}; rest phrase-ambiguous)`;
      log(`copy-edit ${route}: FAIL — ${why}`);
      results.push({ route, pass: false, why });
      await page.close();
      continue;
    }
    const post = await page.evaluate((i) => window.__flSpike.structureOf(`[data-fl-probe="${i}"]`), chosen.idx);
    const structureIntact = chosen.structure === post;

    let editOk = false, undoOk = false, why = null, paintHeldPct = null;
    try {
      const t0 = Date.now();
      while (Date.now() - t0 < 45_000) {
        await sleep(1500);
        editOk = await page.evaluate((m) => document.body.innerText.includes(m), marker);
        if (editOk) break;
      }
      if (!editOk) why = `marker never rendered; probe text now: ${JSON.stringify(await page.evaluate((i) => window.__flSpike.probeText(i), chosen.idx))}`;
      await ensureSpike(page, PAINT_FAMILY);
      const paintHeld = await page.evaluate((fam) => window.__flSpike.voiceCoverage("heading", fam), PAINT_FAMILY);
      paintHeldPct = paintHeld.pct;
      const u = undoEdit(PROJECT);
      undoOk = u && u.ok !== false;
      results.push({ route, pass: structureIntact && editOk && undoOk && paintHeldPct >= 90, structureIntact, resolved, editVisible: editOk, undoOk, paintAfterEditPct: paintHeldPct, why });
    } catch (e) {
      why = String(e.message || e);
      results.push({ route, pass: false, structureIntact, resolved, why });
    }
    log(`copy-edit ${route}: structure ${structureIntact ? "intact" : "CHANGED"} · resolve ${resolved.file} (${resolved.via}) · edit ${editOk} · undo ${undoOk} · paint-held ${paintHeldPct}%${why ? " · " + why : ""}`);
    await page.close();
  }
  report.criteria.c4_copyEdit = { pass: results.every((r) => r.pass), results };
}

async function criterion5(browser) {
  const selPath = path.join(PROJECT, ".font-lab", "selection.json");
  const selBackup = selPath + ".spike-backup";
  const gitState = execSync("git status --porcelain", { cwd: PROJECT }).toString().trim();
  copyFileSync(selPath, selBackup);
  const receipts = {};
  try {
    const sel = JSON.parse(readFileSync(selPath, "utf8"));
    sel.direction = { id: "spike-cluster-paint", name: "Spike receipt run", vibe: "-", rationale: "ship-truth stub" };
    sel.roles = {
      display: { family: SHIP.display, source: "google", weights: [400, 700] },
      body: { family: SHIP.body, source: "google", weights: [400, 600] },
      mono: { family: SHIP.mono, source: "google", weights: [400] },
    };
    writeFileSync(selPath, JSON.stringify(sel, null, 2));

    // map shipped roles onto census voices: display→heading, body→body, mono→label
    const SHIPVOICES = { heading: SHIP.display, body: SHIP.body, label: SHIP.mono };
    // call the library directly: apply.mjs's success PRINTOUT crashes on the next-font branch
    // (selfHosted is an array there, {dir,fonts} on css-entry — reported in RESULTS.md)
    const { applySelection, rewireCoverage } = await import(pathToFileURL(path.join(CLI, "codegen.mjs")).href);
    log("running existing apply…");
    const a = await applySelection(PROJECT);
    log(`applied "${a.direction?.name}": ${a.roles.map((x) => `${x.role} ${x.family}`).join(" · ")}`);
    await sleep(6000); // let HMR settle
    for (const route of ROUTES) {
      const page = await freshPage(browser, route);
      receipts[route] = { afterApply: await page.evaluate((t) => window.__flSpike.shipReceipt(t), SHIPVOICES) };
      await page.close();
    }
    log("running existing rewire…");
    const rw = rewireCoverage(PROJECT);
    log(rw.rewired.length ? rw.rewired.map((x) => `${x.role}: var(${x.from}) → var(${x.to}) ×${x.count}`).join(" · ") : `nothing to rewire (${rw.note})`);
    await sleep(6000);
    for (const route of ROUTES) {
      const page = await freshPage(browser, route);
      receipts[route].afterRewire = await page.evaluate((t) => window.__flSpike.shipReceipt(t), SHIPVOICES);
      await page.close();
    }
  } finally {
    // restore the repo exactly: tracked files via git, selection via backup
    execSync("git checkout -- .", { cwd: PROJECT });
    copyFileSync(selBackup, selPath);
    const gitAfter = execSync("git status --porcelain", { cwd: PROJECT }).toString().trim();
    report.criteria.c5_restore = { pass: gitState === gitAfter, cleanBefore: gitState, cleanAfter: gitAfter };
  }
  // the receipt PASSES by being TRUTHFUL, not by converging: body should converge on /,
  // display (heading voice) should NOT until rewire, /fontlab island should stay unreached
  const r = receipts;
  const truthful =
    r["/"].afterApply.body.pct >= 80 &&
    r["/"].afterApply.heading.pct <= 10 &&
    r["/"].afterRewire.heading.pct >= 80;
  const islandUntouched = (r["/fontlab"].afterApply.heading?.pct ?? 0) <= 50 && (r["/fontlab"].afterRewire.heading?.pct ?? 0) <= 50;
  report.criteria.c5_shipTruth = { pass: truthful && islandUntouched, receipts };
  for (const route of ROUTES)
    for (const phase of ["afterApply", "afterRewire"])
      log(`receipt ${route} ${phase}: ` + Object.entries(r[route][phase]).map(([v, x]) => `${v} ${x.pct}%`).join(" · "));
}

// ---- main ---------------------------------------------------------------------
const t0 = Date.now();
report.startedAt = new Date().toISOString();
let browser = null;
try {
  await startDevServer();
  browser = await launch();
  console.log("▶ criteria 1 + 3: preview flip + cluster sanity");
  await criterion1and3(browser);
  console.log("▶ criterion 2: stability (scroll, HMR, re-flip)");
  await criterion2(browser);
  console.log("▶ criterion 4: copy-edit round-trip on painted headings");
  await criterion4(browser);
  if (!has("--skip-ship")) {
    console.log("▶ criterion 5: ship-truth stub (existing apply + rewire, then restore)");
    await criterion5(browser);
  }
} catch (e) {
  report.fatal = String(e && e.stack ? e.stack : e);
  console.error("FATAL:", report.fatal.split("\n")[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  stopDevServer();
}
report.durationSec = Math.round((Date.now() - t0) / 1000);
mkdirSync(path.join(HERE, "out"), { recursive: true });
writeFileSync(path.join(HERE, "out", "report.json"), JSON.stringify(report, null, 2));
console.log("\n══ VERDICT ══");
for (const [k, v] of Object.entries(report.criteria)) console.log(`  ${v.pass === undefined ? "·" : v.pass ? "PASS" : "FAIL"}  ${k}`);
console.log(`report → spike/cluster-paint/out/report.json (${report.durationSec}s)`);
