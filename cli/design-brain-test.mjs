// Unit test for the portable design brain (A1). Dependency-free — runs anywhere:
//   node cli/design-brain-test.mjs
import assert from "node:assert";
import {
  EXCLUSIONS, isOverexposed, INTAKE_QUESTIONS, STRATEGY_STEPS, REFERENCES,
  RATIONALE_REQUIREMENT, PRINCIPLES, designBrief, antiGenericViolations, pickWarnings,
} from "./design-brain.mjs";

const dir = (name, display, body) => ({ name, roles: { display: { family: display }, body: { family: body }, mono: { family: "Spline Sans Mono" } } });

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

// ── B1: the hard anti-generic gate (composed menu) ──────────────────────────
ok(antiGenericViolations([]).length === 0, "empty menu has no violations");
ok(antiGenericViolations([dir("A", "Fraunces", "Hanken Grotesk"), dir("B", "Bricolage Grotesque", "Libre Franklin")]).length === 0,
  "a distinctive menu clears the bar");
ok(antiGenericViolations([dir("Gen", "Geist", "Geist")]).some((m) => /both overexposed/i.test(m)),
  "a direction generic in BOTH display and body is flagged");
ok(antiGenericViolations([dir("A", "Geist", "Fraunces"), dir("B", "Inter", "Lora")]).some((m) => /every direction leads with an overexposed display/i.test(m)),
  "a menu whose every display is overexposed is flagged (even with distinctive bodies)");
ok(antiGenericViolations([dir("A", "Fraunces", "Inter")]).length === 0,
  "one overexposed role in an otherwise-distinctive direction is allowed (soft-warned elsewhere)");

// ── the human's pick is warned, never blocked ───────────────────────────────
ok(pickWarnings({ display: { family: "Geist" }, body: { family: "Inter" }, mono: { family: "Spline Sans Mono" } }).length === 1,
  "an all-generic pick gets a single combined heads-up");
ok(pickWarnings({ display: { family: "Fraunces" }, body: { family: "Hanken Grotesk" }, mono: { family: "Roboto Mono" } }).some((m) => /mono/i.test(m)),
  "a distinctive pick with a generic mono still gets a heads-up for the mono");
ok(pickWarnings({ display: { family: "Fraunces" }, body: { family: "Hanken Grotesk" }, mono: { family: "Spline Sans Mono" } }).length === 0,
  "a fully distinctive pick gets no heads-up");

console.log(`\ndesign-brain: ${pass} checks passed`);
