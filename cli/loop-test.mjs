// M1 verification — drive the whole loop in a real browser and prove the pick lands on
// disk: flip directions (arrow keys + click), swap fonts live, Pick (button + Enter), and
// assert .font-lab/selection.json + picks.log.jsonl. Spawns the CLI endpoint itself;
// expects the fixture's dev server already running at BASE_URL.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4331";
const HERE = fileURLToPath(new URL("./", import.meta.url));
const APP = fileURLToPath(new URL("../examples/sample-next-site/", import.meta.url));
const FLDIR = path.join(APP, ".font-lab");
const SEL = path.join(FLDIR, "selection.json");
const LOG = path.join(FLDIR, "picks.log.jsonl");
mkdirSync(HERE + "out", { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const bodyFont = () => page.evaluate(() => getComputedStyle(document.body).fontFamily);
const displayFont = () => page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
const activeId = () => page.evaluate(() => document.documentElement.getAttribute("data-fontlab-active"));
const clickDir = (id) =>
  page.evaluate((id) => document.getElementById("fontlab-panel-host").shadowRoot.querySelector(`button[data-fl-id="${id}"]`).click(), id);
const clickPick = () =>
  page.evaluate(() => document.getElementById("fontlab-panel-host").shadowRoot.querySelector('[data-fl-action="pick"]').click());
const readSel = () => (existsSync(SEL) ? JSON.parse(readFileSync(SEL, "utf8")) : null);

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(600);
await page.mouse.click(2, 2); // focus the document for keyboard nav

assert("starts on current state", (await activeId()) === "current");
assert("current body is Inter", /Inter/i.test(await bodyFont()), await bodyFont());

// ← → flips to the first direction and swaps the body live.
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(250);
assert("ArrowRight selects editorial-serif", (await activeId()) === "editorial-serif", await activeId());
assert("body swapped to Libre Franklin", /FL Libre Franklin/i.test(await bodyFont()), await bodyFont());

// Click the second direction; display + body both swap.
await clickDir("modern-grotesque");
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(300);
assert("click selects modern-grotesque", (await activeId()) === "modern-grotesque");
assert("body swapped to Figtree", /FL Figtree/i.test(await bodyFont()), await bodyFont());
assert("display swapped to Bricolage", /FL Bricolage/i.test(await displayFont()), await displayFont());

// Pick via button -> selection.json written.
await clickPick();
let sel = null;
for (let i = 0; i < 40; i++) {
  sel = readSel();
  if (sel) break;
  await page.waitForTimeout(150);
}
assert("selection.json written", !!sel);
assert("direction id = modern-grotesque", sel?.direction?.id === "modern-grotesque");
assert("body family = Figtree", sel?.roles?.body?.family === "Figtree");
assert("display family = Bricolage Grotesque", sel?.roles?.display?.family === "Bricolage Grotesque");
assert("mono family = JetBrains Mono", sel?.roles?.mono?.family === "JetBrains Mono");
assert("target tailwind v4", sel?.target?.tailwindVersion === 4);
assert("records replaces (Inter)", sel?.replaces?.body === "Inter");

// Re-pick a different direction via Enter -> overwrites selection.json, appends to log.
await clickDir("editorial-serif");
await page.waitForTimeout(200);
await page.keyboard.press("Enter");
let sel2 = null;
for (let i = 0; i < 40; i++) {
  sel2 = readSel();
  if (sel2?.direction?.id === "editorial-serif") break;
  await page.waitForTimeout(150);
}
assert("Enter re-picks editorial-serif", sel2?.direction?.id === "editorial-serif");
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
