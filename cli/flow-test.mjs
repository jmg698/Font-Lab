// Flow control (#2 intake gate + #4 menu growth) — dependency-free:
//   node cli/flow-test.mjs
import assert from "node:assert";
import { resolveDirectionsMode, mergeDirections, NO_BRIEF_MESSAGE } from "./flow.mjs";

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

// ── #2 intake gate ──────────────────────────────────────────────────────────
ok(resolveDirectionsMode({ directions: [{ id: "x" }] }) === "composed", "agent-composed directions → 'composed' (the tasteful path)");
ok(resolveDirectionsMode({ allowFallback: true }) === "fallback", "no directions + allowFallback:true → 'fallback' (deliberate default menu)");
for (const args of [{}, { directions: [] }, { directions: null }]) {
  let threw = false, msg = "";
  try { resolveDirectionsMode(args); } catch (e) { threw = true; msg = e.message; }
  ok(threw && /font_lab_start/.test(msg) && /allowFallback/.test(msg),
    `no directions + no fallback (${JSON.stringify(args)}) → throws the actionable nudge`);
}
ok(NO_BRIEF_MESSAGE.includes("compose") && /intake-first/.test(NO_BRIEF_MESSAGE), "the nudge tells the agent to compose for a brief first");

// ── #4 menu growth ──────────────────────────────────────────────────────────
const merged = mergeDirections([{ id: "a", name: "A" }, { id: "b", name: "B" }], [{ id: "b", name: "B2" }, { id: "c", name: "C" }]);
ok(merged.length === 3 && merged.map((d) => d.id).join(",") === "a,b,c", "mergeDirections appends new ids, keeps order");
ok(merged.find((d) => d.id === "b").name === "B2", "on an id clash, the incoming (newer) direction wins");
ok(mergeDirections([], [{ id: "x" }]).length === 1 && mergeDirections([{ id: "y" }], []).length === 1 && mergeDirections().length === 0, "handles empty/missing sides");
ok(mergeDirections([{ name: "no-id" }], [{ id: "z" }]).length === 1, "drops entries without an id");

console.log(`\nflow: ${pass} checks passed`);
