// M6 verification — drive the polished choosing moment in a real browser and prove the new
// powers actually work on the running fixture: mixed picks (display from A, body from B),
// before/after, pin-two-to-compare, and multi-route persistence. Spawns the CLI endpoint;
// expects the fixture dev server already running at BASE_URL.
//
// DATA-DRIVEN on purpose: direction ids and families come from the GENERATED catalog
// (run-m6.sh runs gen-catalog first), so curator evolution can't silently rot this gate.
// Font assertions probe PAINTED page elements (h1 / a body-voice element) — the v2.0 panel
// paints census-stamped text, so document.body's computed font is not a valid probe.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFixtureCatalog } from "./fixture-catalog.mjs";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4332";
const HERE = fileURLToPath(new URL("./", import.meta.url));
const APP = fileURLToPath(new URL("../examples/sample-next-site/", import.meta.url));
const SEL = path.join(APP, ".font-lab", "selection.json");
mkdirSync(HERE + "out", { recursive: true });
rmSync(path.join(APP, ".font-lab"), { recursive: true, force: true });

const { directions, replaces } = readFixtureCatalog(APP);
const dirA = directions[0]; // the mix base
const dirB = directions[2] ?? directions[1]; // the compare finalist
if (!dirA || !dirB) throw new Error("catalog has fewer than 2 directions — gen-catalog output is broken");

const cli = spawn("node", [HERE + "font-lab.mjs", "--project", APP, "--port", "7777"], { stdio: "inherit" });
for (let i = 0; i < 40; i++) {
  try { if ((await fetch("http://localhost:7777/health")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

const SHADOW = `document.getElementById("fontlab-panel-host").shadowRoot`;
const click = (sel) => page.evaluate((s) => eval(s.host).querySelector(s.sel).click(), { host: SHADOW, sel });
const famRow = (role) => page.evaluate((s) => eval(s.host).querySelector(`[data-fl-fam="${s.role}"]`).textContent, { host: SHADOW, role });
const activeId = () => page.evaluate(() => document.documentElement.getAttribute("data-fontlab-active"));
const bodyFont = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-flv="body"]') || document.querySelector("main p, p");
    return el ? getComputedStyle(el).fontFamily : "";
  });
const dispFont = () => page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
const settle = async () => { await page.evaluate(async () => { await document.fonts.ready; }); await page.waitForTimeout(220); };
const boot = async () => {
  await page.waitForSelector("#fontlab-panel-host", { timeout: 30_000 });
  await page.waitForFunction(() => !!window.__flCensus && !!document.querySelector("[data-flv]"), null, { timeout: 15_000 });
  await settle();
};
const readSel = () => (existsSync(SEL) ? JSON.parse(readFileSync(SEL, "utf8")) : null);
const blur = () => page.mouse.click(3, 3);
const painted = (fam) => `FL ${fam}`;

try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await boot();
  await blur();
  assert(`starts on current (${replaces.body})`, (await activeId()) === "current" && (await bodyFont()).toLowerCase().includes(replaces.body.toLowerCase()), await bodyFont());

  // ---- Mixed pick: display from direction A, body swapped to another direction's font ----
  await click(`button[data-fl-id="${dirA.id}"]`);
  await settle();
  assert(`${dirA.id}: display ${dirA.roles.display.family}`, (await dispFont()).includes(painted(dirA.roles.display.family)), await dispFont());
  assert(`${dirA.id}: body ${dirA.roles.body.family}`, (await bodyFont()).includes(painted(dirA.roles.body.family)), await bodyFont());

  // Cycle just the body role — and keep cycling past dirB's body face so the pin-compare
  // below is guaranteed to toggle between two DIFFERENT body fonts.
  for (let i = 0; i < 8; i++) {
    await click('[data-fl-inc="body"]');
    await settle();
    const fam = await famRow("body");
    if (fam !== dirA.roles.body.family && fam !== dirB.roles.body.family) break;
  }
  const mixedBody = await bodyFont();
  assert("mixed: body changed independently", !mixedBody.includes(painted(dirA.roles.body.family)) && /FL /.test(mixedBody), mixedBody);
  assert(`mixed: display still ${dirA.roles.display.family}`, (await dispFont()).includes(painted(dirA.roles.display.family)), await dispFont());
  assert("mixed: active flips to 'mixed'", (await activeId()) === "mixed", await activeId());
  const bodyFam = await famRow("body");

  await click('[data-fl-action="pick"]');
  let sel = null;
  for (let i = 0; i < 40; i++) { sel = readSel(); if (sel) break; await page.waitForTimeout(150); }
  assert("mixed pick written", !!sel);
  assert("mixed pick: direction id = mixed", sel?.direction?.id === "mixed", sel?.direction?.id);
  assert(`mixed pick: display = ${dirA.roles.display.family}`, sel?.roles?.display?.family === dirA.roles.display.family);
  assert("mixed pick: body = the swapped font", sel?.roles?.body?.family === bodyFam, `${sel?.roles?.body?.family} vs ${bodyFam}`);
  assert("mixed pick: display ≠ body (it's a real mix)", sel?.roles?.display?.family !== sel?.roles?.body?.family);

  // ---- Before / after ----
  await click('[data-fl-action="compare"]');
  await settle();
  assert("before/after shows current", (await activeId()) === "current" && (await bodyFont()).toLowerCase().includes(replaces.body.toLowerCase()), await bodyFont());
  await click('[data-fl-action="compare"]');
  await settle();
  assert("before/after restores the build", (await activeId()) === "mixed");

  // ---- Save the mix, then compare two finalists with space (snap back) ----
  // The save-mix control lives on the standfirst sentence and exists only while a hand-mix
  // is showing; dirB is already a direction, so there is nothing to save there.
  await click('[data-fl-action="pin"]'); // save A (the mix) — joins the list as a direction
  await click(`button[data-fl-id="${dirB.id}"]`); // view B
  await settle();
  await blur();
  await page.keyboard.press(" ");
  await settle();
  const firstShown = await bodyFont();
  await blur();
  await page.keyboard.press(" ");
  await settle();
  const secondShown = await bodyFont();
  assert("pin compare toggles between A and B", firstShown !== secondShown, `${firstShown} / ${secondShown}`);
  assert(`one of the pinned views is ${dirB.roles.body.family} (${dirB.id})`,
    firstShown.includes(painted(dirB.roles.body.family)) || secondShown.includes(painted(dirB.roles.body.family)),
    `${firstShown} / ${secondShown}`);

  // ---- Multi-route: re-establish a mix, navigate, confirm it persists ----
  await click(`button[data-fl-id="${dirA.id}"]`);
  await click('[data-fl-inc="body"]');
  await settle();
  const homeBody = await bodyFont();
  await page.goto(BASE + "/dense", { waitUntil: "domcontentloaded" });
  await boot();
  assert("panel persists across route nav (multi-route)", (await bodyFont()) === homeBody, `${await bodyFont()} vs ${homeBody}`);
  assert("dense route renders the mixed display too", (await dispFont()).includes(painted(dirA.roles.display.family)), await dispFont());
  await page.screenshot({ path: HERE + "out/m6-dense.png" });
} finally {
  await browser.close();
  cli.kill();
}

const failed = results.filter((r) => !r.pass);
writeFileSync(HERE + "out/m6-report.json", JSON.stringify({ results, finalSelection: readSel() }, null, 2));
console.log(`\nM6: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M6 PASS");
