# Spike: click-to-edit copy on agentic Next sites

> **Throwaway de-risk spike.** Question: can a human click any words on their *own running*
> Next site and just retype them — and have the change land in the real source, reversibly —
> with **no platform lock-in** (no Lovable, no proprietary host) and **no build config**?
>
> **Verdict: yes.** Proven end-to-end on the real `examples/sample-next-site` under the exact
> stack Font Lab targets — **Next 16.2 + Turbopack + React 19.2**.

This is the natural extension of Font Lab's two-mechanism architecture. Fonts: *live in-app
preview → reversible source write-back*. Copy is the same machine pointed at words instead of
type. The tagline ports cleanly: **the human writes the words; the agent does the wiring.**

## What was de-risked (and how to re-run it)

The whole pipeline is: **clicked DOM node → its source location → reversible edit of that
line → visible in the browser → undo.** Each link is proven by a runnable script.

| # | Question | Script | Result |
|---|----------|--------|--------|
| 1 | Can we write one rendered string back to the exact source literal, reversibly, and *refuse* the unsafe cases? | `node edit-codegen.test.mjs` | **13/13 pass** — unique edits, string-literal exprs, per-segment edits beside inline markup, duplicate-phrase refusal, dynamic-text refusal, restore-on-failure, byte-exact undo |
| 2 | Does React 19 still expose a per-node source location at runtime? | `node verify-mapping.mjs` | **No** — `_debugSource` was removed in React 19 (important finding) |
| 3 | …but is it *recoverable* from what React 19 does expose? | `node resolve-source.mjs` | **Yes, exactly** — `_debugStack` → JSX call-site frame → dev source map → `Article.tsx:12 / :54 / :39`, all spot-on |
| 4 | Does the whole loop work on the real running site? | `node e2e.mjs` | **4/4 pass** — resolve h1 → edit `Article.tsx` → browser shows new words after HMR → undo restores |
| 5 | Is it *intuitive* for a human (the actual goal)? | `node demo.mjs` → `shot-*.png` | hover-highlight → click → type → Enter saves. `saved ✓ Article.tsx:13` |

### How to run the live ones (2, 3, 4, 5)

```bash
# terminal A — the user's own dev server (nothing special)
cd examples/sample-next-site && npm install && npm run dev

# terminal B — the spike
cd spike/text-edit && npm install
node server.mjs --project ../../examples/sample-next-site &   # write-back endpoint
node e2e.mjs        # full pipeline proof
node demo.mjs       # drives the panel, writes shot-1..5.png
```

## The key finding: React 19 changed how this works

The obvious approach (read `element._debugSource`, like React DevTools used to) **is dead** —
React 19 removed it. We discovered the replacement empirically: every element's fiber carries
`_debugStack`, an `Error` captured at the `jsxDEV` call site. The frame just below the
`jsxDEV` top frame is the JSX element's location in *bundled* coordinates:

```
at exports.jsxDEV ( …/_04g2duo._.js:433:33)      ← react internal, skip
at Article         ( …/_04g2duo._.js:26:215)     ← the <h1> call site (bundled)
```

Turbopack already serves dev source maps, so resolving `26:215` against `_04g2duo._.js.map`
gives `app/_components/Article.tsx:12:7` — the exact `<h1>`. **Zero build config**, which keeps
the "we are the origin, no bundler plugin" ethos from `ARCHITECTURE.md`. The runtime locator
lives in `panel.browser.js` / `TextEditPanel.tsx`; the source-map resolution lives server-side
in `server.mjs` so the panel ships no heavy machinery.

## Files

- `edit-codegen.mjs` — the write-back engine (ts-morph, backup-first, verify, undo). Mirrors
  `cli/codegen.mjs` conventions. **The moat half.**
- `server.mjs` — localhost `/edit` + `/undo` endpoint. Resolves the call-site frame via source
  map, then applies. Sibling of `cli/font-lab.mjs`'s `/select`.
- `panel.browser.js` — the injectable click-to-edit UX (toggle, hover-highlight, contentEditable,
  Enter-to-save, Esc-to-cancel). What the demo injects.
- `TextEditPanel.tsx` — the **production shape**: a dev-only React component to drop next to
  `FontLabDevPanel`, behind the same `NODE_ENV` guard. Same algorithm as `panel.browser.js`.
- `*.test.mjs`, `verify-mapping.mjs`, `resolve-source.mjs`, `e2e.mjs`, `demo.mjs` — the proofs.
- `fixtures/Sample.tsx` — covers every case the engine must handle.

## Honest limitations (the ceiling, stated plainly)

These are *known and deliberately scoped out* — not surprises. The spike soft-degrades on each
(refuse + explain) rather than guessing, matching `REDESIGN.md`'s "never hard-block" principle.

1. **Dynamic text is not editable in place.** `{post.title}`, `{t('hero.headline')}`, `.map()`'d
   lists — the words come from data, not a JSX literal. The panel marks these *"comes from data —
   not directly editable."* This is the real ceiling; tracing copy back to a CMS/i18n source is a
   separate, larger problem.
2. **Rich inline markup** (`Hello <strong>world</strong>`) — the panel edits only single-text-node
   elements for now. The *engine* already supports per-segment edits (test #5); wiring a click
   inside mixed markup to the right segment is the follow-up.
3. **Relies on dev source maps + `_debugStack`.** True for Next 16 + Turbopack + React 19 (proven
   here). Other stacks (Vite, webpack, older React) need re-verification; if a stack lacks runtime
   source info, the **string-search fallback** in `edit-codegen.mjs` (`findPhrase`) handles unique
   phrases with zero runtime introspection.
4. **Source-map column drift.** Resolution landed exactly on every element tested; `elementAt`
   tolerates ±1 column and picks the nearest tag on the line as a guard.

## If we productionize

- Fold the engine into `cli/codegen.mjs` as a `text` edit kind reusing its backup/undo machinery,
  and add `/edit` to the existing `cli/font-lab.mjs` server (don't run a second port).
- Ship `TextEditPanel` via `font-lab init` alongside `FontLabDevPanel`, same dev-only guard.
- Append edits to a `.font-lab/edits.log.jsonl` for the same reversible, auditable trail as picks.
- Decide the positioning question: does Font Lab widen from "typography decision surface" to
  "edit your real running site, reversibly" (copy now; colors/spacing later)? That's a product
  call, not an engineering one — the engineering works.
