# cli — the Font Lab loop (M1 walking skeleton)

The first real (non-throwaway) slice: the whole loop runs end to end. The human flips
between curated directions on their own running site and picks one; the pick is written to
`.font-lab/selection.json` — the seam the agent reads to ship the real code (M4).

> **Status: M1 PASS** — `cli/run-m1.sh` drives the loop headlessly with 16/16 assertions
> green (arrow-flip, live display+body+mono swap, Pick → `selection.json`, re-pick appends
> to `picks.log.jsonl`). Evidence in `cli/out/m1-report.json`. Runs on Next 16 + Tailwind
> v4 + Turbopack; the panel/catalog are gated out of production builds.

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
node cli/gen-catalog.mjs                                   # self-host fonts + build catalog
cd examples/sample-next-site && pnpm dev                   # your dev server
node cli/font-lab.mjs --project examples/sample-next-site  # the pick endpoint (:7777)
```

Then open the dev site: a panel (bottom-right) shows the current state + two directions.
`←`/`→` flip the active direction (display + body + mono swap live on your real content);
`Enter` or **Pick** writes the selection.

## Pieces

| file | role |
|---|---|
| `directions.mjs` | the two hand-authored directions + the fonts they use (source of truth) |
| `gen-catalog.mjs` | self-hosts each Google font and computes next/font's exact adjusted fallback (M0-proven parity); writes `app/_fontlab/catalog.generated.ts` |
| `font-lab.mjs` | the CLI: the localhost write-back endpoint (`POST /select` → `.font-lab/selection.json` + `picks.log.jsonl`) |
| `loop-test.mjs` | headless e2e of the whole loop |
| `run-m1.sh` | builds catalog, starts dev server, runs the loop test |

## The contract it writes

`.font-lab/selection.json` follows the schema in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md): `direction`, `roles` (display/body/mono with
family/source/weights), `replaces` (current fonts), and `target` (framework/router/Tailwind
version/wiring). `picks.log.jsonl` appends every pick — the taste-memory stream the roadmap
starts capturing at M1.
