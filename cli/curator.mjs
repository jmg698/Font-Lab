// Font Lab curator (M4) — turns `analysis + vibe` into ~5 concrete directions via a
// deterministic lookup over the catalog. **No runtime LLM**: the agent driving Font Lab is
// the LLM; this package stays dumb, instant, free, and reproducible (same inputs → same
// directions, every time). Each direction is a hand-authored pairing with a pre-written
// rationale; `curate()` selects among them.
//
// Selection rules (all deterministic):
//   • drop any direction that wouldn't change the current site (display+body == current),
//     so we always move *away* from the baseline;
//   • if a vibe is given, rank exact-vibe and tag matches first;
//   • otherwise return a fixed, diverse spread in authored order;
//   • always validate every referenced family is a catalog member (authoring guard).

import { get, catalog } from "./catalog.mjs";

const D = (id, name, vibe, rationale, display, body, mono, weights = {}) => ({
  id,
  name,
  vibe,
  rationale,
  roles: {
    display: { family: display, weights: weights.display || [400, 700] },
    body: { family: body, weights: weights.body || [400, 600] },
    mono: { family: mono, weights: weights.mono || [400, 700] },
  },
});

// The curated set — diverse across vibe, each a real pairing of catalog fonts.
export const directions = [
  D("editorial-serif", "Editorial", "editorial", "Warm high-contrast serif headlines over a clean grotesque body.", "Fraunces", "Libre Franklin", "JetBrains Mono"),
  D("modern-grotesque", "Modern Grotesque", "technical", "A characterful display grotesque over a quiet geometric body.", "Bricolage Grotesque", "Figtree", "JetBrains Mono"),
  D("clean-geometric", "Clean Geometric", "minimal", "One geometric family throughout — calm, precise, contemporary.", "Geist", "Geist", "Geist Mono"),
  D("warm-humanist", "Warm Humanist", "warm", "Friendly humanist shapes, soft and highly readable end to end.", "Bricolage Grotesque", "Hanken Grotesk", "Spline Sans Mono"),
  D("classic-editorial", "Classic Editorial", "classic", "High-drama display serif over a steady text serif — magazine feel.", "Playfair Display", "Source Serif 4", "Roboto Mono"),
  D("technical", "Technical", "technical", "Engineered grotesque headings, a neutral geometric body, code-first mono.", "Space Grotesk", "Sora", "Fira Code"),
  D("elegant-contrast", "Elegant Contrast", "elegant", "Delicate high-contrast serif display against a plain grotesque body.", "Cormorant", "Work Sans", "JetBrains Mono"),
  D("expressive", "Expressive", "bold", "A loud, rounded display voice balanced by a minimal geometric body.", "Unbounded", "Manrope", "Geist Mono"),
  D("modern-serif", "Modern Serif", "editorial", "A contemporary text serif headline over a neutral UI sans.", "Newsreader", "Inter", "Geist Mono"),
  D("bold-editorial", "Bold Editorial", "bold", "An expressive editorial display over a crisp modern sans.", "Syne", "Albert Sans", "Spline Sans Mono"),
  D("friendly-rounded", "Friendly Rounded", "friendly", "Rounded, approachable display with a soft geometric body.", "Gabarito", "Plus Jakarta Sans", "Roboto Mono"),
  D("quiet-minimal", "Quiet Minimal", "minimal", "Understated geometric sans throughout — gets out of the way.", "Manrope", "Manrope", "Geist Mono"),
];

// Validate authoring once at import: every referenced family must be a catalog member.
for (const d of directions) for (const r of ["display", "body", "mono"]) get(d.roles[r].family);

const norm = (s) => (s || "").toLowerCase().trim();

function scoreForVibe(d, vibe) {
  const v = norm(vibe);
  if (!v) return 0;
  if (norm(d.vibe) === v) return 3;
  // tag match across the direction's fonts
  const tags = new Set(["display", "body", "mono"].flatMap((r) => catalog[d.roles[r].family].tags));
  return tags.has(v) ? 1 : 0;
}

/**
 * Deterministically pick ~`count` directions for a project.
 * @param analysis  output of analyzeProject (or null) — used to skip no-op directions.
 * @param opts      { vibe?: string, count?: number }
 */
export function curate(analysis, opts = {}) {
  const count = opts.count ?? 5;
  const cur = analysis?.replaces || {};
  const isNoop = (d) => norm(d.roles.display.family) === norm(cur.display) && norm(d.roles.body.family) === norm(cur.body);

  const pool = directions.filter((d) => !isNoop(d));
  // stable sort by vibe score (desc), preserving authored order for ties.
  const ranked = pool
    .map((d, i) => ({ d, i, s: scoreForVibe(d, opts.vibe) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.d);

  const picked = ranked.slice(0, count);
  return picked.map((d) => ({ ...d, rationale: rationaleFor(d, cur) }));
}

// Make the rationale concrete about what it replaces, when we know the current fonts.
function rationaleFor(d, cur) {
  if (cur.display && norm(cur.display) !== norm(d.roles.display.family)) {
    return `${d.rationale} (replaces ${cur.display}${cur.body && cur.body !== cur.display ? " / " + cur.body : ""}.)`;
  }
  return d.rationale;
}

// Unique catalog families needed to render a set of directions (for self-hosting).
export function fontsForDirections(dirs) {
  const set = new Set();
  for (const d of dirs) for (const r of ["display", "body", "mono"]) set.add(d.roles[r].family);
  return [...set];
}
