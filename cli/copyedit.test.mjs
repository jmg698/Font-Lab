// Unit coverage for the copy-edit write-back's field-robustness seams. The engine's core
// (resolve/apply/undo/refuse) is proven headlessly in spike/text-edit/edit-codegen.test.mjs;
// this file guards the parts that vary by the target repo we're injected into — chiefly the
// source-map path shapes different bundlers emit. Run: node copyedit.test.mjs

import { normalizeSourcePath } from "./copyedit.mjs";

let pass = 0, fail = 0;
const eq = (name, got, want) =>
  got === want ? (pass++, console.log(`  ✓ ${name}`))
               : (fail++, console.log(`  ✗ ${name}\n      got:  ${got}\n      want: ${want}`));

console.log("\nnormalizeSourcePath — source-map URL shapes seen across bundlers\n");

// The reported bug: a space in the project folder arrives percent-encoded, so existsSync()
// missed the file and every edit reverted.
eq("Turbopack project-relative", normalizeSourcePath("[project]/src/app/page.tsx"), "src/app/page.tsx");
eq("percent-encoded space decodes (the reported bug)", normalizeSourcePath("[project]/Artificial%20Insight/src/app/page.tsx"), "Artificial Insight/src/app/page.tsx");
eq("percent-encoded non-ASCII decodes", normalizeSourcePath("[project]/caf%C3%A9/app/page.tsx"), "café/app/page.tsx");

// Other bundlers Font Lab may be injected alongside.
eq("file:// absolute (with encoded space)", normalizeSourcePath("file:///Users/jack/My%20Site/app/page.tsx"), "/Users/jack/My Site/app/page.tsx");
eq("webpack:// (Next/CRA dev)", normalizeSourcePath("webpack://_N_E/./app/page.tsx"), "app/page.tsx");
eq("webpack-internal:// with runtime tag", normalizeSourcePath("webpack-internal:///(app-pages-browser)/./app/page.tsx"), "app/page.tsx");
eq("turbopack:// protocol form", normalizeSourcePath("turbopack://[project]/app/page.tsx"), "app/page.tsx");
eq("Vite /@fs absolute", normalizeSourcePath("/@fs/Users/jack/site/src/App.tsx"), "/Users/jack/site/src/App.tsx");
eq("leading ./ collapses", normalizeSourcePath("./src/app/page.tsx"), "src/app/page.tsx");

// Must NOT mangle an already-clean path — normalization has to be safe on the common case.
eq("clean absolute path untouched", normalizeSourcePath("/Users/jack/site/app/page.tsx"), "/Users/jack/site/app/page.tsx");
eq("clean relative path untouched", normalizeSourcePath("src/app/page.tsx"), "src/app/page.tsx");

console.log(`\n${fail ? "✗" : "✓"} copyedit: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
