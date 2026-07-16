// Project design-context gatherer (B2) — dependency-free checks on the pure extractors and the
// end-to-end gather over a temp fixture. Runs anywhere:
//   node cli/context-test.mjs
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractColors, pickDesignDocs, sampleCopy, gatherContext } from "./context.mjs";

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

// extractColors — named tokens across the modern color value forms
const css = `:root{--bg:#faf8f5;--accent: oklch(0.7 0.15 30);--text:#1a1a1a;}
@theme{--color-brand: hsl(220 90% 56%);}
.x{ color: #999; } /* unnamed literal — ignored */`;
const colors = extractColors(css);
ok(colors.length === 4, "extractColors finds the 4 named color tokens");
ok(colors.some((c) => c.name === "--accent" && /oklch/.test(c.value)) && colors.some((c) => c.name === "--bg" && c.value === "#faf8f5"),
  "captures both oklch and hex named tokens with their values");
ok(extractColors("").length === 0 && extractColors(".x{color:#fff}").length === 0, "no named tokens → empty");

// pickDesignDocs — case-insensitive, only the design docs
ok(pickDesignDocs(["readme.md", "DESIGN.md", "package.json", "Brand.md"]).map((s) => s.toLowerCase()).sort().join(",") === "brand.md,design.md",
  "pickDesignDocs detects DESIGN.md + BRAND.md, ignores others");
ok(pickDesignDocs(["README.md"]).length === 0, "no design docs → empty");

// sampleCopy — visible copy, not expressions
const tsx = `export default function P(){return(<main><h1>Building things I find interesting</h1><p>{dynamic}</p><p>A study tool that reads your handwriting</p><span>OK</span></main>)}`;
const copy = sampleCopy(tsx);
ok(copy.includes("Building things I find interesting") && copy.some((c) => /study tool/.test(c)), "sampleCopy pulls real headline + body copy");
ok(!copy.includes("OK") && !copy.some((c) => /dynamic/.test(c)), "skips too-short text and JSX expressions");

// gatherContext — end-to-end over a temp fixture
const TMP = mkdtempSync(path.join(os.tmpdir(), "fl-ctx-"));
try {
  mkdirSync(path.join(TMP, "app"), { recursive: true });
  writeFileSync(path.join(TMP, "app/globals.css"), ":root{--bg:#faf8f5;--accent:oklch(0.7 0.15 30)}");
  writeFileSync(path.join(TMP, "app/page.tsx"), tsx);
  writeFileSync(path.join(TMP, "DESIGN.md"), "# Brand\nWarm, editorial, a little playful.");
  const ctx = gatherContext(TMP);
  ok(ctx.colors.length === 2 && ctx.designDocs.length === 1 && ctx.designDocs[0].file === "DESIGN.md" && /editorial/.test(ctx.designDocs[0].excerpt),
    "gatherContext returns colors + the DESIGN.md excerpt");
  ok(ctx.copySample.includes("Building things I find interesting") && /tailor/i.test(ctx.note),
    "gatherContext returns a copy sample + a tailoring instruction");
  ok(gatherContext(path.join(TMP, "does-not-exist")).colors.length === 0, "missing project → empty signals, never throws");
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

// gatherContext on a VITE-shaped project — copy + colors come from Vite conventions, not app/.
// (Next-only candidates here previously meant a Vite site's specimen sheet fell back to stock
// copy while its own words sat in src/App.tsx.)
const VITE = mkdtempSync(path.join(os.tmpdir(), "fl-ctx-vite-"));
try {
  mkdirSync(path.join(VITE, "src"), { recursive: true });
  writeFileSync(path.join(VITE, "src/index.css"), ":root{--brand:#ff3b30;--bg:#0b0b0b}");
  writeFileSync(
    path.join(VITE, "src/App.tsx"),
    `export default function App(){return(<main><h1>Driven by curiosity, grounded in human experience</h1><p>A study tool that reads your handwriting</p></main>)}`,
  );
  writeFileSync(path.join(VITE, "index.html"), `<!doctype html><html><head><title>x</title></head><body><h2>Made with patience and strong coffee</h2></body></html>`);
  const vctx = gatherContext(VITE);
  ok(vctx.copySample.some((l) => /Driven by curiosity/.test(l)), "Vite: copy sampled from src/App.tsx");
  ok(vctx.copySample.some((l) => /strong coffee/.test(l)), "Vite: index.html copy merged in (until the cap)");
  ok(vctx.colors.some((c) => c.name === "--brand"), "Vite: colors read from src/index.css");
} finally {
  rmSync(VITE, { recursive: true, force: true });
}

console.log(`\ncontext: ${pass} checks passed`);
