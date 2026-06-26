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
> - **M6** (`cli/run-m6.sh`, M1 16/16 + M6 17/17): the **choosing moment polished**, driven in
>   a real browser. **Mixed picks** (heading from one direction, body from another), **before/
>   after**, **pin-two-to-compare**, **more-like-this**, refined keyboard UX, and **multi-route
>   flipping** — the working pairing persists across routes (`/`, `/dense`, `/form`) via
>   sessionStorage, because a face reads differently on a hero vs. a dense page vs. a form. A
>   mixed pick ships end to end (verified: Fraunces/Figtree/JetBrains Mono → real `next/font`).
> - **M5** (`cli/run-m5.sh`, 26/26): the **MCP server + skill** so an agent drives the whole
>   loop (analyze → curate *or* compose → preview → read the pick → apply). The agent gets the
>   curated default for free **and can take the wheel** — composing its own directions from the
>   catalog (option 3) — but only from catalog fonts, so preview == ship still holds. The human
>   always makes the final pick. Verified over real stdio (initialize / tools-list / tools-call).
> - **M4** (`cli/run-m4.sh`, 96/96): the **parity catalog + curator**. A 41-font catalog of
>   variable Google fonts, each gated on *verified* capsize coverage (checked by importing
>   the metrics) and single-woff2 variable parity. A deterministic, **LLM-free** curator
>   turns the analysis into ~5 directions — moving off the current fonts, rankable by vibe,
>   reproducible. Evidence in `cli/out/m4-report.json`.
> - **M3** (`cli/run-m3.sh`, 60/60): the **real analyzer** reads framework, App vs Pages
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

That dogfood turned into a feature. The analyzer now ships **coverage diagnostics** so the
tool *detects* this class of problem instead of being surprised by it:

- **Dead roles.** Under `@theme inline`, Tailwind v4 doesn't publish `--font-*` as a `:root`
  variable — only the generated `font-*` utilities deref it. A site that hand-writes
  `font-family: var(--font-display)` (a very common pattern) therefore has *silently broken*
  display wiring. `analyze` flags it: `⚠ dead display — swap invisible until rewired`.
- **Other subsystems.** Fonts declared with their own next/font in another route/component
  (jack's `/gus` uses `--font-fraunces`/`--font-dm-sans`) are reported, so the agent/user
  knows a global swap's true scope (full per-route flipping is M6).

The principle this protects: **preview and ship must operate on the same leaf next/font
variable, applied at the same element next/font uses** (the analyzer reports both
`classNameTarget` and each role's `nextFontVar`). When they match, preview == ship *by
construction* on any site — and when a swap genuinely can't be seen, the tool says so rather
than letting the user pick blind.

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
node cli/curate.mjs  --project <your-project>             # the ~5 directions it would offer
node cli/curate.mjs  --project <your-project> --vibe editorial
node cli/gen-catalog.mjs                                   # self-host fonts + build catalog
cd examples/sample-next-site && pnpm dev                   # your dev server
node cli/font-lab.mjs --project examples/sample-next-site  # the pick endpoint (:7777)
```

Then open the dev site: a panel (bottom-right) shows the current state + the curated
directions, swapping live on your real content. Keys (M6):

- `←` `→` — flip direction · `↑` `↓` — focus a role · `[` `]` — swap just that role (**mixed
  picks**: heading from one direction, body from another)
- `B` — before/after · `P` then `Space` — **pin two and compare** · `M` — more like this
- `Enter` or **Pick** — write the selection

The working pairing follows you across routes (`/`, `/dense`, `/form`) so you can judge a face
on a hero, a dense page, and a form — "your real site" is more than one screen.

### Run it on your own project (`font-lab init`)

One command makes any supported project (App Router + Tailwind v4 + CSS-variable fonts)
previewable — it self-hosts the parity bundles, drops in the dev panel, and mounts it
dev-only in your layout:

```bash
node cli/init.mjs --project <your-project>     # scaffold panel + parity bundles (reversible)
cd <your-project> && <your dev command>        # e.g. next dev / npm run dev
node cli/font-lab.mjs --project <your-project> # the pick endpoint (:7777)
# → flip in the panel, Pick, then `node cli/apply.mjs --project <your-project>`
node cli/init.mjs --project <your-project> --undo   # remove the panel scaffolding
```

The panel swaps through your project's **own** leaf font variables (the analyzer's `wiring`),
so the live preview is byte-for-byte what `apply` ships. A role the site doesn't route through
a variable is shown as *not wired* rather than faked. Proven end to end on the real
jack-mcgovern.com (body swapped site-wide live → shipped Playfair Display / Source Serif 4 /
Roboto Mono → reverted clean).

### Fix a dead role (`font-lab rewire`)

If `analyze` flags a role as **dead** (declared but not actually rendered — a heading rule that
reads `var(--font-display)` under `@theme inline`), `rewire` points those raw usages at the
published leaf var so the font renders. Reversible.

```bash
node cli/rewire.mjs --project <your-project>   # var(--font-display) → var(--font-bricolage)
node cli/undo.mjs   --project <your-project>   # revert
```

Proven on the real jack-mcgovern.com: headings rendered `Hanken Grotesk` (body font) before →
`Bricolage Grotesque` after, build-verified, then reverted.

### Let an agent drive it (the easy way)

Register the server once with Claude Code (user scope = available in every project):

```bash
cd Font-Lab/cli && pnpm install                     # one-time
claude mcp add font-lab -s user -- node "$(pwd)/mcp.mjs"
```

Then, in any supported project, just tell Claude:

> "Use Font Lab to pick fonts for this site."

Claude runs the whole setup — `analyze` → `init` (installs the panel + self-hosts the fonts) →
`rewire` if headings are dead → starts your dev server + the pick endpoint. **Your only job:**
open the site, flip/mix/compare in the panel, and hit **Pick**. Claude reads your pick and
ships it (`apply`), reversibly.

Prefer not to use the CLI? A ready-to-use [`.mcp.json`](../.mcp.json) is committed at the repo
root (loads automatically when you open this repo), or copy the entry into another project's
`.mcp.json` with an absolute path:

```jsonc
{ "mcpServers": { "font-lab": { "command": "node", "args": ["/abs/path/to/cli/mcp.mjs"] } } }
```

The 11 tools (`analyze`, `list_catalog`, `curate`, `compose_directions`, `init`, `uninit`,
`prepare_preview`, `read_pick`, `apply`, `rewire_dead_roles`, `undo` — all `font_lab_*`) and the
loop are described in [`../skill/font-lab/SKILL.md`](../skill/font-lab/SKILL.md). The agent gets
the curated default for free and can compose its own directions from the catalog — but the
**human always makes the pick**, and composed fonts must be catalog members so preview still
equals ship. Proven end to end over MCP on the real jack-mcgovern.com.

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
| `analyzer.mjs` | **the analyzer (M3):** pure, read-only audit of a project — framework, router, Tailwind version, current fonts per role, and wiring. Traces the CSS custom-property graph from `--font-*` back to the next/font const that feeds it. **Coverage diagnostics**: flags dead roles (a swap that won't be visible) and other font subsystems (routes a global swap won't reach) |
| `analyze.mjs` | thin CLI around the analyzer (`--project`, `--json`) |
| `catalog.mjs` | **the catalog (M4):** ~41 variable Google fonts as parity bundles — each with a verified capsize slug, a discovered css2 latin query, role suitability, and vibe tags. Pure data; the parity asset |
| `curator.mjs` | **the curator (M4):** ~12 hand-authored directions + a deterministic `curate(analysis, {vibe, count})` that returns ~5, moving off the current fonts. No runtime LLM |
| `curate.mjs` | thin CLI to preview the directions for a project (`--project`, `--vibe`, `--count`, `--json`) |
| `catalog-build.mjs` | reusable `generateCatalog(projectDir, directions, meta)` — self-hosts fonts + computes parity fallbacks + writes the generated module. Built from curated OR agent-composed directions |
| `gen-catalog.mjs` | CLI: analyzer → curator → `generateCatalog`, bakes the real `current`/`target`/`directions` into `app/_fontlab/catalog.generated.ts` |
| `engine.mjs` | **the engine facade (M5):** the stable API the MCP wraps — `analyze`, `listCatalog`, `curate`, `composeDirections` (option 3, catalog-gated), `preparePreview`, `readSelection`, `apply`, `undo` |
| `mcp.mjs` | **the MCP server (M5):** dependency-free JSON-RPC/stdio server exposing the engine as 8 agent tools, descriptions tuned for discoverability |
| `init.mjs` | **the installer:** scaffolds the panel + parity bundles into a real project and mounts it dev-only in the layout; `--undo` restores byte-for-byte. The last mile to "your own running site" |
| `.mcp.json` (repo root) | ready-to-use MCP registration — open the repo in an MCP client and the `font-lab` server loads |
| `templates/font-lab-panel.tsx` | the portable dev panel `init` installs — same UX as the fixture's, but swaps through the analyzer's `wiring` so it's honest on any site |
| `../skill/font-lab/SKILL.md` | the skill manifest — how an agent drives the loop and the rules (human picks; catalog-only; be honest about coverage) |
| `font-lab.mjs` | the CLI: the localhost write-back endpoint (`POST /select` → `.font-lab/selection.json` + `picks.log.jsonl`); `--apply` ships on pick |
| `codegen.mjs` | the ship engine (M2+M3): `applySelection` / `undo` — analyzer-gated branch selection, ts-morph + fenced markers, backup-first. Handles both the role-var path and the **adopt-existing-variable** path (real sites) |
| `apply.mjs` / `undo.mjs` / `rewire.mjs` | thin CLI wrappers around the ship engine (`rewire` fixes dead roles) |
| `loop-test.mjs` / `apply-test.mjs` / `m3-test.mjs` / `m4-test.mjs` / `m5-test.mjs` / `m6-test.mjs` | headless e2e of the loop (M1), ship engine (M2), analyzer + branch selection (M3), catalog + curator (M4), engine + MCP over stdio (M5), and the polished panel — mixed picks / pin / multi-route — in a real browser (M6) |
| `run-m1.sh` … `run-m6.sh` | loop test; apply+build+render+idempotency/reversibility; analyzer+codegen; catalog+curator; engine+MCP; mixed-picks/pin/multi-route in a browser |

## The contract it writes

`.font-lab/selection.json` follows the schema in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md): `direction`, `roles` (display/body/mono with
family/source/weights), `replaces` (current fonts), and `target` (framework/router/Tailwind
version/wiring). `picks.log.jsonl` appends every pick — the taste-memory stream the roadmap
starts capturing at M1.
