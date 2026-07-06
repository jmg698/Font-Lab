// Proof that React 19's `_debugStack` -> exact source location, zero build config.
//
// React 19 dropped `_debugSource`; instead each element's fiber carries `_debugStack`, an
// Error captured at the jsxDEV call site. The frame immediately below the `jsxDEV` top frame
// is the JSX element's location in BUNDLED coordinates. Turbopack serves dev source maps, so
// we resolve that bundled (line,col) back to the original file:line:col. This is the runtime
// locator the click-to-edit panel will use; here we prove it resolves to the real .tsx.

import { chromium } from "playwright";
import { SourceMapConsumer } from "source-map";

const BASE = process.argv[2] || "http://localhost:3000";

// Parse the call-site frame from a captured _debugStack: skip the react-internal top frames
// (`react-stack-top-frame`, `jsxDEV`) and take the first app frame -> the JSX element site.
function callSiteFrame(stackLines) {
  for (const line of stackLines) {
    const m = line.match(/at\s+(?:.*?\s+\()?(https?:\/\/[^\s)]+):(\d+):(\d+)\)?/);
    if (!m) continue;
    if (/react-stack-top-frame|jsxDEV/.test(line)) continue; // react internals
    return { url: m[1], line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("h1");

// For a few elements, grab the call-site frame straight off the host fiber's _debugStack.
const frames = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    const fiber = el[key];
    const stack = fiber._debugStack ? (fiber._debugStack.stack || String(fiber._debugStack)) : null;
    return { sel, text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), stack: stack ? stack.split("\n") : null };
  };
  return ["h1", "h2", "blockquote"].map(pick);
});

const mapCache = new Map();
async function consumerFor(url) {
  if (mapCache.has(url)) return mapCache.get(url);
  const res = await page.request.get(url + ".map");
  if (!res.ok()) { mapCache.set(url, null); return null; }
  const c = await new SourceMapConsumer(await res.json());
  mapCache.set(url, c);
  return c;
}

console.log(`\nSTACK → SOURCE RESOLUTION  (${BASE})\n`);
let resolved = 0;
const results = [];
for (const f of frames) {
  if (!f.stack) { console.log(`  ✗ ${f.sel}  no _debugStack`); continue; }
  const cs = callSiteFrame(f.stack);
  if (!cs) { console.log(`  ✗ ${f.sel}  no call-site frame`); continue; }
  const c = await consumerFor(cs.url);
  if (!c) { console.log(`  ✗ ${f.sel}  no source map for ${cs.url}`); continue; }
  const orig = c.originalPositionFor({ line: cs.line, column: cs.column });
  const okHit = orig.source && orig.line != null;
  if (okHit) resolved++;
  results.push({ sel: f.sel, text: f.text, bundled: `${cs.line}:${cs.column}`, original: orig });
  console.log(`  ${okHit ? "✓" : "✗"} ${f.sel}  "${f.text}"`);
  console.log(`      bundled  ${cs.url.split("/").pop()}:${cs.line}:${cs.column}`);
  console.log(`      original ${orig.source}:${orig.line}:${orig.column}  (name: ${orig.name ?? "-"})`);
}

console.log(`\n${resolved === frames.length ? "✓" : resolved ? "~" : "✗"} resolved ${resolved}/${frames.length} to original source\n`);
await browser.close();
process.exit(0);
