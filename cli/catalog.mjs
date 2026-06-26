// Font Lab catalog (M4) — the parity asset, not a taste moat (see ARCHITECTURE.md).
//
// Each entry is a font we can ship with the WYSIWYG guarantee intact. Membership is gated on
// two hard requirements, both verified:
//   1. **Capsize coverage** — `@capsizecss/metrics/<capsize>` resolves, so we can compute
//      next/font's exact adjusted-fallback metrics (CLS-safe, identical to ship). Uncovered
//      fonts throw "Failed to find font override values" at build — a hard gate.
//   2. **Variable font** — a single latin woff2 spans the whole weight range, so preview and
//      ship use the *same bytes* with no per-weight files and no `weight` arg (which would
//      fork next/font off the variable file and break parity). The `css2` query below was
//      auto-discovered and confirmed to return a weight-RANGE latin face.
//
// `roles` = which slots a family is suited to (display / body / mono). `tags` = vibe lookup
// keys the curator selects on. Pure data; `cli/m4-test.mjs` re-verifies coverage for all.

export const catalog = {
  // ── sans — workhorse body / UI (some double as display) ──────────────────
  Inter: { capsize: "inter", css2: "Inter:wght@100..900", roles: ["body", "display"], tags: ["neutral", "ui", "modern"] },
  Geist: { capsize: "geist", css2: "Geist:wght@100..900", roles: ["body", "display"], tags: ["geometric", "minimal", "modern"] },
  Figtree: { capsize: "figtree", css2: "Figtree:wght@300..700", roles: ["body", "display"], tags: ["geometric", "friendly", "modern"] },
  "Hanken Grotesk": { capsize: "hankenGrotesk", css2: "Hanken+Grotesk:wght@100..900", roles: ["body", "display"], tags: ["humanist", "warm", "readable"] },
  "Libre Franklin": { capsize: "libreFranklin", css2: "Libre+Franklin:wght@100..900", roles: ["body"], tags: ["grotesque", "classic", "readable"] },
  "Work Sans": { capsize: "workSans", css2: "Work+Sans:wght@100..900", roles: ["body", "display"], tags: ["grotesque", "neutral", "readable"] },
  "Plus Jakarta Sans": { capsize: "plusJakartaSans", css2: "Plus+Jakarta+Sans:wght@200..800", roles: ["body", "display"], tags: ["geometric", "friendly", "modern"] },
  Manrope: { capsize: "manrope", css2: "Manrope:wght@200..800", roles: ["body", "display"], tags: ["geometric", "minimal", "modern"] },
  "DM Sans": { capsize: "dMSans", css2: "DM+Sans:wght@100..900", roles: ["body", "display"], tags: ["geometric", "minimal", "friendly"] },
  Onest: { capsize: "onest", css2: "Onest:wght@100..900", roles: ["body", "display"], tags: ["neutral", "modern", "readable"] },
  "Source Sans 3": { capsize: "sourceSans3", css2: "Source+Sans+3:wght@200..800", roles: ["body"], tags: ["humanist", "neutral", "readable"] },
  "Public Sans": { capsize: "publicSans", css2: "Public+Sans:wght@100..900", roles: ["body"], tags: ["grotesque", "neutral", "readable"] },
  "Albert Sans": { capsize: "albertSans", css2: "Albert+Sans:wght@100..900", roles: ["body", "display"], tags: ["geometric", "modern", "friendly"] },
  Sora: { capsize: "sora", css2: "Sora:wght@200..800", roles: ["body", "display"], tags: ["geometric", "technical", "modern"] },
  Outfit: { capsize: "outfit", css2: "Outfit:wght@100..900", roles: ["body", "display"], tags: ["geometric", "minimal", "modern"] },
  "Mona Sans": { capsize: "monaSans", css2: "Mona+Sans:wght@200..800", roles: ["body", "display"], tags: ["grotesque", "modern", "technical"] },
  "Instrument Sans": { capsize: "instrumentSans", css2: "Instrument+Sans:wght@400..700", roles: ["body", "display"], tags: ["grotesque", "modern", "neutral"] },
  Epilogue: { capsize: "epilogue", css2: "Epilogue:wght@100..900", roles: ["body", "display"], tags: ["geometric", "modern", "technical"] },
  "Red Hat Display": { capsize: "redHatDisplay", css2: "Red+Hat+Display:wght@300..700", roles: ["display", "body"], tags: ["geometric", "technical", "modern"] },

  // ── sans — display grotesques (heading-forward) ──────────────────────────
  "Bricolage Grotesque": { capsize: "bricolageGrotesque", css2: "Bricolage+Grotesque:wght@200..800", roles: ["display"], tags: ["grotesque", "characterful", "editorial"] },
  "Space Grotesk": { capsize: "spaceGrotesk", css2: "Space+Grotesk:wght@300..700", roles: ["display"], tags: ["grotesque", "technical", "characterful"] },
  "Familjen Grotesk": { capsize: "familjenGrotesk", css2: "Familjen+Grotesk:wght@400..700", roles: ["display"], tags: ["grotesque", "modern", "characterful"] },
  Archivo: { capsize: "archivo", css2: "Archivo:wght@100..900", roles: ["display", "body"], tags: ["grotesque", "technical", "bold"] },
  Syne: { capsize: "syne", css2: "Syne:wght@400..700", roles: ["display"], tags: ["expressive", "bold", "editorial"] },
  Unbounded: { capsize: "unbounded", css2: "Unbounded:wght@200..800", roles: ["display"], tags: ["expressive", "bold", "funky"] },
  "Darker Grotesque": { capsize: "darkerGrotesque", css2: "Darker+Grotesque:wght@300..700", roles: ["display"], tags: ["expressive", "characterful", "editorial"] },
  Gabarito: { capsize: "gabarito", css2: "Gabarito:wght@400..900", roles: ["display"], tags: ["friendly", "rounded", "bold"] },

  // ── serif — display + editorial body ─────────────────────────────────────
  Fraunces: { capsize: "fraunces", css2: "Fraunces:opsz,wght@9..40,100..900", roles: ["display", "body"], tags: ["serif", "editorial", "warm", "characterful"] },
  Newsreader: { capsize: "newsreader", css2: "Newsreader:opsz,wght@10..72,300..700", roles: ["body", "display"], tags: ["serif", "editorial", "classic", "readable"] },
  "Source Serif 4": { capsize: "sourceSerif4", css2: "Source+Serif+4:wght@200..800", roles: ["body", "display"], tags: ["serif", "classic", "readable"] },
  Lora: { capsize: "lora", css2: "Lora:wght@400..700", roles: ["body", "display"], tags: ["serif", "warm", "readable", "classic"] },
  "Playfair Display": { capsize: "playfairDisplay", css2: "Playfair+Display:wght@400..900", roles: ["display"], tags: ["serif", "elegant", "editorial", "contrast"] },
  Bitter: { capsize: "bitter", css2: "Bitter:wght@100..900", roles: ["body", "display"], tags: ["serif", "slab", "readable"] },
  "Crimson Pro": { capsize: "crimsonPro", css2: "Crimson+Pro:wght@200..800", roles: ["body", "display"], tags: ["serif", "classic", "editorial", "readable"] },
  Cormorant: { capsize: "cormorant", css2: "Cormorant:wght@300..700", roles: ["display"], tags: ["serif", "elegant", "contrast", "editorial"] },

  // ── mono — code / labels ─────────────────────────────────────────────────
  "JetBrains Mono": { capsize: "jetBrainsMono", css2: "JetBrains+Mono:wght@200..800", roles: ["mono"], tags: ["mono", "technical", "neutral"] },
  "Geist Mono": { capsize: "geistMono", css2: "Geist+Mono:wght@100..900", roles: ["mono"], tags: ["mono", "minimal", "modern"] },
  "Roboto Mono": { capsize: "robotoMono", css2: "Roboto+Mono:wght@300..700", roles: ["mono"], tags: ["mono", "neutral", "classic"] },
  "Source Code Pro": { capsize: "sourceCodePro", css2: "Source+Code+Pro:wght@200..800", roles: ["mono"], tags: ["mono", "neutral", "readable"] },
  "Fira Code": { capsize: "firaCode", css2: "Fira+Code:wght@300..700", roles: ["mono"], tags: ["mono", "technical", "ligatures"] },
  "Spline Sans Mono": { capsize: "splineSansMono", css2: "Spline+Sans+Mono:wght@300..700", roles: ["mono"], tags: ["mono", "modern", "friendly"] },
};

export const families = Object.keys(catalog);

export function inCatalog(family) {
  return Object.prototype.hasOwnProperty.call(catalog, family);
}

// Look up a family, throwing a clear error if it isn't a catalog member (curator authoring
// guard — a typo'd family must fail loudly, not ship a broken bundle).
export function get(family) {
  const e = catalog[family];
  if (!e) throw new Error(`"${family}" is not in the Font Lab catalog (no verified parity bundle)`);
  return e;
}
