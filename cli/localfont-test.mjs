// next/font/local ship path — verify the trust gate and the localfont mode end to end,
// offline, against the clean fixture: a foundry face (admitted, self-hosted woff2) must ship
// via next/font/local; Google faces keep the next/font/google path; an unverifiable family
// must REFUSE at apply time (never "apply exits 0, next build fails"); reversible; idempotent.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applySelection, undo } from "./codegen.mjs";

const FIXTURE = fileURLToPath(new URL("../examples/clean-next-site/", import.meta.url));
const APP = fileURLToPath(new URL("./out/localfont-fixture/", import.meta.url));

const reset = () => {
  rmSync(APP, { recursive: true, force: true });
  mkdirSync(APP, { recursive: true });
  for (const f of ["app", "public", "package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) {
    const src = path.join(FIXTURE, f);
    if (existsSync(src)) cpSync(src, path.join(APP, f), { recursive: true });
  }
};

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

const seed = () => {
  mkdirSync(APP + ".font-lab", { recursive: true });
  // Admitted foundry verdict (what check_fonts caches for Cabinet Grotesk) — no css2, only a
  // woff2. The staged parity file below stands in for the preview build's download, so the
  // test runs fully offline.
  writeFileSync(
    APP + ".font-lab/admitted.json",
    JSON.stringify({
      "cabinet grotesk": {
        family: "Cabinet Grotesk",
        shippable: true,
        parity: "best-effort",
        source: "foundry",
        css2: null,
        woff2Url: "https://cdn.fontshare.com/fake/cabinet-grotesk.woff2",
        category: "sans-serif",
        variable: false,
        license: "ITF Free Font License — free for personal and commercial use; self-hosting permitted",
        warnings: [],
        reason: null,
      },
    }),
  );
  mkdirSync(APP + "public/fontlab", { recursive: true });
  writeFileSync(APP + "public/fontlab/cabinet-grotesk.woff2", Buffer.from("wOFF2-fake-bytes-for-test"));
  writeFileSync(
    APP + ".font-lab/selection.json",
    JSON.stringify({
      version: 1,
      pickedAt: "2026-07-02T00:00:00.000Z",
      direction: { id: "technical-poise", name: "Technical Poise", vibe: "technical" },
      roles: {
        display: { family: "Cabinet Grotesk", source: "foundry", weights: [400, 700] },
        body: { family: "Libre Franklin", source: "google", weights: [400, 600] },
        mono: { family: "JetBrains Mono", source: "google", weights: [400, 700] },
      },
    }),
  );
};

try {
  // ---- Phase 1: foundry face ships via next/font/local ------------------------
  reset();
  seed();
  const r1 = await applySelection(APP);
  const layout = readFileSync(APP + "app/layout.tsx", "utf8");
  const css = readFileSync(APP + "app/globals.css", "utf8");

  assert("localFont default import present", /import localFont from ["']next\/font\/local["']/.test(layout));
  assert("Cabinet Grotesk NOT in next/font/google import", !/import\s*\{[^}]*Cabinet_Grotesk[^}]*\}\s*from\s*["']next\/font\/google["']/.test(layout));
  assert("google roles still on next/font/google", /\bLibre_Franklin\b/.test(layout) && /\bJetBrains_Mono\b/.test(layout));
  assert(
    "display const is localFont with src",
    /const fontLabDisplay = localFont\(\{ src: \[\{ path: "\.\/fonts\/fontlab-cabinet-grotesk\.woff2", weight: "100 900", style: "normal" \}\]/.test(layout),
  );
  assert("woff2 copied into app/fonts/", existsSync(APP + "app/fonts/fontlab-cabinet-grotesk.woff2"));
  assert("@theme maps display role", /--font-display: var\(--font-cabinet-grotesk\);/.test(css));
  assert("className carries fontLabDisplay.variable", /fontLabDisplay\.variable/.test(layout));
  assert("result reports localfont mode", r1.roles.find((r) => r.role === "display")?.mode === "localfont");
  assert("result lists self-hosted file", (r1.selfHosted || []).some((f) => f.includes("fontlab-cabinet-grotesk.woff2")));

  // ---- Phase 2: undo (single apply) restores byte-for-byte ---------------------
  const orig = readFileSync(FIXTURE + "app/layout.tsx", "utf8");
  undo(APP);
  assert("undo restores original layout", readFileSync(APP + "app/layout.tsx", "utf8") === orig);

  // ---- Phase 3: idempotent re-apply ---------------------------------------------
  const r2 = await applySelection(APP);
  const before = readFileSync(APP + "app/layout.tsx", "utf8");
  await applySelection(APP);
  assert("re-apply is byte-idempotent", readFileSync(APP + "app/layout.tsx", "utf8") === before && !!r2.runId);

  // ---- Phase 4: unknown family refuses (the old silent build-break) ------------
  reset();
  seed();
  const sel = JSON.parse(readFileSync(APP + ".font-lab/selection.json", "utf8"));
  sel.roles.display.family = "Definitely Not A Real Font 981274";
  writeFileSync(APP + ".font-lab/selection.json", JSON.stringify(sel));
  let refused = null;
  try {
    await applySelection(APP);
  } catch (e) {
    refused = e.message;
  }
  assert("unverifiable family refused at apply time", !!refused, "apply succeeded (would have broken next build)");
  assert(
    "refusal is actionable",
    !!refused && (/check_fonts/.test(refused) || /can't ship/.test(refused) || /couldn't verify/.test(refused)),
    refused || "",
  );
  assert("layout untouched after refusal", readFileSync(APP + "app/layout.tsx", "utf8") === orig);
} finally {
  rmSync(APP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
