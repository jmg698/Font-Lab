// M1 walking skeleton — the two hardcoded directions (the "curated set"), the current
// fonts they replace, and the ship target. In later milestones the catalog/curator
// (M4) produce these and the analyzer (M3) detects `target`/`replaces`; for now they are
// hand-authored so the whole loop can run end to end.

export const target = {
  framework: "next",
  router: "app",
  styling: "tailwind",
  tailwindVersion: 4,
  fontWiring: "css-variables",
};

// What the fixture currently ships (the slop baseline the directions move away from).
export const replaces = { display: "Inter", body: "Inter", mono: "JetBrains Mono" };

// How to self-host each family from Google (css2 query) and how to measure it (capsize
// slug, for next/font-identical adjusted fallbacks). Every family here has capsize
// coverage — a hard requirement for parity.
export const fonts = {
  Fraunces: { capsize: "fraunces", css2: "Fraunces:opsz,wght@9..144,400..700" },
  "Libre Franklin": { capsize: "libreFranklin", css2: "Libre+Franklin:wght@400..600" },
  "Bricolage Grotesque": { capsize: "bricolageGrotesque", css2: "Bricolage+Grotesque:opsz,wght@12..96,400..700" },
  Figtree: { capsize: "figtree", css2: "Figtree:wght@300..700" },
  "JetBrains Mono": { capsize: "jetBrainsMono", css2: "JetBrains+Mono:wght@400..700" },
};

export const directions = [
  {
    id: "editorial-serif",
    name: "Editorial",
    vibe: "editorial",
    rationale: "Warm high-contrast serif headlines over a clean grotesque body.",
    roles: {
      display: { family: "Fraunces", weights: [400, 700] },
      body: { family: "Libre Franklin", weights: [400, 600] },
      mono: { family: "JetBrains Mono", weights: [400, 700] },
    },
  },
  {
    id: "modern-grotesque",
    name: "Modern Grotesque",
    vibe: "technical",
    rationale: "A characterful display grotesque over a quiet geometric body.",
    roles: {
      display: { family: "Bricolage Grotesque", weights: [400, 700] },
      body: { family: "Figtree", weights: [400, 600] },
      mono: { family: "JetBrains Mono", weights: [400, 700] },
    },
  },
];
