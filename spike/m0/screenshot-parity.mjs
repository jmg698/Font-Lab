// M0 parity — part 2: pixel-diff /ship (next/font Fraunces) vs /preview (our hand-built
// precomputed @font-face on the same woff2). A near-zero diff proves WYSIWYG: what the
// human approves in preview is what next/font ships.

import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:4311";
const OUT = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const shoot = async (page, url, file) => {
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    return true;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: file, fullPage: true });
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 2 });
await shoot(page, BASE + "/ship", OUT + "ship.png");
await shoot(page, BASE + "/preview", OUT + "preview.png");
await browser.close();

const a = PNG.sync.read(readFileSync(OUT + "ship.png"));
const b = PNG.sync.read(readFileSync(OUT + "preview.png"));
const width = Math.min(a.width, b.width);
const height = Math.min(a.height, b.height);

// Crop both to the shared region so pixelmatch gets identical dimensions.
const crop = (img) => {
  if (img.width === width && img.height === height) return img.data;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (img.width * y + x) << 2;
      const di = (width * y + x) << 2;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out.data;
};

const diff = new PNG({ width, height });
const mismatch = pixelmatch(crop(a), crop(b), diff.data, width, height, { threshold: 0.1 });
writeFileSync(OUT + "diff.png", PNG.sync.write(diff));

const total = width * height;
const report = {
  shipDims: [a.width, a.height],
  previewDims: [b.width, b.height],
  comparedDims: [width, height],
  totalPixels: total,
  mismatchedPixels: mismatch,
  mismatchPct: +((mismatch / total) * 100).toFixed(4),
};
writeFileSync(OUT + "parity-report.json", JSON.stringify(report, null, 2));
console.log("PARITY", JSON.stringify(report));
