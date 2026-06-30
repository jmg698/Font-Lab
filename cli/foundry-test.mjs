// Open-foundry registry (E1) — dependency-free checks on the curated bench and its wiring into
// the gate. The live Fontshare fetch is verified by the deps+network harness, not here.
//   node cli/foundry-test.mjs
import assert from "node:assert";
import { foundry, foundryFamilies, foundryMatch, fontshareCssUrl, FONTSHARE_LICENSE } from "./foundry.mjs";
import { licenseOk } from "./admit.mjs";
import { isOverexposed } from "./design-brain.mjs";
import { inCatalog } from "./catalog.mjs";

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

// registry shape
ok(foundryFamilies.length >= 12, "the foundry bench is substantial");
ok(foundryFamilies.every((f) => { const e = foundry[f]; return e.slug && e.category && Array.isArray(e.roles) && e.roles.length && Array.isArray(e.tags); }),
  "every foundry entry has a slug, category, roles, and tags");
ok(foundryFamilies.includes("Cabinet Grotesk") && foundryFamilies.includes("General Sans") && foundryFamilies.includes("Clash Display"),
  "the bench includes the signature distinctive faces");

// these are the WHOLE POINT — they must be distinctive, not the overexposed set, and not Google
ok(!foundryFamilies.some(isOverexposed), "no foundry face is an overexposed default");
ok(!foundryFamilies.some(inCatalog), "no foundry face overlaps the Google catalog (they're off-Google)");

// lookup
ok(foundryMatch("cabinet grotesk")?.family === "Cabinet Grotesk" && foundryMatch("  GENERAL   SANS ")?.family === "General Sans",
  "foundryMatch is case- and whitespace-insensitive");
ok(foundryMatch("Inter") === null && foundryMatch("") === null, "foundryMatch returns null for non-foundry / empty");

// the CSS-API url + license
const url = fontshareCssUrl("cabinet-grotesk");
ok(/api\.fontshare\.com\/v2\/css\?f\[\]=cabinet-grotesk@400,700/.test(url) && /display=swap/.test(url), "fontshareCssUrl builds a valid Fontshare CSS-API query");
ok(licenseOk(FONTSHARE_LICENSE, "foundry") === true, "the foundry license clears the gate's permissive-license check");

console.log(`\nfoundry: ${pass} checks passed`);
