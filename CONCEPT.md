# Font Lab — Concept Outline

## The Core Belief (the spine — everything hangs off this)

AI removed the labor of implementation, but in doing so it also deleted the moment of choice. And taste only happens at the moment of choice — a human with judgment picking between real options, seen in context. Good design isn't "less slop," it's "the right call for THIS project," and that call is subjective and personal.

So the product is **NOT a design generator** and **NOT a slop-detector**. It's a **DECISION SURFACE**. Its entire job is to re-insert the human-judgment moment that single-shot AI skips — without making the human do the work. The agent still does the labor; the human just makes the call.

Name for the thing we're protecting: **THE CHOOSING MOMENT**. That's the magic. Everyone else either makes the choice FOR you (the agent, Anthropic's skill) or makes you do the work YOURSELF (Snapfont, raw CSS). Nobody hands a human-with-taste a curated set, rendered on their real site, and says "you pick — we'll ship it."

## The Ideal Loop (what the user experiences)

1. **Invoke** — inside their project, the user (or their agent) says "let's choose fonts." No setup, no account.
2. **Understand** — the tool reads the project: what framework, what fonts are in play now, what kind of site this is. (This is where it can call impeccable — let it audit and say "you're on Inter/Geist, here's what reads generic." We consume that as input, not as the answer.)
3. **Curate a set, not an answer** — it proposes ~5 concrete directions, each a real, tasteful pairing (display / body / mono) with a name, a vibe label ("editorial," "technical," "warm-humanist"), and a one-line rationale. Opinionated, never a 1,500-font dump.
4. **The choosing moment** — it opens a live preview of their actual site, their real content, rendered in each direction. Flip through with arrow keys, before/after toggle against current, pin two to compare side-by-side, "more like this one." This is the part that does not exist anywhere today.
5. **Pick** — the human commits to one (or a heading from A, a body from B).
6. **Ship** — the choice hands back to the agent, which writes the real implementation into the codebase (next/font + Tailwind + fallback). Human kept the taste decision; agent did the typing. Reversible — re-run anytime.

**One-sentence pitch:** "You stayed in the loop for the only part that needed you — the taste — and the agent did everything else."

## The Pieces (tech-lead view, no specs yet)

- **Entry / distribution:** An agent-installable tool — an MCP server + Claude Code / Cursor skill, and/or an npm dev-dependency. The agent installs it and drives it. This is HOW the pick gets "incorporated directly by the agent." It rides the agent wave instead of fighting for Chrome-store installs.
- **Understanding:** Reads framework, current fonts, content, site type. This is basically what gamut-engine already does (static parsing of a Next.js project) — real reuse. Optionally shell out to impeccable for the audit.
- **Curation engine:** Turns "this site + this vibe" into N concrete pairings with rationale. Backed by a hand-curated catalog (the human-taste asset / the moat) + LLM only for matching and explaining, never for inventing the list.
- **Preview surface (the magic):** Renders the user's real running site in each candidate, live, flippable. Because the agent is local in their project, you mount the preview against their own dev server / own origin → full fidelity, no CORS, fonts swap for real. A local "Font Lab" panel opens in the browser.
- **Decision handoff:** The pick becomes a clean structured selection the agent reads back. Conceptually identical to how gamut-engine exports a structured handoff to gamut-canvas — you already have this pattern in-house.
- **Implementation:** Agent writes next/font + Tailwind; tool supplies the exact snippet so it's reliable, not guessed. This closes the loop nobody else closes.

**Technical crux to flag early:** the preview must render their own content in context, and the cleanest way to get that for free is to run inside their project against their local dev server. That single decision is what makes "preview on your real site" achievable without expensive headless infrastructure — and it's why the dev-tool / agent form factor beats the bookmarklet for the core product (the bookmarklet space is commoditized anyway).

## Where Impeccable Fits (complement, not compete)

Frame it as a stack, not a rivalry:

- **impeccable = the floor.** Structure, rules, "this is generic, here's a direction." It's a critic.
- **Font Lab = the ceiling.** It takes a direction — impeccable's or its own — and gives the human the choosing moment, then ships the pick. It's a chooser.

You can literally consume impeccable's audit as one input to step 2/3 and credit it. That makes you interoperable with a tool people already install, instead of trying to displace it.

## The Ideal Beyond V1 (so we build the slice in the right direction)

The wedge is fonts, but the pattern — "curated options → choose on your real site → agent ships it" — generalizes to every taste-driven axis. The honest framing of the company is a **TASTE / DECISION LAYER for AI-built software**:

- **More axes, same loop:** color, spacing/density, radius, component style, motion. Fonts prove it; these expand it.
- **Taste memory:** it learns your picks ("you keep choosing editorial serifs") and curates better sets over time — a moat that compounds per-user.
- **Second opinion / share:** a preview link to send a partner or client to weigh in. (This is the natural — and only — candidate for the one paid, hosted piece later; everything else stays free and local, which keeps costs near zero.)

Keep these as the north star, but don't build them yet.

## The Slice That Makes It Real (where we'd start)

- **Fonts only,** on Next.js + Tailwind (your own stack — [jack-mcgovern.com](https://jack-mcgovern.com) is the test bed).
- **Entry:** an agent skill/command + a small local tool the agent installs.
- **Curated set:** ~5 hand-picked directions over a ~40-font catalog.
- **The magic:** a local Font Lab panel that renders your running dev site in each direction — flip-through + before/after vs. current.
- **Pick → agent writes next/font + Tailwind.** Loop closed.
- **Optional:** call impeccable to seed the directions, proving the "we make impeccable's advice choosable" story.

That slice is the smallest thing that delivers the choosing moment AND the ship-it loop — i.e., it lands in the empty seam, not the crowded one.
