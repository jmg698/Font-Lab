// Font Lab curator (M4 → v2) — turns `analysis + project signals` into ~5 concrete directions
// via a deterministic lookup over the catalog. **No runtime LLM**: the agent driving Font Lab is
// the LLM; this package stays dumb, instant, free, and reproducible. But "reproducible" used to
// mean *identical for every project* — the same five pairings, in the same order, everywhere —
// which is the sameness the fallback menu became infamous for. So v2 keeps determinism but makes
// it **per-project**: a stable seed derived from the project (name + palette + copy) rotates a
// larger, archetype-bucketed pool, so two different projects get two different — but each still
// diverse and non-generic — spreads. Same project in → same directions out; different project in
// → a different lead and different members.
//
// Selection rules (all deterministic, given the seed):
//   • drop any direction that wouldn't change the current site (display+body == current);
//   • score each direction by the vibe (if given) and the project's soft signals;
//   • bucket by ARCHETYPE (serif-editorial, grotesque, expressive, humanist, technical, …) and
//     take a round-robin spread across buckets, so the menu is never five of the same shape;
//   • within a bucket and across buckets, break ties by a seed-rotated hash → different projects
//     lead with different archetypes and different members;
//   • the ONE deliberately-generic "maximum neutrality" pairing (Geist) carries a negative bias
//     so it only surfaces when neutrality is actually asked for — it's quarantined, not deleted;
//   • always validate every referenced family is a catalog member (authoring guard).

import { get, catalog } from "./catalog.mjs";

const ROLES = ["display", "body", "mono"];

// arch = the typographic archetype this pairing belongs to (drives the diverse spread).
// bias = a base score nudge; the one neutral/generic option sits at -1 so it doesn't lead.
const D = (id, name, arch, vibe, rationale, display, body, mono, { weights = {}, bias = 0 } = {}) => ({
  id,
  name,
  arch,
  vibe,
  bias,
  rationale,
  roles: {
    display: { family: display, weights: weights.display || [400, 700] },
    body: { family: body, weights: weights.body || [400, 600] },
    mono: { family: mono, weights: weights.mono || [400, 700] },
  },
});

const MONO = "Spline Sans Mono"; // the one non-overexposed mono in the catalog — the distinctive default

// The curated pool — deliberately broad and bucketed by archetype. Every family is a real catalog
// member, and no pairing is an overexposed default in both roles EXCEPT the single quarantined
// `clean-geometric` neutral option (kept so a "maximum neutrality" brief — and the no-op filter —
// still have something to resolve to).
export const directions = [
  // ── editorial serif: a serif display that carries a voice, over a clean body ──
  D("editorial-serif", "Editorial", "serif-editorial", "editorial", "Warm high-contrast serif headlines over a clean grotesque body.", "Fraunces", "Hanken Grotesk", MONO),
  D("modern-serif", "Modern Serif", "serif-editorial", "editorial", "A contemporary text serif headline over a neutral, readable body.", "Newsreader", "Public Sans", MONO),
  D("text-serif", "Text Serif", "serif-editorial", "classic", "One steady serif voice for headings, a humanist sans for body — magazine calm.", "Source Serif 4", "Source Sans 3", MONO),

  // ── elegant contrast: delicate high-contrast display serifs ──────────────────
  D("elegant-contrast", "Elegant Contrast", "elegant-contrast", "elegant", "Delicate high-contrast serif display against a plain grotesque body.", "Cormorant", "Libre Franklin", MONO),
  D("refined-serif", "Refined", "elegant-contrast", "classic", "A refined old-style serif display over a quiet modern sans.", "Crimson Pro", "Instrument Sans", MONO),

  // ── characterful grotesque: display grotesques with actual character ─────────
  D("modern-grotesque", "Modern Grotesque", "grotesque", "modern", "A characterful display grotesque over a quiet, readable body.", "Bricolage Grotesque", "Hanken Grotesk", MONO),
  D("clean-grotesque", "Clean Grotesque", "grotesque", "modern", "A crisp modern grotesque display over a neutral body — modern, not template.", "Familjen Grotesk", "Public Sans", MONO),
  D("engineered-grotesque", "Engineered", "grotesque", "technical", "A wide, engineered grotesque display over a humanist body.", "Archivo", "Source Sans 3", MONO),

  // ── expressive display: loud, opinionated faces for a hero / wordmark ────────
  D("bold-editorial", "Bold Editorial", "expressive", "bold", "An expressive editorial display over a crisp modern sans.", "Syne", "Albert Sans", MONO),
  D("expressive", "Expressive", "expressive", "bold", "A loud, rounded display voice balanced by a neutral body.", "Unbounded", "Onest", MONO),
  D("friendly-rounded", "Friendly Rounded", "expressive", "friendly", "Rounded, approachable display with a plain, readable body.", "Gabarito", "Public Sans", MONO),
  D("dramatic-display", "Dramatic", "expressive", "expressive", "A tall, dramatic display face over a steady grotesque body.", "Darker Grotesque", "Libre Franklin", MONO),

  // ── warm humanist: friendly shapes, soft and highly readable end to end ──────
  D("warm-humanist", "Warm Humanist", "humanist", "warm", "Friendly humanist shapes, soft and highly readable end to end.", "Hanken Grotesk", "Hanken Grotesk", MONO),
  D("friendly-humanist", "Friendly Humanist", "humanist", "friendly", "An open, friendly sans for headings over a calm humanist body.", "Albert Sans", "Source Sans 3", MONO),

  // ── technical: engineered headings, neutral body, code-adjacent feel ─────────
  D("technical", "Technical", "technical", "technical", "Engineered grotesque headings over a neutral, precise body.", "Mona Sans", "Instrument Sans", MONO),
  D("technical-poise", "Technical Poise", "technical", "technical", "A geometric technical display over a plain, dependable body.", "Red Hat Display", "Public Sans", MONO),
  D("system-technical", "System", "technical", "technical", "A tight grotesque display over a modern grotesque body — product-precise.", "Archivo", "Mona Sans", MONO),

  // ── geometric minimal: understated geometrics that get out of the way ────────
  D("quiet-minimal", "Quiet Minimal", "geometric-minimal", "minimal", "An understated geometric sans throughout — gets out of the way.", "Onest", "Onest", MONO),
  D("minimal-epilogue", "Minimal", "geometric-minimal", "minimal", "A single quiet geometric family, calm and contemporary.", "Epilogue", "Epilogue", MONO),
  D("modern-neutral", "Modern Neutral", "geometric-minimal", "modern", "A neutral modern grotesque throughout — clean and unfussy.", "Instrument Sans", "Instrument Sans", MONO),

  // ── neutral: the ONE quarantined maximum-neutrality option (biased to sit last) ─
  D("clean-geometric", "Clean Geometric", "neutral", "neutral", "One geometric family throughout — calm, precise, contemporary. The neutral default; ask for it by name.", "Geist", "Geist", "Geist Mono", { bias: -1 }),
];

// Validate authoring once at import: every referenced family must be a catalog member.
for (const d of directions) for (const r of ROLES) get(d.roles[r].family);

const norm = (s) => (s || "").toLowerCase().trim();

// FNV-1a — a tiny, dependency-free, stable string hash so the seed picks are reproducible across
// processes (the panel build and a later headless select must agree on the same fallback set).
function hashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const mix = (s, seed) => hashStr(`${s}#${seed}`);

function scoreForVibe(d, vibe) {
  const v = norm(vibe);
  if (!v) return 0;
  if (norm(d.vibe) === v) return 3;
  // tag match across the direction's fonts
  const tags = new Set(ROLES.flatMap((r) => catalog[d.roles[r].family].tags));
  return tags.has(v) ? 1 : 0;
}

// Soft, project-derived leanings (from context.deriveSignals): each hit nudges, never forces.
function scoreForSignals(d, signals) {
  if (!Array.isArray(signals) || !signals.length) return 0;
  const tags = new Set([norm(d.vibe), ...ROLES.flatMap((r) => catalog[d.roles[r].family].tags)]);
  let s = 0;
  for (const sig of signals) if (sig && tags.has(norm(sig.tag))) s += sig.weight || 1;
  return s;
}

/**
 * Deterministically pick ~`count` directions for a project.
 * @param analysis  output of analyzeProject (or null) — used to skip no-op directions.
 * @param opts      { vibe?: string, count?: number, seed?: string, signals?: {tag,weight}[] }
 *                  seed varies the spread per project; signals lean it toward the project's voice.
 */
export function curate(analysis, opts = {}) {
  const count = opts.count ?? 5;
  const seed = String(opts.seed ?? "");
  const cur = analysis?.replaces || {};
  const isNoop = (d) => norm(d.roles.display.family) === norm(cur.display) && norm(d.roles.body.family) === norm(cur.body);

  const pool = directions.filter((d) => !isNoop(d));
  const score = (d) => scoreForVibe(d, opts.vibe) + scoreForSignals(d, opts.signals) + (d.bias || 0);

  // bucket by archetype; order each bucket by score desc, then a seed-rotated hash (so the member
  // that represents an archetype varies per project even when scores tie).
  const buckets = new Map();
  for (const d of pool) {
    if (!buckets.has(d.arch)) buckets.set(d.arch, []);
    buckets.get(d.arch).push(d);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => score(b) - score(a) || mix(a.id, seed) - mix(b.id, seed));
  }

  // visit archetypes by their best member's score, then seed-rotated → different projects lead
  // with a different archetype; a diverse round-robin then takes one per bucket before doubling up.
  const archs = [...buckets.keys()].sort(
    (a, b) => score(buckets.get(b)[0]) - score(buckets.get(a)[0]) || mix(a, seed) - mix(b, seed),
  );

  const picked = [];
  for (let round = 0; picked.length < count && round < directions.length; round++) {
    for (const a of archs) {
      const d = buckets.get(a)[round];
      if (d && picked.length < count) picked.push(d);
    }
  }
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
  for (const d of dirs) for (const r of ROLES) set.add(d.roles[r].family);
  return [...set];
}
