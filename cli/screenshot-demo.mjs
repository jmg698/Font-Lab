// Capture the loop visually: the current state vs a chosen direction, panel in view.
// Usage: BASE_URL=http://localhost:4331 node cli/screenshot-demo.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4331";
const OUT = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "loop-current.png" });

await page.evaluate(() =>
  document.getElementById("fontlab-panel-host").shadowRoot.querySelector('button[data-fl-id="modern-grotesque"]').click(),
);
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "loop-modern-grotesque.png" });

await page.evaluate(() =>
  document.getElementById("fontlab-panel-host").shadowRoot.querySelector('button[data-fl-id="editorial-serif"]').click(),
);
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "loop-editorial.png" });

await browser.close();
console.log("wrote loop-current / loop-editorial / loop-modern-grotesque .png to cli/out/");
