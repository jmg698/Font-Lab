// One-off: render the context brief HTML to a PDF (Chromium via the spike's playwright).
import { chromium } from "playwright";
const [, , src, out] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + src, { waitUntil: "networkidle" });
await page.pdf({
  path: out,
  format: "Letter",
  printBackground: true,
  margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
});
await browser.close();
console.log("wrote", out);
