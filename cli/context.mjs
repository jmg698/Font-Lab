// Font Lab — project design-context gatherer (v2, B2).
//
// The most TAILORED font options come from the project itself, not a font list. This reads a few
// cheap, high-signal things from the user's repo — the existing color palette, any brand/design
// docs, and a sample of the actual page copy — and hands them to the agent (via font_lab_start) so
// it composes type that fits THIS project's visual language and voice, instead of a generic default.
//
// The code only EXTRACTS signals; the agent interprets them. Dependency-free (node:fs + regex), so
// it stays out of the heavy build path and is unit-tested directly (context-test.mjs).

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

// One regex for the color value forms a modern Tailwind/Next app uses.
const COLOR = "#[0-9a-fA-F]{3,8}|(?:oklch|oklab|lab|lch|rgb|rgba|hsl|hsla)\\([^)]*\\)";

// Named color tokens (CSS custom properties / Tailwind v4 @theme) → the meaningful palette. We
// surface the *named* tokens rather than every literal, so the agent sees "--accent: oklch(...)".
export function extractColors(css) {
  if (!css) return [];
  const out = [];
  const seen = new Set();
  const re = new RegExp(`--([\\w-]+)\\s*:\\s*(${COLOR})`, "g");
  let m;
  while ((m = re.exec(css)) && out.length < 24) {
    const name = "--" + m[1];
    const value = m[2].trim();
    const key = name + "|" + value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ name, value });
    }
  }
  return out;
}

const DOC_NAMES = ["DESIGN.md", "BRAND.md", "BRANDING.md", "STYLE.md", "STYLEGUIDE.md", "STYLE-GUIDE.md", "DESIGN-SYSTEM.md"];

// Which brand/design docs exist in a directory listing (case-insensitive).
export function pickDesignDocs(fileNames = []) {
  const set = new Set(fileNames.map((f) => String(f).toLowerCase()));
  return DOC_NAMES.filter((d) => set.has(d.toLowerCase()));
}

// A few representative lines of *visible* copy from a page/component, to convey the voice (playful
// vs. serious, editorial vs. technical). Grabs capitalized text between JSX tags; skips expressions.
export function sampleCopy(tsx, limit = 6) {
  if (!tsx) return [];
  const out = [];
  const seen = new Set();
  const re = />\s*([A-Z][^<>{}\n]{5,90}?)\s*</g;
  let m;
  while ((m = re.exec(tsx)) && out.length < limit) {
    const t = m[1].trim().replace(/\s+/g, " ");
    if (t && !seen.has(t) && /[a-z]/.test(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function appDir(dir) {
  for (const d of ["app", "src/app"]) if (existsSync(path.join(dir, d))) return path.join(dir, d);
  return dir;
}

// Turn the project's own context into fallback-curation inputs: a stable per-project SEED (so the
// deterministic fallback menu differs from project to project instead of being identical
// everywhere) and a few SOFT vibe hints (so the spread leans toward the project's voice — editorial
// copy nudges serifs, technical copy nudges engineered grotesques, a rich brand palette allows more
// expressive display). Pure: pass a project name + gatherContext()'s output. The hints only tilt;
// the seed is what guarantees differentiation even when a project gives no signal at all.
export function deriveSignals(name, context = {}) {
  const colors = context.colors || [];
  const copy = context.copySample || [];
  const docs = (context.designDocs || []).map((d) => d.excerpt || "").join(" ");

  // The seed folds in the things that actually distinguish one project from another.
  const seed = [name || "", ...colors.map((c) => `${c.name}:${c.value}`), ...copy].join("|");

  const text = (copy.join(" ") + " " + docs).toLowerCase();
  const hints = [];
  const bump = (tag, weight = 1) => hints.push({ tag, weight });
  if (/\b(story|stories|essay|read|article|journal|editorial|magazine|writ|prose|publish|report)\b/.test(text)) bump("editorial", 2);
  if (/\b(api|sdk|cli|code|deploy|docs|developer|engineer|infra|latency|build|ship|runtime|data)\b/.test(text)) bump("technical", 2);
  if (/\b(care|human|warm|community|people|together|friendly|welcome|help|support)\b/.test(text)) bump("warm", 1);
  if (/\b(luxury|elegant|refined|couture|atelier|premium|timeless|fashion|studio)\b/.test(text)) bump("elegant", 1);
  if (/\b(play|fun|bold|loud|vibrant|energy|launch|create|remix)\b/.test(text)) bump("bold", 1);
  // A visibly designed brand (many named color tokens) can carry a more expressive display.
  if (colors.length >= 8) bump("expressive", 1);

  return { seed, hints };
}

// Gather the project's design context for the brief. Everything is best-effort — missing files just
// yield empty signals; this never throws.
export function gatherContext(projectDir) {
  const dir = path.resolve(projectDir);
  const app = appDir(dir);

  const css =
    read(path.join(app, "globals.css")) ||
    read(path.join(dir, "app/globals.css")) ||
    read(path.join(dir, "src/app/globals.css")) ||
    // Vite / Astro / SvelteKit conventions — a non-Next project has palette signals too.
    read(path.join(dir, "src/index.css")) ||
    read(path.join(dir, "src/style.css")) ||
    read(path.join(dir, "src/styles.css")) ||
    read(path.join(dir, "src/app.css")) ||
    read(path.join(dir, "src/styles/global.css")) ||
    read(path.join(dir, "src/styles/globals.css"));
  const tw = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"].map((f) => read(path.join(dir, f))).join("\n");
  const colors = extractColors(css + "\n" + tw);

  let rootFiles = [];
  try {
    rootFiles = readdirSync(dir);
  } catch {}
  const designDocs = pickDesignDocs(rootFiles).map((n) => ({ file: n, excerpt: read(path.join(dir, n)).slice(0, 600).trim() }));

  // The files most likely to carry the site's visible copy, across framework conventions —
  // Next's app-router page, then Vite/CRA App components, Astro/Svelte index pages, then a plain
  // index.html (sampleCopy's `>text<` regex reads HTML as happily as JSX). Sampled in order
  // until we have enough lines. Next-only candidates here previously meant a Vite site's
  // specimen sheet silently fell back to stock copy — its own words were sitting in src/App.tsx.
  const COPY_CANDIDATES = [
    path.join(app, "page.tsx"),
    path.join(app, "page.jsx"),
    path.join(dir, "src/App.tsx"),
    path.join(dir, "src/App.jsx"),
    path.join(dir, "src/App.vue"),
    path.join(dir, "src/App.svelte"),
    path.join(dir, "src/pages/index.astro"),
    path.join(dir, "src/routes/+page.svelte"),
    path.join(dir, "index.html"),
  ];
  const copySample = [];
  for (const cand of COPY_CANDIDATES) {
    if (copySample.length >= 6) break;
    for (const line of sampleCopy(read(cand))) {
      if (copySample.length >= 6) break;
      if (!copySample.includes(line)) copySample.push(line);
    }
  }

  return {
    colors,
    designDocs,
    copySample,
    note:
      "Tailor the font directions to THIS project: match or complement the existing palette, honor any brand/design docs, and fit the voice of the copy. Don't propose type that fights the project's current visual language.",
  };
}
