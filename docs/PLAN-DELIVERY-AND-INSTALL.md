# Plan — pick delivery & install consistency (the 0.14 track)

*2026-07-11. Source: the jack-mcgovern dogfood (`DOGFOOD-REPORT.md`) → our proposal →
the team's standup review. This is the reconciled final plan. The one-liner it answers:
preview is solved (0.13); the product still feels broken because pick save works but pick
delivery is a separate, un-orchestrated step — and version drift makes everything worse.*

## The model: three concentric delivery guarantees

Stop treating "agent parked at the moment of pick" as the success condition. The pick is
durable on disk; delivery is layered, and every layer down is guaranteed when the layer
above misses:

1. **Instant** (bonus lane) — agent is armed (`font_lab_wait` loop or `serve --once`);
   pick lands in seconds. Works only when timing cooperates. Never advertised as the
   mechanism, only as the fast path.
2. **Next-turn** (host-dependent) — a turn-start hook surfaces a fresh unapplied pick when
   the human returns to chat, whatever they type. Strong on Claude Code (real hooks);
   soft on Cursor (rules only) until Cursor's hooks beta stabilizes. Never oversold.
3. **Durable** (the floor, always true) — the pick piggybacks on EVERY MCP tool result
   until applied. Any Font Lab touch, ever, delivers it. This is the workhorse; the
   dogfood's lost picks all land here.

The standup's acceptance test is the contract for the floor:

> Agent sets up and ends its turn without waiting. Human browses 15 minutes, picks.
> Human asks "did you get it?" Agent must surface the pick — with ship scope — without
> the user pasting anything from the panel.

## P0 — Pick delivery

### 1. `pendingHumanPick` piggyback on every MCP tool result

Mirror of the existing `pendingHumanRequest` piggyback (`mcp.mjs`). Both mechanisms it
needs already exist:

- **Predicate:** `readHandoffState` already computes `applied.current` (apply stamp
  postdates the pick — `state.mjs`). Piggyback iff a selection exists and
  `!applied.current`. No TTL: an unapplied pick is a standing decision; expiring it
  re-loses it. Include the pick's age; past ~7 days add "stale — confirm with the human
  before applying."
- **Scope summary (standup's key addition):** the 0.13 pick payload already carries
  `selection.preview.scope` (per role: `autoShipSeam`, clusters, islands). Render it into
  the piggyback so the agent never blindly applies:
  *"The human picked 'Elegant Contrast' 4m ago (unapplied). Auto-ships: body, display
  (layout seam). Agent wires: mono (no seam) + 17 heading islands on /fontlab. Offer
  font_lab_apply, then font_lab_verify for the receipt; residue returns as a work order."*
- **Noise control:** full message on the first result per MCP process; one-line reminder
  after. Skip list extends the existing regex: `wait|more_directions|read_pick|select|
  apply|undo|verify` (tools that receive or fulfill the pick themselves).

**Acceptance test** (offline, request-test style): write `selection.json` out-of-band →
call any non-skip tool through the MCP handler → assert `pendingHumanPick` with scope
summary → run apply (stamp) → assert the piggyback is gone.

### 2. Unified ack copy — pick and Get-more share delivery semantics

Panel changes (`font-lab-panel.tsx` pick ack + Get-more off-ramp):

- Armed (`agentWaiting`): **"Sent to your agent ✓"**
- Unarmed: **"Saved ✓ — your agent will see it on its next Font Lab call, or just say
  'apply my font pick'."** with the phrase as a copy chip. Same shape for Get-more
  ("…will compose more options on its next call…").

The unarmed copy is only honest because of #1 — ship them together.

### 3. Arm-first sequencing in the skill + AGENTS.md

The dogfood failure: agent set everything up, said "open your site!", ended its turn
unarmed. New instruction: **the last act of the setup turn is entering the listen state**
— `font_lab_wait` (re-call on every timeout for as long as the harness allows) or
`npx font-lab serve --once` as a background task on harnesses that wake on process exit
(Claude Code yes; Cursor's background terminals don't reliably wake the agent — there,
the wait loop inside the turn is the ceiling, and layers 2–3 carry the rest). Arm first,
*then* invite the human to browse.

## P0 — Version alignment

One version currently lives in four places that update independently: `node_modules`
(npm), the npx cache (MCP), the running :7777 process (boot-time), the panel stamp (init).

### 4. Pin the MCP registration; re-pin on every install run

`install.mjs`:

- Project-scoped configs (Claude `.mcp.json`, VS Code `.vscode/mcp.json`): when font-lab
  is a project dep, register `node node_modules/font-lab/cli/mcp.mjs` — `npm install`
  then IS the MCP upgrade. Fall back to npx form otherwise.
- Global configs (Cursor, Windsurf, Gemini, Codex): `npx -y font-lab@latest mcp` so npx
  re-resolves per session instead of freezing at first cache.
- **Standup addition, accepted:** `install` re-run REWRITES existing entries (today it
  no-ops when a font-lab entry exists) — so `font-lab upgrade` (#7) can re-pin.

### 5. MCP self-drift check

On first tool call carrying `projectDir`: compare own version against the project's
`node_modules/font-lab/package.json`. If older, piggyback a warning on every result:
*"This MCP server is 0.11 but the project has 0.13 — reload the agent session; run
`npx font-lab install` to re-pin."* Belt-and-suspenders under #4.

## P1 — Process resilience

### 6. Port 7777 self-healing

On `EADDRINUSE`, query the squatter's `/status`:

- Same project, same-or-newer version → print "already running, reusing" and exit 0
  (idempotent).
- Same project, stale version → `POST /shutdown` (loopback-only; also the fix for the
  standup's edge case: `npm install` in another terminal while an old endpoint runs —
  `/status` already reports `installed` vs `version` drift) → take over the port.
- Not a Font Lab endpoint / different project → named, actionable error.

### 7. `font-lab upgrade` — one command, runtime-triggered (NOT a postinstall hook)

`npm install font-lab@latest` (package manager detected) → re-run init (panel re-stamp)
→ endpoint restart via #6 takeover → re-pin MCP configs via #4 → print "reload your
agent session." Every runtime drift detector (endpoint `/status`, MCP piggyback #5, panel
stale banner) points at this one verb.

**Standup's postinstall idea declined** — see "Where we differ" in the review notes:
npm hides dependency script output by default, `--ignore-scripts` and CI make it
unreliable, and a dependency editing the repo from postinstall is wrong. Runtime
detection + one explicit verb is the dependable version of the same intent.

### 8. Dev-server visibility (standup gap #1, mechanism corrected)

The panel cannot report a dead dev server — the panel lives inside the page the dev
server serves. Invert it: the panel reports its origin to the endpoint on SSE connect
(`GET /events?origin=`); the endpoint persists `{origin, lastSeenAt}` in `.font-lab/`.
Then `font_lab_status` health-checks that origin and reports
`devServer: { url, up, lastSeen }` plus the detected dev command (`liveInstructions`
already detects it) — and the skill says: if `devServer.up` is false, restart it as a
background task before telling the human anything else. Bonus: `font_lab_verify` and
`font_lab_screenshot_directions` can default `baseUrl` to the recorded origin.

We deliberately do NOT make Font Lab own the dev server's lifecycle (package-manager,
env, monorepo variance). Detection + the exact restart command is the robust version.

## P1 — Messaging

### 9. Fix the stale init message

Init still prints the variable-era "display won't preview." Post-0.13 truth: *"display
previews fine (painted on the rendered page); its source wiring is dead, so SHIPPING it
is wired by your agent — the pick carries the scope."*

## P2 — Host-native turn-start delivery

### 10. Claude Code hook, shipped by `install --host claude`

SessionStart/UserPromptSubmit hook: fast local freshness check of `.font-lab/`; inject
"pending unapplied pick: … (scope …)" into context. This is real next-turn-automatic.

### 11. Cursor: rules + watch the hooks beta

Install writes a `.cursor/rules` entry: "before any font/typography reply, call
`font_lab_status`." Soft by nature — do not advertise "automatic" on Cursor (standup
agrees). Re-evaluate when Cursor's hooks (`beforeSubmitPrompt`) leave beta; then it gets
the same treatment as #10. The `LAST_PICK.md` idea is dropped as a delivery mechanism
(nothing reads a file unprompted); the same information rides #1 and `font_lab_status`.

## Review notes — where the plans reconciled

Accepted from the standup review: scope summary inside the piggyback (their sharpest
catch — prevents blind-apply surprising the user on island routes); install re-pinning
existing MCP entries on upgrade; unified pick/Get-more ack semantics; the
pick-after-turn-ended acceptance test; "don't oversell Cursor."

Where we differ (with reasons):

1. **"Panel could health-check baseUrl"** — impossible when the dev server is down (no
   page, no panel). Inverted into #8: the endpoint owns dev-server health, seeded by the
   panel's own origin report.
2. **Postinstall upgrade hook** — declined for reliability and hygiene (#7). Same intent,
   dependable mechanism.
3. **TTL on the piggyback** — no expiry; age + stale wording instead. The
   "newer-than-last-apply" half of their concern already exists as `applied.current`.
4. **Their gap "unified font_lab_wait missing after reload"** — needs no new work:
   `font_lab_wait` shipped in 0.13; the 0.11 MCP from the npx cache was the reason it was
   missing, which #4/#5 eliminate.

## Ship order

**All eleven landed 2026-07-11** (one build, three logical slices). Test coverage:
`pick-delivery-test.mjs` (the standup acceptance contract, 12 assertions, offline),
`serve-heal-test.mjs` (port triage/takeover/park, 10 assertions, offline), and
`install-test.mjs` grown to 35 checks (pinning, TOML re-pin, hook merge/removal, hook
script behavior, cursor rules).

| # | Change | Where |
|---|---|---|
| 1 | `pendingHumanPick` piggyback + scope summary + acceptance test | `mcp.mjs` (`state.pendingPick`), `pick-delivery-test.mjs` |
| 2 | Ack copy unification (pick + Get-more) + copy chip | `templates/font-lab-panel.tsx` |
| 3 | Pin + re-pin MCP registration (JSON + TOML re-pin) | `install.mjs` (`mcpEntryFor`) |
| 4 | MCP self-drift warning (`mcpVersionDrift` on every result) | `mcp.mjs` |
| 5 | Arm-first sequencing | `skill/font-lab/SKILL.md`, `install.mjs` agentsBlock |
| 6 | Port self-healing (`/shutdown`, takeover, `--once` park-on-files) | `font-lab.mjs` |
| 7 | `font-lab upgrade` (delegates to the freshly installed package) | `font-lab.mjs` |
| 8 | Dev-server visibility (`/events?origin=` → `status.devServer` → verify/screenshots default `baseUrl`) | `font-lab.mjs`, `engine.mjs`, `state.mjs`, panel |
| 9 | Init message fix (dead wiring = ship scope, not a preview gate) | `init.mjs`, `mcp.mjs` |
| 10 | Claude Code turn-start hook | `pending-pick-hook.mjs`, `install.mjs` |
| 11 | Cursor rules entry (`.cursor/rules/font-lab.mdc`) | `install.mjs` |
