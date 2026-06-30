// Unit test for the dynamic shippability gate (A2). Dependency-free — the impure resolvers are
// injected as fakes, so the GATE LOGIC is fully verified without a network or node_modules:
//   node cli/admit-test.mjs
import assert from "node:assert";
import {
  admit, classifyParity, licenseOk, catalogMatch, mapCategory, normalize, isShippable, parseWoff2Url,
} from "./admit.mjs";

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

// ── pure helpers ──────────────────────────────────────────────────────────────
ok(normalize("  Space   Grotesk ") === "space grotesk", "normalize collapses case + whitespace");
ok(catalogMatch("inter")?.family === "Inter" && catalogMatch("FRAUNCES")?.family === "Fraunces",
  "catalog lookup is case-insensitive");
ok(!catalogMatch("Cabinet Grotesk"), "non-catalog family doesn't match the catalog");
ok(mapCategory("Sans Serif") === "sans-serif" && mapCategory("Serif") === "serif" && mapCategory("Monospace") === "monospace",
  "mapCategory handles the 'sans serif' substring trap");

// parity classification — the soft-degrade policy
ok(classifyParity({ variable: true, hasMetrics: true }).parity === "guaranteed", "variable + metrics → guaranteed");
ok(classifyParity({ variable: false, hasMetrics: true }).parity === "best-effort", "static weights → best-effort");
ok(classifyParity({ variable: true, hasMetrics: false }).parity === "best-effort", "no metrics → best-effort");
ok(classifyParity({ variable: false, hasMetrics: false }).warnings.length === 2, "both gaps → two warnings");

// licensing gate
ok(licenseOk(null, "google") && licenseOk("anything", "catalog"), "google/catalog always license-OK");
ok(licenseOk("SIL Open Font License 1.1", "fontshare") && licenseOk("Free for commercial use", "fontshare"),
  "permissive foundry licenses pass");
ok(!licenseOk("Preview only — all rights reserved", "fontshare") && !licenseOk("", "fontshare"),
  "restrictive/unknown foundry licenses are refused");

// ── the woff2-src parser across providers (the bug the mocks hid) ───────────
ok(parseWoff2Url("/* latin */\n@font-face {font-family:'X';src:url(https://fonts.gstatic.com/s/x/v1/abc.woff2) format('woff2');}") === "https://fonts.gstatic.com/s/x/v1/abc.woff2",
  "parses Google's unquoted https woff2 (latin subset)");
ok(parseWoff2Url("/* Cabinet Grotesk */\n@font-face {\n  font-family: 'Cabinet Grotesk';\n  src: url('//cdn.fontshare.com/wf/7GWN.woff2') format('woff2');\n  font-weight: 400;\n}") === "https://cdn.fontshare.com/wf/7GWN.woff2",
  "parses Fontshare's single-quoted, protocol-relative woff2 → normalized to https");
ok(parseWoff2Url("@font-face { src: url(\"//cdn.fontshare.com/wf/AB.woff2\"); }") === "https://cdn.fontshare.com/wf/AB.woff2",
  "handles double-quoted protocol-relative too");
ok(parseWoff2Url("@font-face { src: local('x'); }") === null, "returns null when there's no woff2");

// ── the gate, with injected fakes ───────────────────────────────────────────
const noNet = { resolveGoogle: async () => ({ found: false }), resolveFoundry: async () => ({ found: false }) };

// catalog member → instant guarantee, never touches the network
let netCalls = 0;
const counting = {
  resolveGoogle: async () => { netCalls++; return { found: false }; },
  resolveFoundry: async () => { netCalls++; return { found: false }; },
};
const cat = await admit("Inter", counting);
ok(cat.parity === "guaranteed" && cat.source === "catalog" && netCalls === 0,
  "catalog member is guaranteed without any network call");

// Google variable + metrics → guaranteed
const gv = await admit("Hedvig Letters Serif", {
  resolveGoogle: async () => ({ found: true, family: "Hedvig Letters Serif", css2: "Hedvig+Letters+Serif:wght@400..400", variable: true, category: "Serif" }),
  deriveMetrics: async () => ({ metrics: { category: "serif" }, woff2Url: "https://x/h.woff2" }),
});
ok(gv.parity === "guaranteed" && gv.source === "google" && gv.category === "serif" && gv.woff2Url,
  "Google variable + derivable metrics → guaranteed");

// Google found but metrics fail → best-effort with a warning, still shippable
const gbe = await admit("Some Static Font", {
  resolveGoogle: async () => ({ found: true, family: "Some Static Font", css2: "Some+Static+Font:wght@400", variable: false, category: "Display" }),
  deriveMetrics: async () => ({ metrics: null, woff2Url: "https://x/s.woff2" }),
});
ok(gbe.parity === "best-effort" && isShippable(gbe) && gbe.warnings.length >= 1,
  "Google static + no metrics → best-effort, shippable, warned");

// open foundry with a good license → shippable; with a bad license → unavailable
const fs = await admit("Cabinet Grotesk", {
  resolveGoogle: async () => ({ found: false }),
  resolveFoundry: async () => ({ found: true, family: "Cabinet Grotesk", cssUrl: "https://api.fontshare.com/x", variable: true, license: "Free for commercial use", category: "Sans Serif" }),
  deriveMetrics: async () => ({ metrics: { category: "sans-serif" }, woff2Url: "https://f/c.woff2" }),
});
ok(fs.parity === "guaranteed" && fs.source === "foundry" && fs.woff2Url === "https://f/c.woff2", "licensed foundry variable font → guaranteed (woff2 resolved via the CSS API)");

const fsBad = await admit("Locked Font", {
  resolveGoogle: async () => ({ found: false }),
  resolveFoundry: async () => ({ found: true, family: "Locked Font", cssUrl: "https://api.fontshare.com/x", variable: true, license: "Preview only" }),
});
ok(fsBad.parity === "unavailable" && !fsBad.shippable && /license/i.test(fsBad.reason),
  "foundry font with a non-self-hostable license is refused");

// nowhere → unavailable, and the gate NEVER throws
const gone = await admit("Totally Made Up Face", noNet);
ok(gone.parity === "unavailable" && !gone.shippable && gone.reason, "unknown font → unavailable (no throw)");

// a resolver that throws is soft-degraded, not fatal
const threw = await admit("Boom", { resolveGoogle: async () => { throw new Error("network down"); }, resolveFoundry: async () => ({ found: false }) });
ok(threw.parity === "unavailable", "a throwing resolver degrades to unavailable, never crashes");

// allowBestEffort:false downgrades best-effort to a refusal
const strict = await admit("Some Static Font", {
  resolveGoogle: async () => ({ found: true, family: "Some Static Font", css2: "x:wght@400", variable: false, category: "Display" }),
  deriveMetrics: async () => ({ metrics: null, woff2Url: "https://x/s.woff2" }),
  allowBestEffort: false,
});
ok(strict.parity === "unavailable" && /best-effort/i.test(strict.reason), "allowBestEffort:false refuses non-WYSIWYG");

// the verified cache: a vetted font is stored and re-served without re-resolving
const store = new Map();
let resolves = 0;
const withCache = {
  cache: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
  resolveGoogle: async () => { resolves++; return { found: true, family: "Cached Face", css2: "Cached+Face:wght@100..900", variable: true, category: "Sans Serif" }; },
  deriveMetrics: async () => ({ metrics: { category: "sans-serif" }, woff2Url: "https://x/c.woff2" }),
};
const first = await admit("Cached Face", withCache);
const second = await admit("Cached Face", withCache);
ok(first.parity === "guaranteed" && second.parity === "guaranteed" && resolves === 1,
  "admitted font is cached — the second admit hits the cache, not the network");

console.log(`\nadmit: ${pass} checks passed`);
