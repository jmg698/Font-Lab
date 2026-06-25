# spike/m0 — the go/no-go spike

Throwaway code that proves Font Lab's two load-bearing claims before we build anything
structural. Results and the verdict live in [`RESULTS.md`](./RESULTS.md). The fixture it
drives is [`examples/sample-next-site`](../../examples/sample-next-site) (Next.js 16 +
Tailwind v4 + Turbopack).

## Run it

```bash
pnpm install                 # in spike/m0 (playwright, @capsizecss/metrics, pixelmatch, pngjs)
npx playwright install chromium
bash spike/m0/run.sh         # from the repo root
```

Outputs land in `spike/m0/out/`:
- `parity-report.json` — pixel diff of `/ship` vs `/preview` (expect 0 mismatch)
- `compare-report.json` — our computed overrides vs next/font's emitted CSS (expect match)
- `hmr-report.json` — the font swap before/after a Fast Refresh (expect `pass: true`)
- `ship.png` / `preview.png` / `diff.png`, `hmr-before.png` / `hmr-after.png` (gitignored)

## What each script does

| file | role |
|---|---|
| `gen-fonts.mjs` | reproduces next/font's adjusted-fallback `@font-face` for Fraunces from `@capsizecss/metrics`; writes the candidate CSS the `/preview` route + dev panel use |
| `compare.mjs` | extracts next/font's real emitted overrides from the build, checks they match, stages the basic-latin Fraunces woff2 into `public/fontlab/` |
| `screenshot-parity.mjs` | Playwright: screenshots `/ship` and `/preview`, pixel-diffs them |
| `hmr-test.mjs` | Playwright: flips the panel to Fraunces, edits `page.tsx` to force Fast Refresh, asserts the swap survived |
| `run.sh` | runs all of the above end to end and prints PASS/FAIL |

## Where the real (non-throwaway) bits live in the fixture

- `app/_fontlab/FontLabDevPanel.tsx` — the dev-only, Shadow-DOM, `:root`-swapping panel
- `app/_fontlab/generated-fonts.ts` — generated parity CSS (the `gen-fonts.mjs` output)
- `app/ship/page.tsx` / `app/preview/page.tsx` — the two parity routes
- `app/layout.tsx` — the **gated dynamic import** that keeps the panel out of prod
