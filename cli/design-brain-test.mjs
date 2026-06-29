// Unit test for the portable design brain (A1). Dependency-free — runs anywhere:
//   node cli/design-brain-test.mjs
import assert from "node:assert";
import {
  EXCLUSIONS, isOverexposed, INTAKE_QUESTIONS, STRATEGY_STEPS, REFERENCES,
  RATIONALE_REQUIREMENT, PRINCIPLES, designBrief,
} from "./design-brain.mjs";

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

// exclusions + the overexposed check (the durable negative lever)
ok(EXCLUSIONS.length >= 20, "exclusions list is substantial");
ok(isOverexposed("Inter") && isOverexposed("inter") && isOverexposed("  Space   Grotesk "),
  "flags overexposed defaults, case- and whitespace-insensitive");
ok(isOverexposed("Geist") && isOverexposed("Roboto Mono") && isOverexposed("Playfair Display"),
  "flags generic sans, mono, and overexposed serif");
ok(!isOverexposed("Fraunces") && !isOverexposed("Cabinet Grotesk") && !isOverexposed(""),
  "does not flag distinctive faces (or empty input)");

// intake — the questions to ask first
ok(INTAKE_QUESTIONS.length >= 3 && INTAKE_QUESTIONS.every((q) => q.id && q.q),
  "intake has >=3 well-formed questions");
ok(INTAKE_QUESTIONS.some((q) => q.id === "feeling") && INTAKE_QUESTIONS.some((q) => q.id === "departure"),
  "intake covers feeling + departure");

// strategy scaffold — names last
ok(STRATEGY_STEPS.length >= 4 && STRATEGY_STEPS.some((s) => /names?\s+last|before any font names|strategy/i.test(s)),
  "strategy scaffold puts font names last");

// references — grouped by intent, and themselves NOT overexposed (or it's the new Inter)
ok(REFERENCES.length >= 4 && REFERENCES.every((r) => r.intent && Array.isArray(r.families) && r.families.length),
  "references are grouped by intent with families");
const refFams = REFERENCES.flatMap((r) => r.families);
ok(refFams.length > 0 && !refFams.some(isOverexposed),
  "no reference family is itself an overexposed default");

// rationale + principles
ok(typeof RATIONALE_REQUIREMENT === "string" && /rationale/i.test(RATIONALE_REQUIREMENT),
  "rationale requirement is present");
ok(Array.isArray(PRINCIPLES) && PRINCIPLES.some((p) => /human/i.test(p) && /pick|select/i.test(p)),
  "principles keep the final pick with the human");

// the assembled brief
const b = designBrief();
ok(b.intake?.questions?.length && b.strategy?.steps?.length && b.avoid?.families?.length &&
   b.references?.groups?.length && b.rationale && b.principles?.length,
  "designBrief() assembles the full payload");
ok(b.avoid.families.length === EXCLUSIONS.length, "brief surfaces the full avoid list");
ok(/before/i.test(b.intake.instruction), "brief tells the agent to ask before proposing fonts");

console.log(`\ndesign-brain: ${pass} checks passed`);
