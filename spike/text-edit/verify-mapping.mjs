// THE de-risk: can we map a clicked rendered node back to file:line:col at RUNTIME,
// with zero build config, under the exact stack Font Lab targets (Next 16 + Turbopack +
// React 19)? If yes, click-to-edit is exact (survives duplicate strings). If no, we fall
// back to string-search (works for unique phrases) and document that a tiny dev-only SWC
// transform is the robust upgrade path.
//
// This loads the REAL running sample-next-site and probes several elements, dumping every
// runtime source signal React exposes so the result is evidence, not assumption.
//
// Usage: node verify-mapping.mjs <base-url>   (defaults to http://localhost:3000)

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000";

// Self-contained: runs in the page. Given a CSS selector, dig for source location through
// every known React-internal channel and report what each yields.
function probeInPage(selector) {
  const el = document.querySelector(selector);
  if (!el) return { selector, error: "element not found" };
  const fmt = (s) => (s && (s.fileName || s.lineNumber != null) ? { fileName: s.fileName, lineNumber: s.lineNumber, columnNumber: s.columnNumber } : null);

  const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const out = {
    selector,
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48),
    hasFiber: !!fiberKey,
    strategies: {},
    debugKeysOnFiber: [],
  };

  const fiber = fiberKey ? el[fiberKey] : null;
  if (fiber) {
    out.debugKeysOnFiber = Object.keys(fiber).filter((k) => k.startsWith("_debug"));
    out.strategies.fiber_debugSource = fmt(fiber._debugSource);
    out.strategies.owner_debugSource = fmt(fiber._debugOwner && fiber._debugOwner._debugSource);
    // walk the return chain for the nearest _debugSource
    let f = fiber, hops = 0, walk = null;
    while (f && hops < 40) { if (fmt(f._debugSource)) { walk = { ...fmt(f._debugSource), hops }; break; } f = f.return; hops++; }
    out.strategies.walk_return_debugSource = walk;
    out.strategies.memoizedProps__source = fmt(fiber.memoizedProps && fiber.memoizedProps.__source);
    out.hasDebugInfo = !!fiber._debugInfo;
    out.hasDebugStack = !!fiber._debugStack;
  }
  if (propsKey) out.strategies.props__source = fmt(el[propsKey] && el[propsKey].__source);

  out.anyHit = Object.values(out.strategies).some(Boolean);
  return out;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log(`\nNODE → SOURCE MAPPING PROBE  (${BASE})\n`);
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("h1", { timeout: 30000 });

const selectors = ["h1", "h2", "main p:nth-of-type(1)", "main p:nth-of-type(2)"];
const results = [];
for (const sel of selectors) {
  const r = await page.evaluate(probeInPage, sel);
  results.push(r);
  const hit = Object.entries(r.strategies).find(([, v]) => v);
  console.log(`  ${r.anyHit ? "✓" : "✗"} ${sel}  "${r.text}"`);
  console.log(`      fiber=${r.hasFiber}  debugKeys=[${r.debugKeysOnFiber.join(", ") || "none"}]`);
  if (hit) console.log(`      → ${hit[0]}: ${hit[1].fileName ?? "?"}:${hit[1].lineNumber}:${hit[1].columnNumber}`);
  else console.log(`      → no source location from any runtime strategy`);
}

const anyWorked = results.some((r) => r.anyHit);
writeFileSync("out-mapping.json", JSON.stringify({ base: BASE, anyWorked, pageErrors: consoleErrors, results }, null, 2));
console.log(`\n${anyWorked ? "✓ runtime source mapping AVAILABLE" : "✗ no runtime source mapping — use string-search fallback / SWC transform"}`);
console.log(`  full dump -> spike/text-edit/out-mapping.json\n`);

await browser.close();
process.exit(0);
