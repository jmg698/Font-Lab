# Font Lab

[![npm version](https://img.shields.io/npm/v/font-lab.svg)](https://www.npmjs.com/package/font-lab)
[![npm provenance](https://img.shields.io/badge/npm-provenance-blue.svg)](https://docs.npmjs.com/generating-provenance-statements)
[![license: MIT](https://img.shields.io/npm/l/font-lab.svg)](https://github.com/jmg698/Font-Lab/blob/main/LICENSE)

**Pick the fonts. Fix the words. Your agent does the work.**

Font Lab is a real-time typography and content editor for AI-built sites. Your agent installs it, composes curated font directions from ~1,500 Google fonts and distinctive open-foundry faces, and renders them live on your real site. You pick the one you like. The agent ships the exact `next/font` + Tailwind code — reversibly.

Every AI-built site ends up with Inter or Geist because the agent never stops to let you choose. Font Lab is the stop-to-choose.

> The taste stays human.

## Install

Inside a Next.js + Tailwind project — or just ask your agent *"install Font Lab"*:

```bash
npx font-lab install
```

Works with: **Claude Code** · **Cursor** · **VS Code** · **Codex** · **Windsurf** · **Gemini CLI**
For: **Next.js** (App Router) + **Tailwind v4** sites

Install auto-detects which agents you have and wires them all — skill, MCP server, config, each in the right format. On an unsupported stack, Font Lab **refuses with a clear reason** rather than half-applying a change.

## How it works

1. **Ask.** Font Lab asks what you're going for — what feeling, how bold a departure, a brand to evoke or avoid — so the directions are tailored to you, not a generic default.
2. **Compose.** Your agent composes a small set of font directions (display + body + mono, each with a rationale), reaching past the overexposed AI defaults. A built-in anti-generic rubric rejects menus that are all Inter/Geist/Space Grotesk.
3. **Pick.** You compare them on your own site — screenshots in chat (works on web or phone) or a live flip/mix/compare panel locally. **You always make the pick.**
4. **Ship.** The agent writes the real `next/font` + Tailwind code. Every change is reversible.

## The panel

The Font Lab panel sits on top of your running site — your real pages, your real content — and lets you change fonts and words in real time.

- **Flip through directions** with arrow keys — see each pairing on your actual content across multiple routes
- **Mix roles** — heading from one direction, body from another — and save the mix as its own direction
- **Before/after** — hold `B` to peek at your current fonts; tap `space` to snap between your two finalists
- **Inspect** — hover any text to see its role, typeface, size, and how many elements share it
- **Edit words** — double-click any text, retype it, and it saves straight to your source files
- **Change receipts** — see exactly what changed across the page after every edit
- **Undo everything** — every modification ships with a reversal command

The panel runs headless too: the agent screenshots your site in each direction and shows you the images in chat. Works on a phone, on the web, anywhere your agent runs.

## Honesty

Font Lab's core promise is **preview == ship**: what you see in the panel is what the codegen writes.

- **Guaranteed** fidelity for every font the gate admits — or an honest "may render slightly differently" badge when it can't be byte-for-byte.
- Refuses unsupported stacks rather than guessing. That's not a limitation — it's the contract.
- Text sourced externally triggers an explicit notice, never a silent edit.
- The human's pick overrides everything.

## Contributing & testing

Testers are the point — especially "it did the wrong thing on *my* repo" reports. The analyzer output is the most useful thing you can include.

- [Issue forms](https://github.com/jmg698/Font-Lab/issues/new/choose) — bugs and "support my stack" requests
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — code contributions and how to run the tests
- [`SECURITY.md`](./SECURITY.md) — security issues

## Going deeper

- [`cli/README.md`](./cli/README.md) — the full user guide: install flags, the agent loop, hand-use commands, every keyboard shortcut
- [`docs/CONCEPT.md`](./docs/CONCEPT.md) — the vision and the core belief
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — how the choosing moment works and the `selection.json` contract
- [`docs/SHIP-SPEC.md`](./docs/SHIP-SPEC.md) — how a pick becomes real, reversible code
- [`docs/PRODUCT.md`](./docs/PRODUCT.md) · [`docs/PANEL-VISION.md`](./docs/PANEL-VISION.md) — product and brand context

---

**Open source · MIT** · Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — every release is traceable to this repo and commit. Built and dogfooded on [jack-mcgovern.com](https://jack-mcgovern.com).
