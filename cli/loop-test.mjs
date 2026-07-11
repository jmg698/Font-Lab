// M1 verification — drive the whole loop in a real browser and prove the pick lands on
// disk: flip directions (arrow keys + click), swap fonts live, Pick (button + Enter), and
// assert .font-lab/selection.json + picks.log.jsonl. Spawns the CLI endpoint itself;
// expects the fixture's dev server already running at BASE_URL.
//
// DATA-DRIVEN on purpose: direction ids and families are read back from the GENERATED
// catalog (run-m1.sh runs gen-catalog first), so curator evolution can't silently rot this
// gate. Font assertions measure PAINTED page elements (h1, a body-voice paragraph) — the
// v2.0 panel paints census-stamped text elements; document.body's own computed font never
// changes and must not be the probe.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFixtureCatalog } from "./fixture-catalog.mjs";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4331";
const HERE = fileURLToPath(new URL("./", import.meta.url));
const APP = fileURLToPath(new URL("../examples/sample-next-site/", import.meta.url));
const FLDIR = path.join(APP, ".font-lab");
const SEL = path.join(FLDIR, "selection.json");
const LOG = path.join(FLDIR, "picks.log.jsonl");
mkdirSync(HERE + "out", { recursive: true });

const { directions, replaces } = readFixtureCatalog(APP);
const [dirA, dirB] = directions;
if (!dirA || !dirB) throw new Error("catalog has fewer than 2 directions — gen-catalog output is broken");

rmSync(FLDIR, { recursive: true, force: true });

const cli = spawn("node", [HERE + "font-lab.mjs", "--project", APP, "--port", "7777"], { stdio: "inherit" });
const waitHealth = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://localhost:7777/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("CLI endpoint never became healthy");
};
await waitHealth();

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra ? `(${extra})` : "");
};

const browser = await chromium.launch();
// A crash below must still tear down the endpoint + browser — an orphaned serve process
// inherits this test's stdio and holds any pipe a harness attached to it open forever.
process.on("uncaughtException", (e) => { console.error(e); try { cli.kill(); } catch {} process.exit(5); });
process.on("unhandledRejection", (e) => { console.error(e); try { cli.kill(); } catch {} process.exit(5); });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
// Probe PAINTED elements: the census stamps visible text with data-flv at panel boot, and a
// flip paints those stamps — h1 carries the heading voice, any body-stamped element the body.
const headingFont = () => page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
const bodyTextFont = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-flv="body"]') || document.querySelector("main p, p");
    return el ? getComputedStyle(el).fontFamily : "";
  });
const activeId = () => page.evaluate(() => document.documentElement.getAttribute("data-fontlab-active"));
const clickDir = (id) =>
  page.evaluate((id) => document.getElementById("fontlab-panel-host").shadowRoot.querySelector(`button[data-fl-id="${id}"]`).click(), id);
const clickPick = () =>
  page.evaluate(() => document.getElementById("fontlab-panel-host").shadowRoot.querySelector('[data-fl-action="pick"]').click());
const readSel = () => (existsSync(SEL) ? JSON.parse(readFileSync(SEL, "utf8")) : null);
const painted = (fam) => `FL ${fam}`; // parity faces render as "FL <family>"

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#fontlab-panel-host", { timeout: 30_000 });
// the census stamps the page shortly after mount — wait for stamps, not a fixed delay
await page.waitForFunction(() => !!window.__flCensus && !!document.querySelector("[data-flv]"), null, { timeout: 15_000 });
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(400);
await page.mouse.click(2, 2); // focus the document for keyboard nav

assert("starts on current state", (await activeId()) === "current");
assert(`current body is ${replaces.body}`, (await bodyTextFont()).toLowerCase().includes(replaces.body.toLowerCase()), await bodyTextFont());

// ← → flips to the first direction and swaps the body live.
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(350);
assert(`ArrowRight selects ${dirA.id}`, (await activeId()) === dirA.id, await activeId());
assert(`body swapped to ${dirA.roles.body.family}`, (await bodyTextFont()).includes(painted(dirA.roles.body.family)), await bodyTextFont());

// Click the second direction; display + body both swap.
await clickDir(dirB.id);
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(400);
assert(`click selects ${dirB.id}`, (await activeId()) === dirB.id);
assert(`body swapped to ${dirB.roles.body.family}`, (await bodyTextFont()).includes(painted(dirB.roles.body.family)), await bodyTextFont());
assert(`display swapped to ${dirB.roles.display.family}`, (await headingFont()).includes(painted(dirB.roles.display.family)), await headingFont());

// Pick via button -> selection.json written.
await clickPick();
let sel = null;
for (let i = 0; i < 40; i++) {
  sel = readSel();
  if (sel) break;
  await page.waitForTimeout(150);
}
assert("selection.json written", !!sel);
assert(`direction id = ${dirB.id}`, sel?.direction?.id === dirB.id);
assert(`body family = ${dirB.roles.body.family}`, sel?.roles?.body?.family === dirB.roles.body.family);
assert(`display family = ${dirB.roles.display.family}`, sel?.roles?.display?.family === dirB.roles.display.family);
assert(`mono family = ${dirB.roles.mono.family}`, sel?.roles?.mono?.family === dirB.roles.mono.family);
assert("target tailwind v4", sel?.target?.tailwindVersion === 4);
assert(`records replaces (${replaces.body})`, sel?.replaces?.body === replaces.body);
assert("pick declares cluster-paint scope", sel?.preview?.mechanism === "cluster-paint" && Array.isArray(sel?.preview?.scope) && sel.preview.scope.length === 3, JSON.stringify(sel?.preview?.mechanism));

// Re-pick a different direction via Enter -> overwrites selection.json, appends to log.
await clickDir(dirA.id);
await page.waitForTimeout(250);
await page.keyboard.press("Enter");
let sel2 = null;
for (let i = 0; i < 40; i++) {
  sel2 = readSel();
  if (sel2?.direction?.id === dirA.id) break;
  await page.waitForTimeout(150);
}
assert(`Enter re-picks ${dirA.id}`, sel2?.direction?.id === dirA.id);
const logLines = existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean) : [];
assert("picks.log appended (2 entries)", logLines.length === 2, `lines=${logLines.length}`);

await browser.close();
cli.kill();

const failed = results.filter((r) => !r.pass);
writeFileSync(HERE + "out/m1-report.json", JSON.stringify({ results, finalSelection: readSel() }, null, 2));
console.log(`\nM1 loop: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M1 PASS");
