<!-- Thanks for contributing to Font Lab. Keep this PR focused; small and reviewable beats big. -->

## What & why

<!-- What does this change, and what problem does it solve? Link an issue if there is one. -->

## The invariants (Font Lab lives or dies on these — confirm your change keeps them)

- [ ] **The human still makes the pick.** Nothing here auto-selects a font for the user.
- [ ] **preview == ship.** Any font offered still clears the shippability gate (verified capsize coverage + single-woff2 variable parity), or is honestly flagged as best-effort.
- [ ] **Reversible.** Anything that writes to a user's project is backup-first and cleanly undoable.
- [ ] **Scope unchanged** (or intentionally widened, and said so): Next.js + App Router + Tailwind v4 + CSS-variable fonts. Out-of-branch projects are still refused with a clear reason.

## Tests

- [ ] The fast gate passes locally: `cd cli && npm install --omit=dev && node codegen-css-test.mjs && node panel-keys-test.mjs && node m3-test.mjs && node m4-test.mjs && node m5-test.mjs`
- [ ] If I touched the ship/apply/preview path, I ran the build-and-render proof: `bash cli/run-m2.sh` (needs full `npm install` + `npx playwright install chromium`).

## Notes for the reviewer

<!-- Anything non-obvious: a tradeoff, a thing you're unsure about, a follow-up you're deferring. -->
