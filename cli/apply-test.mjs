// M2 verification — apply a real selection into the clean fixture and prove the four
// things that matter: it produces correct code, it BUILDS, it RENDERS the picked fonts,
// it is idempotent, and it is reversible. Leaves the fixture pristine when done.

import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applySelection, undo } from "./codegen.mjs";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const APP = fileURLToPath(new URL("../examples/clean-next-site/", import.meta.url));
const OUT = HERE + "out/";
mkdirSync(OUT, { recursive: true });

const FILES = { layout: APP + "app/layout.tsx", css: APP + "app/globals.css", page: APP + "app/page.tsx" };
const read = (p) => readFileSync(p, "utf8");
const originals = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const reset = () => {
  for (const [k, p] of Object.entries(FILES)) writeFileSync(p, originals[k]);
  rmSync(APP + ".font-lab", { recursive: true, force: true });
};

const selection = {
  version: 1,
  pickedAt: "2026-06-25T00:00:00.000Z",
  direction: { id: "editorial-serif", name: "Editorial", vibe: "editorial", rationale: "Warm serif headlines over a clean grotesque body." },
  roles: {
    display: { family: "Fraunces", source: "google", weights: [400, 700] },
    body: { family: "Libre Franklin", source: "google", weights: [400, 600] },
    mono: { family: "JetBrains Mono", source: "google", weights: [400, 700] },
  },
  replaces: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
  target: { framework: "next", router: "app", styling: "tailwind", tailwindVersion: 4, fontWiring: "css-variables" },
};
const writeSelection = () => {
  mkdirSync(APP + ".font-lab", { recursive: true });
  writeFileSync(APP + ".font-lab/selection.json", JSON.stringify(selection, null, 2));
};

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

try {
  // ---- Phase 1: apply + structural correctness --------------------------------
  reset();
  writeSelection();
  applySelection(APP);
  const layout = read(FILES.layout);
  const css = read(FILES.css);

  assert("imports Fraunces", /import\s*\{[^}]*\bFraunces\b/.test(layout));
  assert("imports Libre_Franklin", /\bLibre_Franklin\b/.test(layout));
  assert("imports JetBrains_Mono", /\bJetBrains_Mono\b/.test(layout));
  // Consts carry a DISTINCT family-named var; the role token maps to it in @theme (line below).
  assert("declares fontLabDisplay on --font-fraunces", /const fontLabDisplay = Fraunces\([^)]*--font-fraunces/.test(layout));
  assert("declares fontLabBody on --font-libre-franklin", /const fontLabBody = Libre_Franklin\([^)]*--font-libre-franklin/.test(layout));
  assert("declares fontLabMono on --font-jetbrains-mono", /const fontLabMono = JetBrains_Mono\([^)]*--font-jetbrains-mono/.test(layout));
  assert("removed the replaced Inter import", !/\bInter\b/.test(layout), "Inter still present");
  assert("removed the old `const inter`", !/const inter =/.test(layout));
  assert("html className has all 3 role variables", ["fontLabDisplay", "fontLabBody", "fontLabMono"].every((c) => layout.includes(`${c}.variable`)));
  assert("html className dropped old inter.variable", !/inter\.variable/.test(layout));
  assert("css has fenced @theme block", /\/\* font-lab:start \*\/[\s\S]*--font-display[\s\S]*\/\* font-lab:end \*\//.test(css));

  // ---- Phase 2: idempotency ---------------------------------------------------
  applySelection(APP);
  assert("layout.tsx unchanged on re-apply (idempotent)", read(FILES.layout) === layout);
  assert("globals.css unchanged on re-apply (idempotent)", read(FILES.css) === css);

  // ---- Phase 3: it BUILDS and RENDERS the picked fonts ------------------------
  let built = false;
  try {
    execFileSync("pnpm", ["build"], { cwd: APP, stdio: "pipe" });
    built = true;
  } catch (e) {
    console.log(String(e.stdout || e).slice(-800));
  }
  assert("project builds after apply", built);

  if (built) {
    const srv = spawn("pnpm", ["exec", "next", "start", "-p", "4342"], { cwd: APP, stdio: "ignore" });
    try {
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch("http://localhost:4342/")).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 });
      await page.goto("http://localhost:4342/", { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        return true;
      });
      await page.waitForTimeout(500);
      const h1 = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
      const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      const code = await page.evaluate(() => getComputedStyle(document.querySelector("pre")).fontFamily);
      await page.screenshot({ path: OUT + "clean-applied.png" });
      await browser.close();
      assert("h1 renders Fraunces", /Fraunces/i.test(h1), h1);
      assert("body renders Libre Franklin", /Libre[ _]Franklin/i.test(body), body);
      assert("code renders JetBrains Mono", /JetBrains[ _]Mono/i.test(code), code);
    } finally {
      srv.kill();
    }
  }

  // ---- Phase 4: reversibility (single apply -> undo == original) --------------
  reset();
  writeSelection();
  applySelection(APP);
  undo(APP);
  assert("undo restores layout.tsx byte-identical", read(FILES.layout) === originals.layout);
  assert("undo restores globals.css byte-identical", read(FILES.css) === originals.css);
} finally {
  reset(); // leave the fixture pristine
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "m2-report.json", JSON.stringify({ results }, null, 2));
console.log(`\nM2: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M2 PASS");
