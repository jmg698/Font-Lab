# Font Lab v2 — A Foolproof, Tasteful, Cross-Agent Choosing Moment

> **Status: design agreed, not yet built.** This doc hardens the architecture and build
> order for the next arc of Font Lab. It supersedes the catalog-curation direction we
> started from. Subsequent chats work through and close out the build against this doc.
>
> The core thesis is unchanged (see [`CONCEPT.md`](./CONCEPT.md)): *AI deleted the moment
> of choice; Font Lab puts it back, and the human keeps the taste decision.* What changes
> here is **how** we make that moment consistent to reach and genuinely tasteful to use.

---

## 1. The north star: two different consistencies

Everything below follows from one distinction we have to keep straight, because conflating
them is what produced both the bug and the original (wrong) fix:

- **Consistency of the *experience* — we want this HIGH.** Getting Font Lab, installing it,
  and being walked from "let's pick fonts" → options → choice → ship should feel the *same,
  designed way every time*, on every agent. Today it does not.
- **Consistency of the *output fonts* — we want this LOW.** The actual typefaces should be
  *tailored per project* and varied — never the same two sites alike. **Deterministic font
  output is an anti-goal.** Uniform output is the disease (every AI site reaching for Inter /
  Space Grotesk); it is not something to engineer toward.

> The first version of this plan tried to make the *output* deterministic ("same input → same
> 5 directions, every time"). That is exactly backwards. We make the **process** and the
> **quality bar** deterministic, and we make the **typefaces** diverge.

---

## 2. Diagnosis — why today's experience is inconsistent *and* generic

The engine is not the problem. `curate()` is provably deterministic (`cli/m4-test.mjs:64`).
The variance and the blandness live in the *gaps around* it. Four root causes:

- **RC1 — The protocol is prose, and the load-bearing steps are optional.** `SKILL.md` says
  "Decide the menu — *two ways, your call*" (`skill/font-lab/SKILL.md:28`) and "*Mix freely*"
  (`:33`); `vibe` is optional everywhere. **There is no step that says "ask the user what they
  want before curating."** Whether a brief is gathered, whether a vibe is passed, and which
  menu path is taken are all improvised — the single biggest source of run-to-run divergence.

- **RC2 — The contract is invisible to skill-less agents.** The ordered pipeline
  (`analyze → curate/compose → preview → pick → apply`) and the "human picks" norm live only
  in *source comments* (`cli/mcp.mjs:3`, `:8-10`). `tools/list` transmits only
  `{name, description, inputSchema}` (`cli/mcp.mjs:190`). An agent on Codex/Cursor that never
  reads `SKILL.md` receives none of the ordering, none of "ask first," and a permissive
  `font_lab_curate` description that literally says "you can also ignore this and compose your
  own" (`cli/mcp.mjs:41`).

- **RC3 — The catalog has no taste axis.** Every entry is `{capsize, css2, roles, tags}`
  (`cli/catalog.mjs:16-65`). `tags` is a *vibe* lookup, not a *quality* signal. `scoreForVibe`
  returns 3/1/0 (`cli/curator.mjs:49-56`); Fraunces and Space Grotesk are interchangeable if
  they share a tag, and ties resolve to authored array order (`:72`). **The code cannot
  express "prefer the characterful one."**

- **RC4 — Generic is the floor, the default, *and* the unguarded escape hatch.** The no-vibe
  path returns authored-order top-5, and the first five directions include `clean-geometric` =
  Geist/Geist/Geist Mono (`cli/curator.mjs:32`) and `quiet-minimal` = Manrope/Manrope (`:41`).
  The "take the wheel" `composeDirections` path gates *only* on catalog membership
  (`cli/engine.mjs:56-60`) — Inter/Geist/Space Grotesk sail straight through with zero taste
  check. Roughly **half the 41-font catalog is the overexposed AI-default set** (Inter, Geist,
  Space Grotesk, Manrope, Sora, Figtree, Outfit, DM Sans, and the generic monos).

### The curation insight (why the first fix was wrong)

There are **two kinds of curation, with opposite effects**:

1. **Curation-as-fixed-answers** — a baked list of directions, deterministically sliced.
   *This produces uniform defaults.* It is itself a root cause. **We kill it as the primary
   path.**
2. **Curation-as-constraints** — a *taste rubric* (distinctive, varied, tailored to the brief,
   no overexposed defaults unless justified) plus a *shippability gate*. *This produces
   variety* by forcing the agent off its lazy defaults. **We keep and strengthen it.**

Removing curation entirely and "trusting the agent to reach out" does **not** work: unguided,
an LLM reaches for the most statistically popular name — Inter, Geist, Space Grotesk. The
AI's own defaults *are* the original sameness. So the answer is not "curate less"; it is
**"stop curating answers, start curating the bar and the universe."**

---

## 3. The architecture (decisions made)

### 3.1 Catalog → a shippability **gate + verified cache**, not a menu

The catalog stops being a hand-maintained 41-font whitelist that gets sliced into directions.
It becomes:

- **A gate:** given *any* font, can we ship it with preview == ship? → admit, or admit with an
  honest warning (see §3.2).
- **A verified cache:** fonts we've already vetted (metrics + parity), so repeat picks are fast.

**Universe expands to:** **all of Google Fonts (~1,500 families), dynamically admitted, plus
distinctive open-source foundries** (Fontshare / Indian Type Foundry — Clash Display, Cabinet
Grotesk, Satoshi, General Sans; Velvetyne; Collletttivo; etc.). These are the self-hostable,
genuinely *designed* faces that are **not** the AI-default vocabulary — the real "looks like a
top-tier designer picked it" tier that the Google-only catalog ignored.

This reframes the [`CRITIQUE.md`](./CRITIQUE.md) ceiling ("the distinctive fonts are
commercial"): only *partly* true. A large middle tier of **free-but-distinctive foundry fonts**
is self-hostable variable woff2 — fully compatible with preview == ship.

**Feasibility:** `@capsizecss/unpack` derives metrics from an arbitrary font buffer/URL, and
`cli/catalog-build.mjs` already self-hosts fonts + computes capsize parity fallbacks. So
"admit a font on demand" is an **extension of existing machinery**, not a rewrite — turn the
offline catalog build into an on-demand admission pipeline.

### 3.2 Parity → **strive for WYSIWYG, soft-degrade, never hard-block**

The gate *tries* to guarantee preview == ship. When it can't (no derivable metrics, non-variable
source, etc.), it does **not** refuse — it surfaces the option with an honest heads-up:
*"this may render slightly differently once applied — use it anyway?"* The human decides. We
strive for byte-for-byte fidelity as hard as we can; we degrade transparently when we must.

### 3.3 Taste → a **portable design brain** Font Lab carries

**Principle: taste must be portable.** We do **not** depend on Impeccable or any other skill
for taste — it won't be installed in most environments and never on Codex. Font Lab ships its
own design intelligence and *optionally amplifies* with other skills when present.

The design brain is delivered **as data the agent must apply** (not prose it can skim), so it
survives skill-less agents. It has four parts:

1. **Brief → strategy, names last.** Forbid jumping to font names. First reason about content
   type, mood, era, and pairing logic (contrast vs. harmony); *then* propose families. This
   reordering is most of the battle.
2. **A negative list — anti-generic exclusions.** Inter, Geist, Space Grotesk, Roboto, Open
   Sans, Montserrat, Poppins, Lato, etc. "Do not propose these unless the brief demands maximum
   neutrality — and justify it if you do." A negative prompt is the **most durable lever**; it
   pushes the model directly off its statistical attractor.
3. **Rotating distinctive references — inspiration, not canon.** Examples of the *kind* of
   faces designers reach for, framed as material to think *with*, not a shortlist to pick
   *from*. Must rotate and stay large (see the trap in §7).
4. **Mandatory per-direction rationale tied to the brief.** Every direction answers "why *this*
   face for *this* project." The justification gate makes a lazy Inter pick impossible to
   defend.

**Best inspiration source = the project itself.** Extend the analyzer to gather *design
context* — existing colors/spacing tokens, `DESIGN.md`/brand docs, and the copy's tone — and
feed it into the brief. Fully portable, and it's what makes options feel *bespoke* rather than
"a nice font, applied." Inspiration sources ranked by portability:
the project's own content/brand → Font Lab's portable design brain → other design skills
(Impeccable) if present → web galleries (Typewolf, Fonts In Use) if the agent has web access.

### 3.4 Compose-for-this-project becomes the **primary** path

Today `composeDirections` is the unguarded *bypass*. It becomes the **main event** — but now
it runs *through* the shippability gate (§3.1) and the taste rubric (§3.3), which today it has
neither of. The hand-authored fixed directions survive **only as a distinctive cold-start
fallback** (no brief / no context) — and even that fallback must be characterful, never
Geist/Inter.

### 3.5 The human always makes the final pick

Gate the **menu** and the **agent-compose** path hard against generics. But on the **human's
final pick** — including mixed picks (display from one direction, body from another) — **warn
at most, never block.** Hard-blocking the human's own choice contradicts the product thesis
("the human keeps the taste decision"). *(Decided.)*

---

## 4. The experience protocol (the scripted beats)

Every run hits the same beats; only the user's answers change:

```
analyze (+ gather project design context)
  → ask 2–3 framing questions      (feeling? how bold a departure? brand to evoke / avoid?)
  → ask, context-aware:            "5 screenshots, or the full live editor?"
  → compose tailored directions    (wide universe + rubric + exclusions + rationale)
  → present                        (headless by default)
  → HUMAN picks                    (never auto-pick)
  → ship                           (reversible) — warn if parity couldn't be guaranteed
```

Two rules baked into the headless/live step:

- **State the cost asymmetry:** *screenshots* = the agent does it, ~2 min, works anywhere;
  *live* = richer (flip/mix/compare), but the user runs local dev + the pick endpoint.
- **Only offer live when the surface supports it** — never on a web/mobile session with no
  local browser. Headless stays the default so the lazy path is the good path.

---

## 5. Cross-agent delivery

Three surfaces, one source of truth, no drift:

- **Taste + parity gates live in the engine** (`engine.mjs`) → foolproof on *every* agent,
  regardless of what it reads. This is the non-negotiable floor.
- **The protocol ships to whichever surface a host reads:** Claude → the skill; Codex/Cursor/
  others → an **`AGENTS.md`** emitted by the installer; plus a per-tool protocol suffix on
  `tools/list` as a belt-and-suspenders backstop. Generate all three from **one shared
  protocol string** so SKILL.md, AGENTS.md, and the tool descriptions never diverge.
- **A host-aware installer** (`--host claude|cursor|codex|windsurf|vscode|gemini|all`, with
  auto-detect) writes the right MCP config in the right place/format (the `mcpServers` JSON
  family for most; TOML for Codex; `servers` for VS Code) and the right protocol surface per
  host. **This also kills install variance** — one tested path per host instead of the agent
  hand-rolling Cursor wiring.

> Honest ceiling: engine-level *taste/parity* gates are truly foolproof everywhere. The
> *intake / ask-first* behavior is fully enforced in Claude (skill) and **best-effort**
> elsewhere (AGENTS.md + a `font_lab_start` tool that returns the questions as data). Forcing
> intake on a non-cooperating agent would require handler-level state-gating (curate/preview
> refuse until intake ran) — a heavier option held in reserve (see Decisions Log).

---

## 6. Build order

Sequenced by dependency and leverage. Each item notes whether it survives a skill-less agent.

**Phase A — Foundations (taste + gate primitives)**
- **A1. The portable design brain** *(data/prose; survives skill-less agent via tool payload)*
  — anti-generic exclusion list, brief→strategy scaffold, rotating reference set, rationale
  requirement. Cheap, highest taste-leverage. Ships in the skill *and* as a `font_lab_start`
  return payload.
- **A2. The dynamic shippability gate** *(engine; survives everywhere)* — extend
  `catalog-build.mjs` + `@capsizecss/unpack` to admit an arbitrary font on demand and return a
  parity verdict (`guaranteed` | `best-effort-warn`). The biggest engineering lift; the unlock
  for "reach outside our catalog."

**Phase B — Compose becomes primary**
- **B1. Gated compose** *(engine; survives everywhere)* — make compose-for-this-project the
  main path, run through A1 (rubric) + A2 (gate); demote fixed directions to cold-start
  fallback.
- **B2. Project design-context analysis** *(engine; survives everywhere)* — extend the
  analyzer to gather colors/tokens/brand-docs/copy-tone for the brief.

**Phase C — The experience protocol**
- **C1. Intake** — mandatory framing questions, in SKILL.md *and* as the `font_lab_start`
  data payload.
- **C2. Headless/live decision step** — context-aware, cost asymmetry stated.
- **C3. Strict numbered protocol** — no auto-pick, present-options, one shared protocol string.

**Phase D — Cross-agent distribution**
- **D1. Host-aware installer** (`--host` + auto-detect; JSON/TOML/`servers` writers).
- **D2. AGENTS.md emission** from the shared protocol source + per-tool description mirroring.

**Phase E — Universe content**
- **E1. Seed the verified cache** with the distinctive foundry fonts; build the rotating
  reference set. Last, because A2 + B1 already raise the floor with on-demand admission.

> The fixed `tier`/`quarantine` idea from the first plan **survives in reduced form**: the
> exclusion list (A1) and the fallback ranking. It is no longer the centerpiece — the gate +
> rubric + wide universe are.

---

## 7. Risks & open questions

1. **Dynamic metric generation (feasibility/perf/honesty).** `@capsizecss/unpack` must reliably
   derive metrics for arbitrary admitted fonts; the gate must **refuse-or-warn honestly** when
   it can't, never fake parity. Per-font runtime cost needs measuring; the cache mitigates
   repeat hits.
2. **Foundry licensing is a real gate, alongside parity.** Open-source foundry fonts vary:
   Velvetyne is OFL (libre); **Fontshare terms must be checked per family** before we self-host
   and redistribute bundles. Treat "license permits self-hosting" as a hard admission criterion
   next to "metrics derivable."
3. **The positive-reference trap (one level up).** A positive reference list becomes the *new*
   Inter if everyone gets the same shortlist. Keep it **large and rotating**, framed as
   examples-of-thinking; lean the durable weight on the **negative list + reasoning scaffold +
   wide universe**, not a canon.
4. **Intake enforceability outside Claude.** `tools/list` has no ordering/precondition
   semantics. Without handler-level gating, "ask first" is best-effort on non-Claude agents.
   Decide whether best-effort (AGENTS.md + `start` tool) is enough or we invest in handler
   gating.
5. **Two front doors (`analyze` vs `start`).** If we add `font_lab_start`, make it *subsume*
   analyze and point `analyze`'s description at it — one obvious first call, no split-brain.
6. **WYSIWYG soft-degrade must stay visible.** The "may differ when applied" warning has to be
   prominent at the pick moment, not buried — or we quietly erode the core promise.
7. **The catalog ceiling moves, it doesn't vanish.** Genuinely bespoke commercial faces still
   can't auto-ship. A later, clearly-labeled "preview-only, needs a license" path is possible
   but deliberately out of scope now.

---

## 8. Decisions log

**Made (this design):**
- Universe = **all of Google Fonts + open-source foundries** (Fontshare/Velvetyne/etc.).
- Parity = **strive for WYSIWYG, soft-warn-and-allow** when we can't guarantee it.
- Taste = **portable design brain Font Lab carries**; compose with other skills optionally,
  never as a dependency.
- **Output determinism is an anti-goal**; process + quality-bar consistency is the goal.
- Catalog = **shippability gate + verified cache**, not a menu.
- Compose-for-this-project = **primary path** (gated + rubric'd); fixed directions = **cold-
  start fallback only**.
- **Final-pick gating:** gate the menu + agent-compose hard; on the human's pick (incl. mixed
  picks), **warn but never block** (§3.5).
- **Intake enforcement outside Claude:** **best-effort** via AGENTS.md + a `font_lab_start`
  payload; handler-level gating held in reserve, not built now (§5, risk #4).
- **First build target:** **A1 — the portable design brain** — *shipped.*
  `cli/design-brain.mjs` (dependency-free: intake questions, anti-generic exclusions +
  `isOverexposed()`, strategy scaffold, distinctive references, rationale rule), surfaced via a
  new `font_lab_start` front-door tool (`engine.start()` + `mcp.mjs`) and the rewritten
  intake-first protocol in `SKILL.md`. `composeDirections` now soft-warns on overexposed
  families (the hard set-level gate is B1). Covered by `cli/design-brain-test.mjs` (14 checks,
  runs without deps).
- **A2 — the dynamic shippability gate** — *shipped (gate logic verified; network/build path
  needs a deps+network run).* `cli/admit.mjs`: `admit(family)` → `guaranteed` | `best-effort` |
  `unavailable`, with pure verdict/parity/license logic and injectable Google + Fontshare +
  `@capsizecss/unpack` resolvers (the catalog is the seed cache; the soft-degrade never
  hard-blocks a shippable font). Engine: `admit`, `admitDirections`, a project-scoped verified
  cache (`.font-lab/admitted.json`), and `composeDirections` now **consults the gate instead of
  a catalog whitelist** — non-catalog Google/foundry fonts are admitted and best-effort fonts
  are allowed with a fidelity warning. `generateCatalog` self-hosts admitted fonts (unpack
  metrics; the catalog path stays byte-identical). New `font_lab_check_fonts` MCP tool lets the
  agent reach beyond the catalog and get an honest verdict; `SKILL.md` rule is now
  "shippable-only, not catalog-only." Added dep `@capsizecss/unpack@^4.0.1`. Covered by
  `cli/admit-test.mjs` (20 checks, runs without deps via injected fakes).
- **B1 — the hard anti-generic gate** — *shipped.* The agent-composed MENU must now clear a
  distinctiveness bar: `composeDirections` **rejects** a set where any direction is overexposed
  in both display and body, or where every direction leads with an overexposed display — with a
  `force:true` deliberate override. The human's own final pick is **never blocked**:
  `selectDirection` returns a `pickWarnings()` heads-up for a generic/clashing pick but always
  ships it. The pure policies (`antiGenericViolations`, `pickWarnings`) live in
  `cli/design-brain.mjs` and are covered by `cli/design-brain-test.mjs` (now 22 checks).
  **Next: verify the A2 network/build path on a machine with deps; then the foundry adapters
  (Fontshare/Velvetyne) and catalog-as-cache seeding (E1); and the curator fallback rebalance
  (drop the authored pure-generic directions so even the no-brief fallback is distinctive).**

**Open / recommended — confirm before building:**
- **Commercial "preview-only, needs license" path:** deferred, out of scope for this arc.

---

## 9. Evidence index

Grounding for the diagnosis (all paths relative to repo root):

- `skill/font-lab/SKILL.md:28,33` — "your call" / "Mix freely"; no intake step (RC1).
- `cli/mcp.mjs:3,8-10,190` — pipeline + "human picks" norm live only in source comments;
  `tools/list` omits them (RC2).
- `cli/mcp.mjs:41` — `font_lab_curate` description invites bypass ("ignore this and compose").
- `cli/catalog.mjs:16-65` — entries are `{capsize, css2, roles, tags}`; no quality axis (RC3).
- `cli/curator.mjs:32,41` — default directions include Geist/Geist/Geist Mono and Manrope/
  Manrope (RC4).
- `cli/curator.mjs:49-56,72` — 3/1/0 vibe scoring, ties resolve to authored order (RC3).
- `cli/engine.mjs:56-60` — `composeDirections` gates only on catalog membership (RC4).
- `cli/m4-test.mjs:64` — curate is deterministic ("same input → same output").
- `cli/catalog-build.mjs` + `@capsizecss/unpack` — existing self-hosting + metric machinery
  the dynamic gate (A2) extends.
- `CRITIQUE.md` — the "distinctive fonts are commercial" ceiling this design partly reframes.
</content>
</invoke>
