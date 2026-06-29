// Font Lab — the portable design brain (v2, A1).
//
// Taste has to travel. We can't assume Impeccable or any other design skill is installed (it
// won't be, in most environments, and never on Codex), so Font Lab carries its OWN design
// intelligence and hands it to the agent as DATA it must apply — not prose it can skim. This
// module is the source of that data: the intake questions to ask first, the strategy scaffold
// that forces "reason about the brief before naming fonts," the overexposed defaults to avoid,
// the distinctive references to reach for, and the rule that every direction needs a rationale.
//
// Deliberately DEPENDENCY-FREE (pure data + string helpers, no catalog/metrics imports) so it
// loads and tests anywhere, on any agent host. `cli/design-brain-test.mjs` covers it.
//
// Design notes:
//   • The NEGATIVE list (avoid) is the most durable lever — it pushes the model off its
//     statistical attractor (Inter/Geist/Space Grotesk). Lean on it.
//   • The POSITIVE references are inspiration, NOT a canon — if everyone gets the same shortlist
//     it becomes the new Inter. They are grouped by *intent* and the guidance tells the agent to
//     VARY them per project. Keep the pool broad; never treat it as a pick-list.
//   • References name a *kind of taste*, not a guaranteed-shippable set. Until the dynamic
//     shippability gate (A2) lands, the agent must map each reference to a shippable family
//     (today: a catalog member). The guidance says so.

// ── the overexposed defaults: the generic AI/template vocabulary to avoid ─────
// Not "bad fonts" — they're the ones every AI-built site already ships, so they read as generic.
// Avoid unless the brief specifically calls for maximum neutrality (and justify it if you do).
export const EXCLUSIONS = [
  // sans
  "Inter", "Geist", "Space Grotesk", "Roboto", "Open Sans", "Montserrat", "Poppins",
  "Lato", "Manrope", "DM Sans", "Sora", "Figtree", "Outfit", "Plus Jakarta Sans",
  "Work Sans", "Nunito", "Nunito Sans", "Raleway", "Mulish", "Rubik", "Karla",
  // mono
  "Roboto Mono", "JetBrains Mono", "Geist Mono", "Fira Code", "Space Mono", "Source Code Pro",
  // serif (overexposed, not bad)
  "Playfair Display", "Merriweather",
];

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const EXCLUDED = new Set(EXCLUSIONS.map(norm));

// Is this family one of the overexposed AI-default faces? Case- and whitespace-insensitive.
export function isOverexposed(family) {
  return EXCLUDED.has(norm(family));
}

// ── intake: the questions to ask the human BEFORE proposing any fonts ─────────
// This is the step that makes the result tailored instead of generic. Ask, then wait.
export const INTAKE_QUESTIONS = [
  {
    id: "feeling",
    q: "What should the type feel like?",
    examples: ["editorial & literary", "technical & precise", "warm & human", "bold & expressive", "quiet & minimal", "classic & trustworthy"],
  },
  {
    id: "departure",
    q: "How far from the current look should we go?",
    examples: ["a subtle refinement", "a clear shift", "a dramatic rebrand"],
  },
  {
    id: "brand",
    q: "Any brand, site, or aesthetic to evoke — or explicitly avoid?",
    examples: ["like a respected magazine", "not another SaaS template", "match our existing logo"],
  },
];

// ── strategy scaffold: reason like a designer, names LAST ─────────────────────
// A real designer doesn't start at "Inter" — they start at a strategy and arrive at names.
export const STRATEGY_STEPS = [
  "Read the project first: content type (marketing / editorial / product / portfolio / docs), the tone of the actual copy, and the existing colors and spacing. The type has to fit what's already there.",
  "Decide a typographic strategy BEFORE any font names: how many voices, contrast vs. harmony, and what the display face should DO (set the tone) versus the body (disappear into comfortable reading).",
  "Pick a pairing logic that serves the brief — e.g. a high-contrast serif display over a humanist sans body, or a characterful grotesque display over a warm neutral body. The logic justifies the choice.",
  "Only NOW choose families that fulfill the strategy — reaching past the overexposed defaults and drawing from the distinctive references and the wider universe.",
  "For every direction, write one sentence on why THIS face suits THIS project's brief. If the only justification is 'clean/modern,' pick a more specific face.",
];

// ── references: distinctive faces grouped by INTENT (inspiration, not a canon) ─
// Reach for these *kinds* of choices. Vary them per project — do not serve the same shortlist
// every time. Some live in open foundries (Fontshare/Velvetyne) and aren't shippable until the
// dynamic gate (A2) admits them; until then, map the intent to the nearest shippable family.
export const REFERENCES = [
  { intent: "editorial / literary headlines", families: ["Fraunces", "Hedvig Letters Serif", "Gambetta", "Newsreader", "Spectral"], why: "high-contrast or warm serifs that carry a voice — the opposite of a neutral UI sans." },
  { intent: "distinctive grotesque (instead of Space Grotesk)", families: ["Cabinet Grotesk", "Bricolage Grotesque", "Familjen Grotesk", "Darker Grotesque", "Clash Grotesk"], why: "grotesques with actual character, for when you want modern but not template." },
  { intent: "expressive display", families: ["Syne", "Unbounded", "Clash Display", "Big Shoulders Display"], why: "loud, opinionated faces for a hero or a wordmark that should be remembered." },
  { intent: "warm humanist body", families: ["Hanken Grotesk", "Mona Sans", "Literata", "Hedvig Letters Sans"], why: "readable text faces with warmth, instead of the flat geometric defaults." },
  { intent: "technical without the cliché", families: ["Spline Sans Mono", "Martian Mono", "Departure Mono", "Commit Mono"], why: "code/mono character that isn't JetBrains or Fira on every other dev site." },
];

// ── the rule that kills the lazy pick ─────────────────────────────────────────
export const RATIONALE_REQUIREMENT =
  "Every direction MUST include a one-sentence rationale naming why this face suits this project's brief. " +
  "A justification you couldn't defend to a designer ('it's clean', 'it's modern') means you reached for a default — pick a more specific, more distinctive face instead.";

// ── guiding principles (short, for the agent to hold throughout) ──────────────
export const PRINCIPLES = [
  "The human always makes the final pick. You curate the menu; you never auto-select.",
  "The whole point is to escape the generic AI look — reach past the defaults toward distinctive, tailored faces.",
  "Tailored beats safe: options should feel chosen for THIS project, not pulled from a template.",
  "Be honest about fidelity: prefer faces we can ship with preview == ship; if one might render slightly differently when applied, say so and let the human decide.",
];

// Assemble the full design brief the front door (engine.start / font_lab_start) hands the agent.
export function designBrief() {
  return {
    intake: {
      instruction: "Ask the human these BEFORE proposing any fonts, then wait for the answers. This is what makes the result tailored instead of generic.",
      questions: INTAKE_QUESTIONS,
    },
    strategy: {
      instruction: "Reason through these in order. Arrive at font names LAST.",
      steps: STRATEGY_STEPS,
    },
    avoid: {
      note: "Do not propose these overexposed defaults unless the brief specifically calls for maximum neutrality — and say why if you do.",
      families: EXCLUSIONS,
    },
    references: {
      note: "Inspiration, not a pick-list. Reach for these KINDS of choices and vary them per project. Until the dynamic gate lands, map each to a shippable family (a catalog member — browse with list_catalog).",
      groups: REFERENCES,
    },
    rationale: RATIONALE_REQUIREMENT,
    principles: PRINCIPLES,
  };
}
