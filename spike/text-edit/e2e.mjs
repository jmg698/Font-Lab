// END-TO-END proof on the REAL running sample-next-site:
//   click a heading -> resolve its source via _debugStack + source map -> edit the .tsx with
//   the write-back engine -> reload -> the browser shows the new words -> undo -> restored.
// This exercises the entire click-to-edit pipeline with zero build config on the fixture.
//
// Usage: node e2e.mjs <base-url> <project-dir>

import { chromium } from "playwright";
import { SourceMapConsumer } from "source-map";
import { applyEdit, undoEdit } from "./edit-codegen.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3000";
const PROJECT = process.argv[3] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/sample-next-site");

function callSiteFrame(stackLines) {
  for (const line of stackLines) {
    const m = line.match(/at\s+(?:.*?\s+\()?(https?:\/\/[^\s)]+):(\d+):(\d+)\)?/);
    if (!m || /react-stack-top-frame|jsxDEV/.test(line)) continue;
    return { url: m[1], line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

let pass = 0, fail = 0;
const ok = (n, c, x = "") => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${x}`)));

const browser = await chromium.launch();
const page = await browser.newPage();

// 1) resolve the clicked node (h1) to original source, exactly as the panel would.
async function resolveSelector(sel) {
  const info = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    const fiber = el[key];
    const stack = fiber._debugStack ? (fiber._debugStack.stack || String(fiber._debugStack)) : "";
    return { stack: stack.split("\n"), text: (el.textContent || "").replace(/\s+/g, " ").trim() };
  }, sel);
  const cs = callSiteFrame(info.stack);
  const res = await page.request.get(cs.url + ".map");
  const consumer = await new SourceMapConsumer(await res.json());
  const orig = consumer.originalPositionFor({ line: cs.line, column: cs.column });
  consumer.destroy();
  const file = orig.source.replace(/^file:\/\//, "");
  return { file, line: orig.line, col: orig.column, text: info.text };
}

console.log(`\nEND-TO-END CLICK-TO-EDIT  (${BASE})\n  project: ${PROJECT}\n`);
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("h1");

const NEW = "Editing words on a live agentic site — no Lovable required.";
let target;
try {
  target = await resolveSelector("h1");
  ok(`resolve h1 -> ${path.relative(PROJECT, target.file)}:${target.line}`, !!target.line, JSON.stringify(target));

  // 2) write the edit back to the real source file (backup-first).
  const r = applyEdit(PROJECT, { file: target.file, line: target.line, col: target.col, newText: NEW, runIdSeed: "e2e" });
  ok("write-back succeeded", r.ok, JSON.stringify(r));

  // 3) the running site reflects the new words after Turbopack HMR / reload.
  await page.waitForTimeout(1500); // let Turbopack recompile
  await page.reload({ waitUntil: "networkidle" });
  const after = (await page.textContent("h1"))?.replace(/\s+/g, " ").trim();
  ok("browser shows the new words", after === NEW, `got: "${after}"`);
} finally {
  // 4) undo restores the fixture byte-for-byte (always run, even if an assert failed).
  try {
    const u = undoEdit(PROJECT);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle" });
    const restored = (await page.textContent("h1"))?.replace(/\s+/g, " ").trim();
    ok("undo restores original words", restored === target?.text, `got: "${restored}"`);
  } catch (e) {
    fail++; console.log(`  ✗ undo threw: ${e.message}`);
  }
}

console.log(`\n${fail ? "✗" : "✓"} e2e: ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
