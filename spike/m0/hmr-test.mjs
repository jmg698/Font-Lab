// M0 injection — prove the dev panel's :root font swap survives Next.js Fast Refresh.
//
// Steps: load /, click the panel's "Fraunces" button (sets --fl-* on <html> via inline
// style), then edit app/page.tsx to trigger a real Fast Refresh (we rewrite a marker and
// wait for it to appear), then assert the swap is still in effect. Reverts the edit after.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4312";
const APP = fileURLToPath(new URL("../../examples/sample-next-site/", import.meta.url));
const OUT = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const PAGE_FILE = APP + "app/page.tsx";

const log = {};
const rec = (k, v) => {
  log[k] = v;
  console.log(k, "=", JSON.stringify(v));
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const bodyFont = () => page.evaluate(() => getComputedStyle(document.body).fontFamily);

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(700);
rec("font.initial", await bodyFont());

// Flip to Fraunces via the shadow-DOM panel.
await page.evaluate(() => {
  const host = document.getElementById("fontlab-panel-host");
  host.shadowRoot.querySelector('button[data-fl="fraunces"]').click();
});
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(400);
rec("active.afterClick", await page.evaluate(() => document.documentElement.getAttribute("data-fontlab-active")));
rec("flSans.afterClick", await page.evaluate(() => document.documentElement.style.getPropertyValue("--fl-sans")));
rec("font.afterClick", await bodyFont());
await page.screenshot({ path: OUT + "hmr-before.png", fullPage: true });

// Trigger a real Fast Refresh by editing the page component.
const orig = readFileSync(PAGE_FILE, "utf8");
const mutated = orig.replace("hmr-v0", "hmr-v1");
if (mutated === orig) throw new Error("HMR marker 'hmr-v0' not found in page.tsx");
writeFileSync(PAGE_FILE, mutated);

let hmrApplied = false;
try {
  for (let i = 0; i < 48; i++) {
    const v = await page.evaluate(() => document.getElementById("hmr-marker")?.textContent?.trim());
    if (v === "hmr-v1") {
      hmrApplied = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  rec("hmr.applied", hmrApplied);
  rec("active.afterHMR", await page.evaluate(() => document.documentElement.getAttribute("data-fontlab-active")));
  rec("flSans.afterHMR", await page.evaluate(() => document.documentElement.style.getPropertyValue("--fl-sans")));
  rec("font.afterHMR", await bodyFont());
  await page.screenshot({ path: OUT + "hmr-after.png", fullPage: true });
} finally {
  writeFileSync(PAGE_FILE, orig); // always revert
  await browser.close();
}

const pass =
  hmrApplied &&
  log["active.afterHMR"] === "fraunces" &&
  /FL Fraunces/i.test(log["font.afterHMR"] || "");
writeFileSync(OUT + "hmr-report.json", JSON.stringify({ log, hmrApplied, pass }, null, 2));
console.log("HMR PASS =", pass);
if (!pass) process.exit(4);
