// M4 verification — the parity catalog and the curator. Offline (no network): the gate that
// matters most, capsize coverage, is checked by actually importing each font's metrics; the
// curator's determinism and selection rules are pure logic.

import { catalog, families, get } from "./catalog.mjs";
import { directions, curate, fontsForDirections } from "./curator.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};
const ROLES = ["display", "body", "mono"];
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ===================================================================== //
//  Part 1 — the catalog: every member is a verified parity bundle       //
// ===================================================================== //

assert("catalog is ~40 fonts", families.length >= 36, String(families.length));

let coverageOk = 0;
for (const family of families) {
  const e = catalog[family];
  let metrics = null;
  try {
    metrics = (await import("@capsizecss/metrics/" + e.capsize)).default;
  } catch {}
  const covered = !!(metrics && metrics.familyName);
  if (covered) coverageOk++;
  else assert(`capsize coverage: ${family}`, false, `no metrics for slug "${e.capsize}"`);
  const validRoles = Array.isArray(e.roles) && e.roles.length && e.roles.every((r) => ROLES.includes(r));
  if (!validRoles) assert(`roles valid: ${family}`, false, JSON.stringify(e.roles));
  if (!(e.css2 && /wght@/.test(e.css2))) assert(`css2 weight-range: ${family}`, false, e.css2);
  if (!(Array.isArray(e.tags) && e.tags.length)) assert(`has tags: ${family}`, false, JSON.stringify(e.tags));
}
assert("every catalog font has verified capsize coverage", coverageOk === families.length, `${coverageOk}/${families.length}`);
assert("every catalog font: valid roles / css2 / tags", results.every((r) => r.pass));
assert("mono fonts exist for the mono role", families.some((f) => catalog[f].roles.includes("mono")));

// ===================================================================== //
//  Part 2 — the curator: deterministic, valid, moves off the baseline   //
// ===================================================================== //

// every authored direction references only catalog fonts, with role-appropriate fonts
for (const d of directions) {
  for (const r of ROLES) {
    const fam = d.roles[r].family;
    assert(`${d.id}: ${r} "${fam}" in catalog`, (() => { try { get(fam); return true; } catch { return false; } })());
    assert(`${d.id}: ${fam} suits role ${r}`, catalog[fam].roles.includes(r), catalog[fam].roles.join(","));
  }
  assert(`${d.id}: has name/vibe/rationale`, !!(d.name && d.vibe && d.rationale));
}

const fresh = { replaces: { display: "Inter", body: "Inter", mono: "JetBrains Mono" } };

const a = curate(fresh);
const b = curate(fresh);
assert("curate is deterministic (same input → same output)", deep(a, b));
assert("curate returns 5 by default", a.length === 5, String(a.length));
assert("curate respects count", curate(fresh, { count: 3 }).length === 3);

// excludes no-op directions (display+body already current)
const onGeist = { replaces: { display: "Geist", body: "Geist", mono: "Geist Mono" } };
assert("curate drops a direction that wouldn't change the site", !curate(onGeist, { count: 12 }).some((d) => d.id === "clean-geometric"));

// vibe ranking puts the matching vibe first
const ed = curate(fresh, { vibe: "editorial" });
assert("vibe=editorial ranks an editorial direction first", ed[0].vibe === "editorial", ed[0].vibe);
const minimal = curate(fresh, { vibe: "minimal" });
assert("vibe=minimal ranks a minimal direction first", minimal[0].vibe === "minimal", minimal[0].vibe);

// rationale becomes concrete about what it replaces
assert("rationale names the replaced font when known", a.some((d) => /replaces Inter/.test(d.rationale)));

// fontsForDirections returns catalog members only
const used = fontsForDirections(a);
assert("fontsForDirections returns catalog members", used.length > 0 && used.every((f) => !!catalog[f]));

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "m4-report.json", JSON.stringify({ catalogSize: families.length, directions: directions.length, results }, null, 2));
console.log(`\nM4: ${results.length - failed.length}/${results.length} assertions passed  (catalog ${families.length} fonts, ${directions.length} authored directions)`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M4 PASS");
