// Panel keymap parity — the KEYMAP table in the panel template is the single source of
// truth for every painted key hint (the colophon spine, the "? keys" back page, tooltips).
// This test keeps it honest both ways: every key the onKey handler acts on must be named
// by a KEYMAP entry, and every key KEYMAP claims must be handled. Pure static check, no
// deps, no browser — runs in the publish gate so the two can never silently drift.
// (This is what caught the original orphan: ` collapse was handled but documented nowhere.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./templates/font-lab-panel.tsx", import.meta.url)), "utf8");

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, !cond && extra ? `(${extra})` : "");
};

// ---- keys the handler acts on: every `k === "…"` / `e.key === "…"` inside onKey ----------
const onKeyStart = src.indexOf("const onKey");
const onKeyEnd = src.indexOf("const onKeyUp");
assert("onKey handler found", onKeyStart > -1 && onKeyEnd > onKeyStart);
const onKeySrc = src.slice(onKeyStart, onKeyEnd);
const handled = new Set();
for (const m of onKeySrc.matchAll(/(?:\bk|e\.key) === "([^"]+)"/g)) handled.add(m[1]);

// ---- keys the KEYMAP documents: the union of every entry's `keys: […]` -------------------
const kmStart = src.indexOf("const KEYMAP");
const kmEnd = src.indexOf("];", kmStart);
assert("KEYMAP table found", kmStart > -1 && kmEnd > kmStart);
const kmSrc = src.slice(kmStart, kmEnd);
const documented = new Set();
// the list may itself contain "]" as a key, so consume quoted strings whole
for (const m of kmSrc.matchAll(/keys: \[((?:[^\]"]|"[^"]*")*)\]/g))
  for (const q of m[1].matchAll(/"([^"]+)"/g)) documented.add(q[1]);

const show = (k) => (k === " " ? "space" : k);
const undocumented = [...handled].filter((k) => !documented.has(k));
const phantom = [...documented].filter((k) => !handled.has(k));

assert("every handled key is documented in KEYMAP", undocumented.length === 0, undocumented.map(show).join(", "));
assert("every KEYMAP key is actually handled", phantom.length === 0, phantom.map(show).join(", "));
assert("sanity: a real spread of keys on both sides", handled.size >= 15 && documented.size >= 15, `${handled.size} handled / ${documented.size} documented`);

const failed = results.filter((r) => !r.pass);
console.log(`\npanel-keys: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) process.exit(5);
console.log("panel-keys PASS");
