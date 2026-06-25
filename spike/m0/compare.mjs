// M0 parity — part 1: prove our independently-computed adjusted-fallback overrides equal
// next/font's real emitted output, and stage the exact same woff2 for the /preview route.
//
// Reads the built CSS in .next/static/chunks, extracts the "Fraunces Fallback" @font-face,
// compares to out/computed.json, and copies next/font's basic-latin Fraunces woff2 to
// public/fontlab/fraunces.woff2 (what /preview's hand-built @font-face points at).

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP = fileURLToPath(new URL("../../examples/sample-next-site/", import.meta.url));
const OUT = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(OUT, { recursive: true });
mkdirSync(APP + "public/fontlab/", { recursive: true });

const computed = JSON.parse(readFileSync(OUT + "computed.json", "utf8"));

const chunkDir = APP + ".next/static/chunks";
const cssText = readdirSync(chunkDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(path.join(chunkDir, f), "utf8"))
  .join("\n");

const faces = cssText.match(/@font-face\s*{[^}]*}/g) || [];
const grab = (re, b) => {
  const m = b.match(re);
  return m ? m[1] : null;
};

// 1) Fallback overrides emitted by next/font for Fraunces.
const fallbackFace = faces.find((b) => /Fraunces Fallback/i.test(b));
const emitted = fallbackFace
  ? {
      sizeAdjust: grab(/size-adjust:\s*([\d.]+%)/i, fallbackFace),
      ascentOverride: grab(/ascent-override:\s*([\d.]+%)/i, fallbackFace),
      descentOverride: grab(/descent-override:\s*([\d.]+%)/i, fallbackFace),
      lineGapOverride: grab(/line-gap-override:\s*([\d.]+%)/i, fallbackFace),
    }
  : null;

const num = (s) => (s == null ? null : parseFloat(s));
const close = (a, b) => a != null && b != null && Math.abs(num(a) - num(b)) < 0.01;
const keys = ["sizeAdjust", "ascentOverride", "descentOverride", "lineGapOverride"];
const overridesMatch = !!emitted && keys.every((k) => close(emitted[k], computed[k]));

// 2) Copy next/font's basic-latin Fraunces woff2 (the "-s.p." preloaded primary face).
const primaryFaces = faces.filter((b) => /font-family:\s*Fraunces;/i.test(b));
const chosen = primaryFaces.find((b) => /-s\.p\.[^)]*\.woff2/.test(b)) || primaryFaces[0];
const srcm = chosen && chosen.match(/url\((?:\.\.\/)*media\/([^)]+\.woff2)\)/);
let copiedWoff2 = null;
if (srcm) {
  copyFileSync(path.join(APP, ".next/static/media", srcm[1]), APP + "public/fontlab/fraunces.woff2");
  copiedWoff2 = srcm[1];
}

const report = { computed, emitted, overridesMatch, copiedWoff2, frauncesFaceCount: primaryFaces.length };
writeFileSync(OUT + "compare-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (!overridesMatch) {
  console.error("FAIL: computed overrides do not match next/font emitted output");
  process.exit(2);
}
if (!copiedWoff2) {
  console.error("FAIL: could not locate/copy Fraunces woff2");
  process.exit(3);
}
console.log("OK: overrides match exactly; Fraunces woff2 staged at public/fontlab/fraunces.woff2");
