# Font Lab

[![npm version](https://img.shields.io/npm/v/font-lab.svg)](https://www.npmjs.com/package/font-lab)
[![npm provenance](https://img.shields.io/badge/npm-provenance-blue.svg)](https://docs.npmjs.com/generating-provenance-statements)
[![license: MIT](https://img.shields.io/npm/l/font-lab.svg)](https://github.com/jmg698/Font-Lab/blob/main/LICENSE)

**Pick the fonts. Fix the words. Your agent does the work.**

Font Lab is a real-time typography and content editor for AI-built sites. Your agent installs it, composes curated font directions from ~1,500 Google fonts and distinctive open-foundry faces, and renders them live on your real site. You pick the one you like. The agent ships the exact code for your stack — `next/font` + Tailwind on Next.js, self-hosted `@font-face` everywhere else — reversibly.

Every AI-built site ends up with Inter or Geist because the agent never stops to let you choose. Font Lab is the stop-to-choose.

> The taste stays human.

## Install

Inside your project — or just ask your agent *"install Font Lab"*:

```bash
npx font-lab install
```

Works with: **Claude Code** · **Cursor** · **VS Code** · **Codex** · **Windsurf** · **Gemini CLI**
For: **any framework with a CSS seam** — Next.js gets the full live-panel experience; everything else ships through the same engine (see the matrix below).

Install auto-detects which agents you have and wires them all — skill, MCP server, config, each in the right format. On a stack with no seam at all, Font Lab **refuses to half-apply** and hands you the generated code with a clear reason instead.

Newly registered MCP tools load on the next session reload — but the agent never has to wait: every tool also runs as a one-shot CLI, `npx font-lab run <tool> '<json-args>'` (same tool table, same JSON out), so the loop starts the moment install finishes. That's also the fallback whenever an MCP server drops mid-session.

## Frameworks — what ships where

The taste engine, shippability gate, portable preview, and screenshots work on **every** stack. What varies is the preview surface and how the pick lands in your code — `font-lab analyze` prints the exact verdict for your project:

| Your stack | Preview | Auto-ship |
|---|---|---|
| **Next.js App Router + Tailwind v4** | live in-app panel + real-site screenshots | `next/font` + Tailwind codegen |
| **Any framework + Tailwind v4** (Vite, Astro, Remix, SvelteKit, TanStack, …) | real-site screenshots (headless paint) + portable sheet | self-hosted `@font-face` + `@theme` role map in your CSS entry |
| **Any framework + Tailwind v3** (fonts in `tailwind.config` `fontFamily`) | real-site screenshots (headless paint) + portable sheet | self-hosted `@font-face` + utility/Preflight overrides in your CSS entry |
| **No Tailwind, fonts routed through CSS variables** (`--font-body`, `--fd`, …) | real-site screenshots (headless paint) + portable sheet | self-hosted `@font-face` + your own font vars repointed |
| **No seam** (hardcoded `font-family`, CSS-in-JS) | real-site screenshots (headless paint) + portable sheet | hand-apply: Font Lab generates the block, you paste it |

Every auto-ship path is fenced, idempotent, and reversible (`font-lab undo`). **Agents:** read `capabilities` + `shipNote` from `font_lab_analyze` — a non-Next stack is a different route through the same loop, never a reason to stop.

## Upgrading

**Always use `upgrade`, not bare `npm install`.**

```bash
npx font-lab upgrade
```

Font Lab lives in two places: the **npm package** and the **panel code stamped into your project** (`app/_fontlab/`). A bare `npm install font-lab@latest` updates the package but leaves the panel on the old version — which shows a "stale version" warning. `upgrade` moves everything together in one command: package, panel re-stamp, MCP re-pin, and stale-endpoint shutdown.

## How it works

1. **Ask.** Font Lab asks what you're going for — what feeling, how bold a departure, a brand to evoke or avoid — so the directions are tailored to you, not a generic default.
2. **Compose.** Your agent composes a small set of font directions (display + body + mono, each with a rationale), reaching past the overexposed AI defaults. A built-in anti-generic rubric rejects menus that are all Inter/Geist/Space Grotesk.
3. **Pick.** You compare them on your own site — screenshots in chat (works on web or phone) or a live flip/mix/compare panel locally. **You always make the pick.**
4. **Ship.** The agent writes the real code for your stack — `next/font` + Tailwind on Next.js; self-hosted `@font-face` wired through Tailwind's theme, v3 utilities, or your own CSS font variables elsewhere. Every change is reversible.
5. **Finish clean.** Click **done ✓** (or say so) and the agent runs `font_lab_finish`: the dev-panel scaffolding comes out, and you get a git-verified commit plan — your copy edits and font change with ready-to-run commands, nothing of Font Lab's mixed in. The scaffolding and state are self-ignoring in git the whole session, so `git status` was never noisy to begin with.

## The panel

The Font Lab panel sits on top of your running site — your real pages, your real content — and lets you change fonts and words in real time.

- **Flip through directions** with arrow keys — see each pairing on your actual content across multiple routes
- **Mix roles** — heading from one direction, body from another — and save the mix as its own direction
- **Before/after** — hold `B` to peek at your current fonts; tap `space` to snap between your two finalists
- **Inspect** — hover any text to see its role, typeface, size, and how many elements share it
- **Edit words** — double-click any text, retype it, and it saves straight to your source files
- **Change receipts** — see exactly what changed across the page after every edit
- **Undo everything** — every modification ships with a reversal command
- **Done ✓** — one click ends the session cleanly: your agent strips the dev tooling and hands you the exact commit plan

The panel runs headless too: the agent screenshots your site in each direction and shows you the images in chat — a chat-sized hero shot per direction, with the full-page capture behind it. Works on a phone, on the web, anywhere your agent runs.

The live panel is Next-only — but the **real-site preview isn't**. On every other framework, Font Lab paints your actual running pages in each direction (the same render-first census machinery the panel flips with, injected headlessly — no scaffolding, no source writes; preview fonts cache in self-ignored state, so your `git status` stays clean until you actually ship). If no dev server is running, the screenshot tool **starts your project's own dev command itself** — bound to 127.0.0.1, health-checked, stopped after the capture — which is what makes the loop work unattended in cloud/container agents (Claude Code on the web, and friends) where the human can't reach the agent's localhost. With no dev server possible at all, the fallback is the **portable preview**: a self-contained HTML specimen sheet (fonts embedded, opens offline) on your own palette and copy — clearly labeled as specimen cards, never passed off as your pages.

## Honesty

Font Lab's core promise is **preview == ship**: what you see in the panel is what the codegen writes.

- **Guaranteed** fidelity for every font the gate admits — or an honest "may render slightly differently" badge when it can't be byte-for-byte.
- Auto-ships only where the stack has a real seam; anywhere else it hands you the generated code with a clear reason rather than guessing. Never a half-applied change — that's the contract.
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
