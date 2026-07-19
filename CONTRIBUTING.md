# Contributing to Font Lab

Thanks for wanting to help. Font Lab is a small, free tool with a sharp promise — *what you
preview is exactly what ships* — and most of contributing is protecting that promise while making
the tool reach more people and more stacks. This doc gets you running the tests in a couple of
minutes and tells you the few rules that keep the magic honest.

## The shape of the thing

Everything lives in [`cli/`](./cli) — dependency-light ES modules, no build step, Node ≥ 18.

| Piece | File |
|---|---|
| Analyzer (read-only project audit) | `cli/analyzer.mjs` |
| Catalog + curator (parity bundles, deterministic directions) | `cli/catalog.mjs`, `cli/curator.mjs` |
| Ship engine (ts-morph + fenced markers, backup-first undo) | `cli/codegen.mjs` |
| Engine facade + MCP server (the agent-facing surface) | `cli/engine.mjs`, `cli/mcp.mjs` |
| The dev panel (`init` installs it into a real project) | `cli/templates/font-lab-panel.tsx` |

**Two-part versioning:** The npm package and the panel code stamped into a user's project
(`app/_fontlab/`) version independently. A bare `npm install` updates the package but not the
panel — `npx font-lab upgrade` moves both together. If you change the panel template or anything
that affects the stamped version, make sure `upgrade` still re-stamps correctly (the fast gate
covers this).

The deeper design docs live in [`docs/`](./docs) — read
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`docs/SHIP-SPEC.md`](./docs/SHIP-SPEC.md)
before touching the analyzer or codegen.

## Run the tests

The fast suite is pure Node — no browser, no dev server, no network — and it's exactly what CI
runs on your PR. From a fresh clone:

```bash
cd cli
npm install --omit=dev          # ts-morph + capsize only
node codegen-css-test.mjs       # CSS codegen: fenced @theme block, idempotent, removable
node copyedit-test.mjs          # copy-edit write-back: source-map paths, HTML-entity round-trip
node state-test.mjs             # .font-lab hygiene: self-ignoring state dir, capped backups
node commit-plan-test.mjs       # the commit plan: ledger × real git state → ship/scaffold piles
node finish-test.mjs            # finish: self-ignored scaffold, done ✓ handshake, byte-clean unmount
node panel-keys-test.mjs        # panel keymap: every key handled is documented and vice-versa
node m3-test.mjs                # analyzer: framework / router / Tailwind version / wiring
node m4-test.mjs                # catalog + curator: verified capsize coverage, deterministic
node m5-test.mjs                # engine + MCP server over real stdio
```

If you touched the **ship / apply / preview** path, also run the build-and-render proof — it does a
real `next build` of the fixture and pixel-checks the rendered fonts in a browser:

```bash
cd cli
npm install                     # full deps, including playwright
npx playwright install chromium
bash run-m2.sh                  # apply → build → render → idempotent → reversible
```

`run-m6.sh` / `run-m8.sh` drive the live panel in a browser too; `run-m1.sh` runs the whole loop.

## The invariants — don't break these

Font Lab has four load-bearing promises. A change that weakens any of them is a regression even if
every test passes:

1. **The human makes the pick.** The tool curates and ships; it never auto-selects a font.
2. **preview == ship.** Every font offered clears the shippability gate — verified capsize coverage
   *and* single-woff2 variable parity — or is honestly flagged "may render slightly differently."
   No silent best-effort.
3. **Reversible.** Anything that writes into a user's project backs the file up first and undoes
   cleanly, even with no git and a dirty tree.
4. **Honest scope.** v1 is Next.js + App Router + Tailwind v4 + CSS-variable fonts. Unsupported
   projects are *refused with a clear reason*, never half-applied.

The PR template restates these as a checklist — fill it in.

## Sending a change

1. Branch off `main`, keep the PR focused (small and reviewable beats big and sweeping).
2. Match the surrounding style — no new dependencies or build tooling without discussing it first.
3. Run the fast gate (above) before you push; run `run-m2.sh` too if you touched apply/preview.
4. Open the PR against `main` and fill in the template.

## Reporting bugs & requesting stacks

Use the [issue forms](https://github.com/jmg698/Font-Lab/issues/new/choose). For bugs, the
analyzer output is the thing we need most. If Font Lab *refused* your project, that's the
"support my stack" form — 👍 on those is how we decide what to widen next.

## Security

Font Lab edits files in your project and runs an MCP server locally. If you find a security issue,
please follow [`SECURITY.md`](./SECURITY.md) rather than opening a public issue.
