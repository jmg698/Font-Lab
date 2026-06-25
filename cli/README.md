# cli — the Font Lab loop (M1 walking skeleton)

The first real (non-throwaway) slice: the whole loop runs end to end. The human flips
between curated directions on their own running site and picks one; the pick is written to
`.font-lab/selection.json` — the seam the agent reads to ship the real code (M4).

> **Status: M1 + M2 + M3 PASS.**
> - **M1** (`cli/run-m1.sh`, 16/16): arrow-flip, live display+body+mono swap, Pick →
>   `selection.json`, re-pick appends to `picks.log.jsonl`.
> - **M2** (`cli/run-m2.sh`, 19/19): `selection.json` → real `next/font` + Tailwind edits
>   that **build** and **render** the picked fonts, applied **idempotently** and
>   **reversibly** (backup-first undo, byte-identical restore). The link nobody else closes.
> - **M3** (`cli/run-m3.sh`, 55/55): the **real analyzer** reads framework, App vs Pages
>   Router, Tailwind v3 vs v4, current fonts per role, and font wiring — and feeds both the
>   codegen branch selection and the panel's before/after. Verified on the in-repo fixtures
>   **and the real jack-mcgovern.com site**, where it correctly reads `Bricolage Grotesque /
>   Hanken Grotesk` on `<body>` and codegen **adopts** those project variables to ship a
>   building, reversible swap. Out-of-branch projects (v3 / Pages / hardcoded) are refused
>   with a clear reason.
>
> Evidence in `cli/out/{m1,m2,m3}-report.json` (+ `cli/out/jack-applied.*` — the actual code
> Font Lab generated for the real site). Runs on Next 16 + Tailwind v4 + Turbopack.

### Dogfood note — what jack-mcgovern.com taught us (M3)

Applied into the real site, Font Lab **builds and renders**: body fonts swap
Hanken Grotesk → Libre Franklin everywhere they show. The headings keep rendering the body
font *both before and after* — because the site's own `@layer base { h1,h2,h3 { font-family:
var(--font-display) } }` never resolves (Tailwind v4's `@theme inline` doesn't emit
`--font-display` as a `:root` variable; only the `font-display` *utility* derefs it). Font
Lab **preserved that behavior faithfully** rather than silently "fixing" it — exactly the
honesty the WYSIWYG promise requires: we swap the families through the project's own wiring
and change nothing else.

## Run it

```bash
cd cli && pnpm install            # @capsizecss/metrics + playwright
bash cli/run-m1.sh                # from the repo root
```

`run-m1.sh` builds the parity catalog, starts the fixture dev server, and drives the loop
with a headless browser, asserting the pick lands on disk. Verdict + assertions in
`cli/out/m1-report.json`.

## Use it by hand

```bash
node cli/analyze.mjs --project <your-project>             # what Font Lab sees (read-only)
node cli/analyze.mjs --project <your-project> --json      # machine-readable analysis
node cli/gen-catalog.mjs                                   # self-host fonts + build catalog
cd examples/sample-next-site && pnpm dev                   # your dev server
node cli/font-lab.mjs --project examples/sample-next-site  # the pick endpoint (:7777)
```

Then open the dev site: a panel (bottom-right) shows the current state + two directions.
`←`/`→` flip the active direction (display + body + mono swap live on your real content);
`Enter` or **Pick** writes the selection.

### Ship the pick (M2)

```bash
node cli/apply.mjs --project <your-project>   # selection.json -> next/font + Tailwind edits
node cli/undo.mjs  --project <your-project>   # restore the files Font Lab last edited
```

`apply` edits `app/layout.tsx` (ts-morph: merges the next/font import, rewrites the
font consts in a fenced block, merges the `<html>` className) and `app/globals.css`
(a fenced `@theme` block), backing up every touched file first. Re-running is idempotent;
`undo` restores byte-for-byte. Run `font-lab --apply` to ship a pick the moment it's made.

## Pieces

| file | role |
|---|---|
| `analyzer.mjs` | **the analyzer (M3):** pure, read-only audit of a project — framework, router, Tailwind version, current fonts per role, and wiring. Traces the CSS custom-property graph from `--font-*` back to the next/font const that feeds it |
| `analyze.mjs` | thin CLI around the analyzer (`--project`, `--json`) |
| `directions.mjs` | the two hand-authored directions + the fonts they use (source of truth) |
| `gen-catalog.mjs` | self-hosts each Google font and computes next/font's exact adjusted fallback (M0-proven parity); runs the analyzer to bake the **real** `current`/`target` into `app/_fontlab/catalog.generated.ts` |
| `font-lab.mjs` | the CLI: the localhost write-back endpoint (`POST /select` → `.font-lab/selection.json` + `picks.log.jsonl`); `--apply` ships on pick |
| `codegen.mjs` | the ship engine (M2+M3): `applySelection` / `undo` — analyzer-gated branch selection, ts-morph + fenced markers, backup-first. Handles both the role-var path and the **adopt-existing-variable** path (real sites) |
| `apply.mjs` / `undo.mjs` | thin CLI wrappers around the ship engine |
| `loop-test.mjs` / `apply-test.mjs` / `m3-test.mjs` | headless e2e of the loop (M1), the ship engine (M2), and the analyzer + branch selection on the fixtures and the real jack site (M3) |
| `run-m1.sh` / `run-m2.sh` / `run-m3.sh` | builds catalog + runs the loop test; applies + builds + renders + checks idempotency/reversibility; analyzer + codegen structural checks |

## The contract it writes

`.font-lab/selection.json` follows the schema in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md): `direction`, `roles` (display/body/mono with
family/source/weights), `replaces` (current fonts), and `target` (framework/router/Tailwind
version/wiring). `picks.log.jsonl` appends every pick — the taste-memory stream the roadmap
starts capturing at M1.
