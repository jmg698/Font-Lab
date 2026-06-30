// Drives the REAL panel on the REAL site like a human would, and screenshots each beat:
// inject panel -> turn on edit mode -> click the h1 -> retype -> Enter (saves to source) ->
// reload (Turbopack HMR shows new words) -> Undo. Proves the intuitive UX, not just the plumbing.
//
// Usage: node demo.mjs <base-url>   (edit server must be running on :7788)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(path.join(here, "panel.browser.js"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("h1");

// mount the panel exactly as a dev build would
await page.addScriptTag({ content: panelSrc });
await page.evaluate(() => window.initTextEditPanel({ endpoint: "http://localhost:7788" }));

const shot = (n) => page.screenshot({ path: path.join(here, `shot-${n}.png`) });

// 1) baseline
await shot("1-before");

// 2) turn on edit mode (button lives in the panel's shadow root)
await page.evaluate(() => document.getElementById("fl-text-host").shadowRoot.getElementById("toggle").click());
await page.hover("h1");
await shot("2-edit-mode");

// 3) click the h1 and retype — the human action
await page.click("h1");
await page.waitForTimeout(150);
await page.evaluate(() => {
  const h = document.querySelector("h1");
  h.textContent = "Anyone can edit these words. No platform lock-in.";
});
await shot("3-typing");

// 4) commit with Enter -> writes to Article.tsx
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
await shot("4-saved");
const status = await page.evaluate(() => document.getElementById("fl-text-host").shadowRoot.getElementById("st").textContent);

// 5) reload: the change is real source, served fresh by Turbopack
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
const afterReload = (await page.textContent("h1"))?.trim();
await shot("5-after-reload");

// 6) undo, reload, confirm restored
await page.addScriptTag({ content: panelSrc });
await page.evaluate(() => window.initTextEditPanel({ endpoint: "http://localhost:7788" }));
await page.evaluate(() => document.getElementById("fl-text-host").shadowRoot.getElementById("undo").click());
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
const restored = (await page.textContent("h1"))?.trim();

console.log("\nDEMO RESULT");
console.log("  save status   :", status);
console.log("  after reload  :", JSON.stringify(afterReload));
console.log("  after undo    :", JSON.stringify(restored));
console.log("  screenshots   : shot-1..5 in spike/text-edit/\n");

await browser.close();
process.exit(0);
