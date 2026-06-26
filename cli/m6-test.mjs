// M6 verification — drive the polished choosing moment in a real browser and prove the new
// powers actually work on the running fixture: mixed picks (display from A, body from B),
// before/after, pin-two-to-compare, and multi-route persistence. Spawns the CLI endpoint;
// expects the fixture dev server already running at BASE_URL.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4332";
const HERE = fileURLToPath(new URL("./", import.meta.url));
const APP = fileURLToPath(new URL("../examples/sample-next-site/", import.meta.url));
const SEL = path.join(APP, ".font-lab", "selection.json");
mkdirSync(HERE + "out", { recursive: true });
rmSync(path.join(APP, ".font-lab"), { recursive: true, force: true });

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
const bodyFont = () => page.evaluate(() => getComputedStyle(document.body).fontFamily);
const dispFont = () => page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
const settle = async () => { await page.evaluate(async () => { await document.fonts.ready; }); await page.waitForTimeout(180); };
const readSel = () => (existsSync(SEL) ? JSON.parse(readFileSync(SEL, "utf8")) : null);
const blur = () => page.mouse.click(3, 3);

try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await settle();
  await blur();
  assert("starts on current (Inter)", (await activeId()) === "current" && /Inter/i.test(await bodyFont()), await bodyFont());

  // ---- Mixed pick: display from Editorial, body swapped to another direction's font ----
  await click('button[data-fl-id="editorial-serif"]');
  await settle();
  assert("editorial: display Fraunces", /FL Fraunces/i.test(await dispFont()), await dispFont());
  assert("editorial: body Libre Franklin", /FL Libre Franklin/i.test(await bodyFont()), await bodyFont());

  await click('[data-fl-inc="body"]'); // cycle just the body role
  await settle();
  const mixedBody = await bodyFont();
  assert("mixed: body changed independently", !/Libre Franklin/i.test(mixedBody) && /FL /.test(mixedBody), mixedBody);
  assert("mixed: display still Fraunces", /FL Fraunces/i.test(await dispFont()), await dispFont());
  assert("mixed: active flips to 'mixed'", (await activeId()) === "mixed", await activeId());
  const bodyFam = await famRow("body");

  await click('[data-fl-action="pick"]');
  let sel = null;
  for (let i = 0; i < 40; i++) { sel = readSel(); if (sel) break; await page.waitForTimeout(150); }
  assert("mixed pick written", !!sel);
  assert("mixed pick: direction id = mixed", sel?.direction?.id === "mixed", sel?.direction?.id);
  assert("mixed pick: display = Fraunces", sel?.roles?.display?.family === "Fraunces");
  assert("mixed pick: body = the swapped font", sel?.roles?.body?.family === bodyFam, `${sel?.roles?.body?.family} vs ${bodyFam}`);
  assert("mixed pick: display ≠ body (it's a real mix)", sel?.roles?.display?.family !== sel?.roles?.body?.family);

  // ---- Before / after ----
  await click('[data-fl-action="compare"]');
  await settle();
  assert("before/after shows current", (await activeId()) === "current" && /Inter/i.test(await bodyFont()), await bodyFont());
  await click('[data-fl-action="compare"]');
  await settle();
  assert("before/after restores the build", (await activeId()) === "mixed");

  // ---- Pin two to compare ----
  await click('[data-fl-action="pin"]'); // pin A (the mix)
  await click('button[data-fl-id="clean-geometric"]'); // build B
  await settle();
  await click('[data-fl-action="pin"]'); // pin B
  await blur();
  await page.keyboard.press(" ");
  await settle();
  const firstShown = await bodyFont();
  await blur();
  await page.keyboard.press(" ");
  await settle();
  const secondShown = await bodyFont();
  assert("pin compare toggles between A and B", firstShown !== secondShown, `${firstShown} / ${secondShown}`);
  assert("one of the pinned views is Geist (clean-geometric)", /FL Geist/i.test(firstShown) || /FL Geist/i.test(secondShown));

  // ---- Multi-route: re-establish a mix, navigate, confirm it persists ----
  await click('button[data-fl-id="editorial-serif"]');
  await click('[data-fl-inc="body"]');
  await settle();
  const homeBody = await bodyFont();
  await page.goto(BASE + "/dense", { waitUntil: "domcontentloaded" });
  await settle();
  assert("panel persists across route nav (multi-route)", (await bodyFont()) === homeBody, `${await bodyFont()} vs ${homeBody}`);
  assert("dense route renders the mixed display too", /FL Fraunces/i.test(await dispFont()), await dispFont());
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
