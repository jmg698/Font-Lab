// Font Lab — the open-foundry registry (v2, E1).
//
// Distinctive faces that DON'T live on Google Fonts — the genuinely designed, free-to-self-host
// type that reads like a top-tier designer picked it (Cabinet Grotesk, General Sans, Clash
// Display, …). This is curated for TASTE, not exhaustive coverage: a small hand-picked bench of
// foundry faces the shippability gate can admit alongside the ~1,500 Google fonts.
//
// Source: the Indian Type Foundry's Fontshare. Their faces ship under the **ITF Free Font
// License** — free for personal AND commercial use, and self-hosting (bundling a single woff2 into
// the user's project) is permitted. We resolve the woff2 via Fontshare's CSS API (same shape as
// Google's css2), so the existing self-host + capsize-unpack path applies unchanged.
//
// Dependency-free (pure data + a couple of string helpers) so it loads and tests anywhere.
// NB: like the Google network edge, the live Fontshare fetch is verified by the deps+network
// harness, not here — see admit.mjs.

// The license string is worded to satisfy the gate's permissive-license check (admit.licenseOk).
export const FONTSHARE_LICENSE = "ITF Free Font License — free for personal and commercial use; self-hosting permitted";

// family → { slug (Fontshare), variable, category, roles, tags }. Curated; all self-hostable.
export const foundry = {
  "Cabinet Grotesk": { slug: "cabinet-grotesk", variable: true, category: "sans-serif", roles: ["display"], tags: ["grotesque", "distinctive", "editorial"] },
  "General Sans": { slug: "general-sans", variable: true, category: "sans-serif", roles: ["body", "display"], tags: ["grotesque", "clean", "versatile"] },
  "Satoshi": { slug: "satoshi", variable: true, category: "sans-serif", roles: ["body", "display"], tags: ["geometric", "modern", "versatile"] },
  "Switzer": { slug: "switzer", variable: true, category: "sans-serif", roles: ["body", "display"], tags: ["grotesque", "neutral", "versatile"] },
  "Clash Display": { slug: "clash-display", variable: true, category: "sans-serif", roles: ["display"], tags: ["display", "expressive", "bold"] },
  "Clash Grotesk": { slug: "clash-grotesk", variable: true, category: "sans-serif", roles: ["display", "body"], tags: ["grotesque", "distinctive"] },
  "Author": { slug: "author", variable: true, category: "serif", roles: ["body", "display"], tags: ["serif", "editorial", "readable"] },
  "Sentient": { slug: "sentient", variable: true, category: "serif", roles: ["display", "body"], tags: ["serif", "elegant", "editorial"] },
  "Gambetta": { slug: "gambetta", variable: true, category: "serif", roles: ["display", "body"], tags: ["serif", "contrast", "editorial"] },
  "Zodiak": { slug: "zodiak", variable: true, category: "serif", roles: ["display"], tags: ["serif", "contrast", "display"] },
  "Ranade": { slug: "ranade", variable: true, category: "sans-serif", roles: ["display", "body"], tags: ["grotesque", "quirky"] },
  "Melodrama": { slug: "melodrama", variable: true, category: "serif", roles: ["display"], tags: ["serif", "expressive", "display"] },
  "Supreme": { slug: "supreme", variable: true, category: "sans-serif", roles: ["body", "display"], tags: ["grotesque", "neutral"] },
  "Panchang": { slug: "panchang", variable: true, category: "sans-serif", roles: ["display"], tags: ["display", "geometric"] },
  "Bespoke Serif": { slug: "bespoke-serif", variable: true, category: "serif", roles: ["display", "body"], tags: ["serif", "editorial"] },
  "Hatton": { slug: "hatton", variable: false, category: "serif", roles: ["display"], tags: ["serif", "elegant", "contrast"] },
};

export const foundryFamilies = Object.keys(foundry);

const NORM = new Map(foundryFamilies.map((k) => [k.toLowerCase().replace(/\s+/g, " ").trim(), k]));

// Case-insensitive lookup → { family, slug, variable, category, roles, tags } or null.
export function foundryMatch(family) {
  const key = NORM.get(String(family || "").toLowerCase().replace(/\s+/g, " ").trim());
  return key ? { family: key, ...foundry[key] } : null;
}

// Fontshare's CSS API returns @font-face CSS whose woff2 src we parse (like Google css2), so the
// existing self-host + unpack path is reused. NB: it serves STATIC per-weight instances (not a
// single variable woff2), so we request a couple of weights and self-host the first (regular) — a
// best-effort, single-weight ship (see admit.resolveFoundryDefault). The `variable` field on each
// entry above documents the typeface's nature; it does NOT mean the CSS API hands us a variable file.
export function fontshareCssUrl(slug) {
  return `https://api.fontshare.com/v2/css?f[]=${slug}@400,700&display=swap`;
}
