# M0 — Results: GO ✅

> The go/no-go spike for Font Lab. Both load-bearing claims are proven against a real
> **Next.js 16.2.9 + Tailwind v4 + Turbopack** fixture (`examples/sample-next-site`).
> Reproduce with `bash spike/m0/run.sh`. Throwaway code — the point is the evidence.

## Verdict

| Claim | Result | Evidence |
|---|---|---|
| **2 · Preview == ship** (pixel-identical) | ✅ **0 / 8,192,000 pixels differ** | `out/parity-report.json`, `out/diff.png` |
| **2 · Override math reproduced** | ✅ **exact match** to next/font | `out/compare-report.json` |
| **1 · Swap survives Fast Refresh** | ✅ **pass** | `out/hmr-report.json` |
| *(bonus)* Dev panel kept out of prod | ✅ after fix | DCE step below |

**Decision: GO.** The two things that could have killed the concept — "is the preview
honest?" and "does the live swap survive HMR?" — both hold, on the modern default stack.

## Claim 2 — Preview is byte-for-byte what ships

The fear: `next/font` doesn't just load a file, it generates a metric-adjusted fallback
(`size-adjust` / `ascent-override` / …) to prevent layout shift, so a naive CDN preview
would differ subtly from ship. The test:

- **Reproduced next/font's adjusted fallback independently** from `@capsizecss/metrics`
  using next/font's own formula (Fraunces, serif → Times New Roman fallback). Computed
  values **equal** next/font's real emitted CSS, exactly:

  | descriptor | our preview (from capsize) | next/font (built output) |
  |---|---|---|
  | `size-adjust`        | `115.45%` | `115.45%` |
  | `ascent-override`    | `84.71%`  | `84.71%`  |
  | `descent-override`   | `22.09%`  | `22.09%`  |
  | `line-gap-override`  | `0.00%`   | `0.0%`    |

- **Pixel-diffed two routes** rendering identical content: `/ship` (Fraunces via
  `next/font/google`) vs `/preview` (our hand-built `@font-face` + the same self-hosted
  woff2, no next/font). Over a 2560×3200 full-page capture: **0 pixels differ.**

So "what you see is what you ship" is provable, not a slogan. The mechanism that makes it
true — precompute next/font's exact two `@font-face` blocks and point them at the same
woff2 — is what the catalog's "parity bundles" will ship.

## Claim 1 — The swap survives HMR (no proxy, no iframe)

A dev-only `<FontLabDevPanel/>` swaps fonts by setting `--fl-*` on `:root` via an inline
style on `<html>`. The test flipped to Fraunces, then edited `app/page.tsx` to trigger a
**real Fast Refresh** (confirmed: a marker in the page updated), then re-checked:

```
font.initial   = Inter, "Inter Fallback", …      (current state)
→ click panel "Fraunces"
font.afterClick = "FL Fraunces", "FL Fraunces Fallback", serif
→ edit page.tsx → Fast Refresh applies (hmr.applied = true)
font.afterHMR   = "FL Fraunces", "FL Fraunces Fallback", serif   ← survived
```

It survives because the override lives on `documentElement.style` — outside React's tree —
so Fast Refresh never touches it. No reverse proxy, no iframe, no CSP stripping. The panel
UI itself is isolated in a Shadow DOM so the swap doesn't restyle the panel.

## Bonus finding — the DCE guard footgun is real (and fixed)

The critique flagged that `process.env.NODE_ENV === 'development'` guards are fragile. M0
confirmed it: with a **static import** + inline render guard, the panel's code still shipped
into a production client chunk (`.next/static/chunks/*.js`) even though it never rendered.
**Fix:** gate the *import* itself (dev-only dynamic import in the dead prod branch). After
the fix, the panel is **absent** from the prod client JS. → `SHIP-SPEC.md` should require
the gated-import form and lint for it.

## What M0 deliberately did not test

- One font (Fraunces) and one fallback path (serif → Times New Roman). The sans path
  (→ Arial) uses the identical formula; spot-check it before locking the catalog.
- **Capsize coverage per font** — uncovered Google fonts throw at build; enumerate the
  table before finalizing the ~40-font list (tracked in `SHIP-SPEC.md`).
- Transient FOUT *during* load (parity is proven at steady state; the adjusted fallback is
  what keeps the load flash CLS-free, and its numbers match exactly).
- Hardcoded-`font-family` projects (v1 is scoped to the CSS-variable path).

## impeccable (taste guidance) — wired and working

`impeccable detect <url>` runs and flagged a real cliché in the fixture — the
`hero-eyebrow-chip` ("Field Notes · Issue 07" tracked-caps kicker over a big headline).
That's the intended division of labor: impeccable critiques **structure** (the floor),
Font Lab owns the **font choosing-moment** (the ceiling).

Two integration notes for later:
- It did **not** flag Inter, because next/font exposes hashed family names
  (`__Inter_xxx`) that evade impeccable's `overused-font` matcher. → don't rely on
  impeccable for "what font is in use"; our analyzer resolves that. Use impeccable to
  **seed the brief** (structural slop), not to identify fonts.
- Its URL detector needs a sandbox-capable Chromium; in a root container pass a
  `--no-sandbox` Chromium via `PUPPETEER_EXECUTABLE_PATH`. Requires Node ≥ 24.
