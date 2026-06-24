# Font Lab — Ship Spec (codegen)

> How `.font-lab/selection.json` becomes real, applied, reversible code in an arbitrary
> Next.js + Tailwind project. This is the link every competitor drops; it's the reason
> Font Lab is a *chooser that ships* and not another previewer. Companion to
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the `codegen` package).

## Strategy in one line

**AST as the engine, markers as the contract, backups as the safety net.** ts-morph does
the surgical `.tsx` edits; fenced marker comments own the append-only CSS/config regions;
a backup written before any edit guarantees a clean undo even for a user who never commits.

## Why this split

| Edit kind | Tool | Why |
|---|---|---|
| `.tsx` (imports, JSX `className`) | **ts-morph (AST)** | Must *merge into code the user already owns* — add a named import to an existing `next/font` import without duplicating; merge a `variable` token into an existing `<html className>` without clobbering. String/marker edits can't do this safely. This is how shadcn/ui's CLI works. |
| CSS / Tailwind config | **fenced markers** | These are append-only regions (`@theme` block, a `fontFamily` key). Markers (`/* font-lab:start … end */`) are simpler, human-auditable in a diff, and trivially removable. AST buys nothing here. |

Rule of thumb: **merge → AST; append → markers.**

## The Tailwind v3 vs v4 branch

The analyzer reports the version; codegen never guesses. (Detection: `@import
"tailwindcss"` + `@tailwindcss/postcss`/`@tailwindcss/vite` + `tailwindcss@^4` → v4;
`@tailwind base` directives + a `tailwind.config.*` + `tailwindcss@^3` → v3. Don't infer v3
from config-file presence alone — v4 projects can keep a legacy config.)

**Tailwind v3** — edit `tailwind.config.{js,ts}`, merging `theme.extend.fontFamily`:
```js
theme: { extend: { fontFamily: {
  sans:    ['var(--font-sans)',    'ui-sans-serif', 'system-ui', 'sans-serif'],
  display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
  mono:    ['var(--font-mono)',    'ui-monospace', 'SFMono-Regular', 'monospace'],
} } }
```

**Tailwind v4** — edit the CSS entry (`app/globals.css`), after `@import "tailwindcss";`:
```css
/* font-lab:start hash=<h> */
@theme inline {
  --font-display: var(--font-display);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}
/* font-lab:end */
```
> **`@theme inline` is mandatory** for the next/font case. Plain `@theme` *snapshots* the
> variable's value at build time; `inline` emits `font-family: var(--font-sans)` into the
> utility so it dereferences next/font's runtime variable. Plain `@theme` silently breaks
> the wiring. To avoid name-collision confusion, generated code may give next/font a
> distinct variable (`--font-geist`) and map `--font-sans: var(--font-geist)`.

## App Router vs Pages Router

| Router | Declare fonts in | Apply the variable class on |
|---|---|---|
| **App** | `app/layout.tsx` | `<html>` (preferred — puts the var in `:root` scope) or `<body>` |
| **Pages** | `pages/_app.tsx` | a top-level wrapper element in `_app.tsx` |

**Never target `pages/_document.tsx`** for the variable — the Next.js docs example for that
is known-broken (the variable isn't defined early enough). The Tailwind mapping (v3 config
or v4 `@theme inline`) is identical regardless of router; only the declaration site moves.

## Idempotency (re-run to change the font ⇒ update, never stack)

Everything is a pure function of `selection.json` plus a stable region identity.

- **Marker regions:** scan for `font-lab:start … font-lab:end`. Found → replace the body
  in place and update the embedded `hash`. Absent → insert. (The blockinfile model.) An
  unchanged hash makes the run a no-op — a clean re-run produces a zero diff.
- **AST regions:** identity is structural. Font consts get stable namespaced names
  (`fontLabDisplay`, `fontLabBody`); on re-run we find and mutate their constructor args
  rather than appending new ones. className tokens are deduped so `${fontLabDisplay.variable}`
  appears exactly once.

Changing Fraunces → Söhne edits the font const's `family`/`weight` and the `@theme` value,
and touches nothing else — no duplicate imports, no stacked className tokens.

## Reversibility (safe for a vibe-coder who hasn't committed)

Three independent undo paths; the safest one requires nothing of the user.

1. **Backup-first — always on, the default.** Before any write, copy each target file to
   `.font-lab/backups/<runId>/<relpath>` and write a `manifest.json` (paths + pre-edit
   sha256 + runId). `font-lab undo` restores from the latest backup, warning if the file's
   current hash differs from what we wrote (i.e. the user edited since). Works with no git,
   a dirty tree, anything.
2. **Git-aware — record-only when a repo exists.** Capture HEAD sha + cleanliness in the
   manifest as a cross-check. **Do not require a clean tree** and **do not auto-commit** by
   default — silently committing someone's dirty tree is a worse surprise than the edit.
   Offer `--commit` for users who want a checkpoint.
3. **Self-removing markers — the third path.** Because every owned CSS/config region is
   fenced, `undo --markers` can strip them even if backups were deleted. (Best-effort; an
   AST className merge can't be perfectly fenced, which is why backups stay primary.)

## The apply plan (common case: App Router + Tailwind v4, fresh fonts)

Each step is reversible via the step-0 backup; AST/marker identity makes each idempotent.

0. **Snapshot.** Resolve targets (`app/layout.tsx`, `app/globals.css`). Copy each to
   `.font-lab/backups/<runId>/`; write the manifest (+ git HEAD if present).
1. **Import (AST).** Find an existing `next/font/google` import; add the needed named
   specifiers, or create the import. Merge, never duplicate.
2. **Font consts (AST + marker fence).** Insert/replace a fenced region declaring
   `fontLabDisplay`, `fontLabBody`, `fontLabMono` with `subsets`, `variable`, `weight`,
   `display: 'swap'`.
3. **className wiring (AST).** Locate the `<html>` element; merge
   `${fontLabDisplay.variable} ${fontLabBody.variable} ${fontLabMono.variable}` into its
   `className` (convert a static string to a template literal if needed; dedupe tokens).
4. **CSS `@theme inline` (markers + string).** Insert/replace the fenced block after
   `@import "tailwindcss";`.
5. **Format.** Run the project's Prettier/ESLint on touched files; re-scan markers to
   confirm they survived (they're comments, so they do).
6. **Verify + report.** Re-parse `layout.tsx` (ts-morph diagnostics) to confirm it still
   compiles. Print files changed, the swap (e.g. Inter → Fraunces/Inter), the backup
   location, and the `font-lab undo` hint. **On any failure after step 0, auto-restore from
   the backup and exit non-zero** — the tree is never left half-edited.

Ordering rationale: import before const (const references the import); const before
className (className references the const's `.variable`); CSS mapping last (it depends only
on the variable names chosen in step 2).

## Edge cases that will actually bite

| Case | Detection | Handling |
|---|---|---|
| Project already imports `next/font` | AST finds the import | **Merge.** Adopt an existing `--font-*` variable name rather than introducing a competitor; rewrite its constructor args. Record the replaced family in `selection.replaces`. |
| `next/font/local` | import is `next/font/local` | Re-point the CSS variable to the new (Google) font; **don't delete** the user's local font or relocate files. Flag it in the report. |
| Hardcoded `font-family` (no variable) | analyzer `fontWiring: "hardcoded"` | Lower-fidelity path: introduce the variable + a fenced override (`font-family: var(--font-sans), <original stack>`), or append a high-specificity override block and warn. Always reversible via markers. |
| Pages Router | `pages/_app.tsx`, no `app/` | Declare in `_app.tsx`, apply the class on a wrapper element — never `_document.tsx`. |
| JS vs TS config | file extension | Use the JS parser for `.js`, ts-morph for `.ts`. |
| `className` is `cn(...)` / template literal / spread | AST node type | Template literal → append a token (dedup). `cn`/`clsx` → add an argument. Static string → convert to template literal. Spread/dynamic → append a marker note + warn rather than guess. |
| Font lacks capsize metrics | catalog coverage flag | Don't offer it for ship (or supply measured metrics via fontkit). A hard gate — uncovered fonts throw `"Failed to find font override values"` at build. |
| No clean place / parse failure | AST throws | Abort and write nothing (the step-0 snapshot guarantees the abort is clean). |

## Open questions to validate against real projects

- Exact chunk-elision behavior of the dev panel under Turbopack vs webpack (the *render* is
  reliably DCE'd; confirm the panel's *code chunk* is also dropped from prod).
- `next/font/local` re-pointing (leave the local font, remap the variable) is a design
  choice, not an established convention — validate on real repos.
- Per-font capsize coverage in `next/dist/server/capsize-font-metrics.json` — enumerate it
  before finalizing the catalog.
