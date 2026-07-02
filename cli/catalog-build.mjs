// generateCatalog — the reusable parity-bundle builder (M5 extraction of gen-catalog's core).
//
// Given a project dir and a set of directions (curated OR agent-composed — both validated
// against the catalog), it self-hosts each font's Google variable woff2, computes next/font's
// exact adjusted fallback (M0-proven parity), and writes the generated module the dev panel
// imports plus the woff2 into the project's public/fontlab/. Pure of policy — WHICH directions
// to build is the caller's choice (the curator default, or the agent's own composition).

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { get as catalogGet } from "./catalog.mjs";
import { fontsForDirections } from "./curator.mjs";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const pct = (n) => `${(Math.abs(n) * 100).toFixed(2)}%`;
const generic = (cat) => (cat === "serif" ? "serif" : cat === "monospace" ? "monospace" : "sans-serif");

const metricsFor = async (s) => (await import("@capsizecss/metrics/" + s)).default;

// For an admitted (non-catalog) font there's no precomputed capsize key — derive metrics from the
// actual woff2 via @capsizecss/unpack. If that fails, fall back to the generic's own metrics so the
// build still succeeds (exact CLS-safe parity not guaranteed; the gate already warned the human).
async function metricsFromUrl(url, spec) {
  if (url) {
    try {
      const { fromUrl } = await import("@capsizecss/unpack");
      return await fromUrl(url);
    } catch {}
  }
  const cat = spec?.category || "sans-serif";
  const fb = await metricsFor(cat === "serif" ? "timesNewRoman" : "arial");
  return { ...fb, category: cat === "serif" ? "serif" : cat === "monospace" ? "monospace" : "sans-serif" };
}

// next/font's adjusted-fallback descriptors for `main` measured against `fallback`.
function overrides(main, fallback) {
  const sizeAdjust = main.xWidthAvg / main.unitsPerEm / (fallback.xWidthAvg / fallback.unitsPerEm);
  return {
    sizeAdjust: pct(sizeAdjust),
    ascent: pct(main.ascent / (main.unitsPerEm * sizeAdjust)),
    descent: pct(main.descent / (main.unitsPerEm * sizeAdjust)),
    lineGap: pct(main.lineGap / (main.unitsPerEm * sizeAdjust)),
  };
}

/**
 * Self-host each family's variable woff2 + compute next/font's exact adjusted fallback, and
 * return the ready-to-inject CSS. This is the FRAMEWORK-AGNOSTIC core — plain `@font-face` +
 * font-family stacks keyed on nothing next/font-specific. Both the Next panel (via
 * generateCatalog) and the css-entry ship path (codegen) build on it.
 *
 * @param projectDir absolute path; woff2 are written under `<staticDir>/fontlab/`
 * @param families   family names (each a catalog member or an admitted spec via opts.specFor)
 * @param opts       { log?, fetch?, specFor?, staticDir? }  fetch:false skips network (tests);
 *                   staticDir defaults to "public" (SvelteKit passes "static")
 * @returns { faceCss: string[], stacks: Record<family,string>, fonts: string[] }
 */
export async function buildParityBundles(projectDir, families, opts = {}) {
  const log = opts.log || (() => {});
  const staticDir = opts.staticDir || "public";
  const PUBLIC = path.join(projectDir, staticDir, "fontlab") + path.sep;
  mkdirSync(PUBLIC, { recursive: true });

  const arial = await metricsFor("arial");
  const timesNewRoman = await metricsFor("timesNewRoman");
  const specFor = opts.specFor || catalogGet;

  const faceCss = [];
  const stacks = {};
  for (const family of families) {
    const spec = specFor(family); // catalog member (proven path) OR an admitted non-catalog spec

    let srcUrl = null;
    if (opts.fetch !== false) {
      if (spec.css2) {
        const css = execFileSync("curl", ["-sSL", "-A", UA, `https://fonts.googleapis.com/css2?family=${spec.css2}&display=swap`], { encoding: "utf8" });
        const m = css.match(/\/\* latin \*\/\s*@font-face\s*\{[^}]*?url\((https:[^)]+\.woff2)\)/) || css.match(/url\((https:[^)]+\.woff2)\)/);
        if (!m) throw new Error(`Could not find latin woff2 for "${family}"`);
        srcUrl = m[1];
      } else if (spec.woff2Url) {
        srcUrl = spec.woff2Url; // admitted foundry font — self-host its woff2 directly
      } else {
        throw new Error(`No font source (css2 or woff2Url) for "${family}"`);
      }
      execFileSync("curl", ["-sSL", "-A", UA, "-o", PUBLIC + slug(family) + ".woff2", srcUrl]);
    }

    const main = spec.capsize ? await metricsFor(spec.capsize) : await metricsFromUrl(srcUrl, spec);
    const isSerif = main.category === "serif";
    const fb = isSerif ? timesNewRoman : arial;
    const fbName = isSerif ? "Times New Roman" : "Arial";
    const o = overrides(main, fb);

    // src: a self-hosted path by default; a base64 data URI when inlining (a fully offline,
    // single-file preview). Inlining needs the fetched bytes — fall back to the path if absent.
    const woff2Path = PUBLIC + slug(family) + ".woff2";
    let src = `url('/fontlab/${slug(family)}.woff2') format('woff2')`;
    if (opts.inline && existsSync(woff2Path)) {
      src = `url('data:font/woff2;base64,${readFileSync(woff2Path).toString("base64")}') format('woff2')`;
    }
    faceCss.push(
      `@font-face{font-family:'FL ${family}';font-style:normal;font-weight:100 900;font-display:swap;src:${src};}`,
      `@font-face{font-family:'FL ${family} Fallback';src:local('${fbName}');size-adjust:${o.sizeAdjust};ascent-override:${o.ascent};descent-override:${o.descent};line-gap-override:${o.lineGap};}`,
    );
    stacks[family] = `'FL ${family}', 'FL ${family} Fallback', ${generic(main.category)}`;
    log(`  ${family.padEnd(20)} -> ${slug(family)}.woff2  (fallback ${fbName}, size-adjust ${o.sizeAdjust})`);
  }
  return { faceCss, stacks, fonts: families };
}

/**
 * Build the parity catalog for `directions` into `projectDir` (the Next dev-panel module).
 * @param projectDir  absolute path to the Next.js project (panel lives at app/_fontlab/)
 * @param directions  the directions to render (each role family MUST be a catalog member)
 * @param meta        { target, replaces } baked into the generated module (from the analyzer)
 * @param opts        { log?: (msg)=>void, fetch?: boolean }  fetch:false skips network (test)
 * @returns { fonts, directions, outPath }
 */
export async function generateCatalog(projectDir, directions, meta = {}, opts = {}) {
  const APP = projectDir.replace(/\/?$/, "/");
  const families = fontsForDirections(directions);
  const { faceCss, stacks } = await buildParityBundles(projectDir, families, opts);

  // Real per-family source + parity — the panel's honesty data. Catalog members are the
  // proven byte-identical path; admitted specs carry their verdict's source/parity through
  // (engine.mergedSpecFor adds them to the spec).
  const specFor = opts.specFor || catalogGet;
  const famInfo = (family) => {
    try {
      const spec = specFor(family);
      return { source: spec.source || "google", parity: spec.parity || "guaranteed" };
    } catch {
      return { source: "google", parity: "guaranteed" };
    }
  };

  const outDirections = directions.map((d) => ({
    id: d.id,
    name: d.name,
    vibe: d.vibe,
    rationale: d.rationale,
    roles: Object.fromEntries(
      Object.entries(d.roles).map(([role, r]) => [role, { family: r.family, ...famInfo(r.family), weights: r.weights, stack: stacks[r.family] }]),
    ),
  }));

  const ts = `// AUTO-GENERATED by cli/gen-catalog.mjs — do not edit by hand.
import type { CSSProperties } from "react";

export const catalogFontFaceCss = ${JSON.stringify("\n" + faceCss.join("\n") + "\n")};

export const target = ${JSON.stringify(meta.target ?? null, null, 2)} as const;
export const replaces = ${JSON.stringify(meta.replaces ?? null, null, 2)} as const;

// Per-role preview swap target (M5/M6): which leaf var to override and on which element. The
// portable panel reads this so the live swap is honest on any site. null = unswappable role.
export const wiring = ${JSON.stringify(meta.wiring ?? null, null, 2)} as const;

export type Role = "display" | "body" | "mono";
export type RoleFont = { family: string; source: string; parity: "guaranteed" | "best-effort"; weights: number[]; stack: string };
export type Direction = {
  id: string;
  name: string;
  vibe: string;
  rationale: string;
  roles: Record<Role, RoleFont>;
};

export const directions: Direction[] = ${JSON.stringify(outDirections, null, 2)};

// CSS-variable overrides a direction applies on :root (the swap mechanism, M0-proven).
export function directionVars(d: Direction): CSSProperties {
  return {
    "--fl-display": d.roles.display.stack,
    "--fl-sans": d.roles.body.stack,
    "--fl-mono": d.roles.mono.stack,
  } as CSSProperties;
}
`;

  const outPath = path.join(APP, "app/_fontlab/catalog.generated.ts");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, ts);
  return { fonts: families, directions: outDirections, outPath };
}
