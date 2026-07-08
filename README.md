# Font Lab

A **decision surface** for typography in AI-built software. AI removed the labor of
implementation but deleted the moment of choice — and taste only happens at the moment
of choice. Font Lab re-inserts **the choosing moment**: it hands a human a curated set
of font directions, rendered live on their *real* running site, lets them pick, and the
agent ships the implementation.

> The human keeps the taste decision; the agent does the typing.

## Try it

Inside a Next.js + Tailwind project — or just ask your coding agent *"install Font Lab"*:

```bash
npx font-lab install
```

Then tell your agent *"pick better fonts for this site."* It shows you tasteful directions
rendered on your own site (as screenshots anywhere, or a live flip/compare panel locally),
**you pick**, and it ships the exact `next/font` + Tailwind code — reversibly. Full walkthrough
and hand-use commands in [`cli/README.md`](./cli/README.md).

## Why it exists

Every AI-built site looks the same: Inter, Geist, Space Grotesk. Not because those are the
right choice — because they're the *default*, and nobody stopped to choose. Font Lab is the
stop-to-choose. It curates distinctive, **shippable** directions (reaching past the overexposed
defaults), renders them on your real content, and — the part nobody else closes — ships exactly
what you picked. Its core promise is **honesty about fidelity: what you preview is what ships**,
and when it can't be byte-for-byte, it says so plainly.

## Supported today

Font Lab v1 is deliberately narrow, because that's where it can *guarantee* preview == ship:

| Works today | Not yet |
|---|---|
| **Next.js**, App Router | Pages Router, other frameworks (Vite, Astro, …) |
| **Tailwind v4** | Tailwind v3 |
| Fonts wired through **CSS variables** (`next/font`) | Hardcoded `font-family`, other font setups |

On an unsupported project Font Lab **refuses with a clear reason** rather than half-applying a
change — that's the honesty, not a bug. On the wrong stack? Open a
["support my stack" request](https://github.com/jmg698/Font-Lab/issues/new/choose) and 👍 — that's
how we decide what to widen next.

## How it works

1. **Ask first.** Font Lab analyzes your project and asks what you're going for (what feeling?
   how bold a departure? a brand to evoke or avoid?) — so the options are tailored to you.
2. **Curate.** It composes a small set of directions (display + body + mono, each with a
   rationale), reaching past the AI defaults. Any of ~1,500 Google fonts is fair game — each one
   is verified to ship before it's offered.
3. **Choose.** You compare them on your own site — screenshots in chat (works on web or phone) or
   a live flip/mix/compare panel locally. **You always make the pick.**
4. **Ship.** The agent writes the real `next/font` + Tailwind code and can undo it cleanly.

## Contributing & testing

It's a free tool and testers are the point — especially "it did the wrong thing on *my* repo"
reports. Bugs and stack requests go through the
[issue forms](https://github.com/jmg698/Font-Lab/issues/new/choose) (the analyzer output is what
we need most); code contributions and how to run the tests are in
[`CONTRIBUTING.md`](./CONTRIBUTING.md); security issues in [`SECURITY.md`](./SECURITY.md).

## Going deeper

Design notes and the decision log behind the build — useful if you're contributing to the
analyzer or codegen, skippable if you just want to use the tool:

- [`cli/README.md`](./cli/README.md) — the full user guide: install, the loop, hand-use commands.
- [`CONCEPT.md`](./CONCEPT.md) — the vision and the core belief (the *why*).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the choosing moment works and the `selection.json` contract.
- [`SHIP-SPEC.md`](./SHIP-SPEC.md) — how a pick becomes real, reversible code (the link nobody else closes).
- [`ROADMAP.md`](./ROADMAP.md) — what's built and what's next.
- [`CRITIQUE.md`](./CRITIQUE.md) — the teardown and decisions behind the plan.

---

**Status:** the v1 slice is complete and published to [npm](https://www.npmjs.com/package/font-lab)
with provenance — analyze → curate → choose → ship, end to end, proven on a real production site
(jack-mcgovern.com). Built and dogfooded in the open.
