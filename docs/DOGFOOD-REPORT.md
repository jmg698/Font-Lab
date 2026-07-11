# Font Lab dogfooding summary — feedback for the team

*Jack's site (`jack-mcgovern-site`) was used as a real dogfood surface across
0.12.0 → 0.13.0. Preview got dramatically better in 0.13; the **agent handoff
loop** stayed the main friction.*

## What we were trying to do

1. Install/upgrade Font Lab and use the live panel on the real site
2. Preview fonts on `/` and `/fontlab`
3. Edit copy inline (worked well)
4. Pick a direction and have the agent receive it automatically
5. Eventually ship (only when ready — mostly testing preview + handoff)

## Timeline of attempts

### Upgrades (0.12.0 → 0.13.0)

| Step | What happened |
|---|---|
| `npm install font-lab@X` | Usually fine |
| `npx font-lab-init` | Sometimes skipped → **stale panel** warning (panel 0.12.1, endpoint 0.12.2) |
| Restart `:7777` endpoint | Often forgotten; old process holds port (`EADDRINUSE` / SIGKILL) |
| Reload Cursor MCP | Easy to forget; MCP stayed on **0.11.0** while panel was **0.13.0** |

**Lesson:** Three moving parts (npm, init, endpoint) + fourth (MCP reload) with
no single "upgrade" command.

### Preview (pre-0.13 vs 0.13)

#### Before 0.13 — CSS var override model

| Symptom | Cause |
|---|---|
| `/fontlab` barely changed on flip | **Font island** — page uses `--fl-serif`, `font-mono`, page-local `next/font`, not global `--font-bricolage` / `--font-hanken` |
| `/` changed but everything read as **body** | **Dead display chain** — Tailwind v4 `@theme inline` + body-scoped `next/font` vars |
| Display flip looked like a no-op | Panel overrode vars that headings never consumed |
| Init said "display won't preview" | Wiring diagnostic was right; panel still offered live flip anyway |

#### After 0.13 — cluster-paint

| Result | Evidence |
|---|---|
| `/` and `/fontlab` preview **worked** | Headlines, body, mono all flipped |
| Inspect/hover accurate | `DISPLAY · Instrument Serif · 17 on page` on `/fontlab`; `MONO · Spline Sans Mono · 101 on page` on chrome |
| `AGENT WIRES ON SHIP` badge | Honest about mono having no auto-ship seam |
| Pick carries **census + scope** | `selection.json` includes clusters, islands, `preview.mechanism: "cluster-paint"` |

**Lesson:** 0.13 fixed the core preview mission. Init CLI message still
references old wiring ("display won't preview") while the panel previews via
paint — confusing.

### Copy edit

| Result |
|---|
| **Worked end-to-end** — edits landed in `app/fontlab/page.tsx`, reversible backups in `.font-lab/backups/edit-*` |
| User committed 3 copy files successfully |
| Pre-0.12.4: 137 files in git from edit backups → fixed by `.font-lab/.gitignore` with `*` |

**Lesson:** Copy edit path is the gold standard for "it just works."

### Pick handoff (repeated attempts)

| Attempt | Result |
|---|---|
| User picked Bold Editorial | Saved; panel: *"tell your agent"* |
| User picked Elegant Contrast | Saved; same message |
| Agent ran `font_lab_wait_for_pick` (2x, 4 min each) | **Timed out** — user picked outside listen window |
| `agentWaiting: false` at pick time | Every time — no auto-ping |
| Agent read pick via `font_lab_status` | Works on demand; not push |

**Lesson:** Endpoint up ≠ agent listening. Users (and agents) assume starting
`npx font-lab` is enough.

### "Get more" / agent listening (0.12+)

| Attempt | Result |
|---|---|
| User clicked **Get more** in panel | **"No agent is listening"** off-ramp |
| Request was saved to `.font-lab/request.json` | Good persistence |
| Agent had only started `:7777` | Never called `font_lab_wait_for_request` or `font_lab_wait` |
| MCP on 0.11 after reload | `font_lab_wait_for_request` not exposed |
| 0.12.2 heartbeat | Helps **Get more** if MCP tools called recently; **does not** deliver picks |

**Lesson:** Endpoint up ≠ agent listening. Users (and agents) assume starting
`npx font-lab` is enough.

### Infrastructure fragility

| Issue | Frequency |
|---|---|
| Dev server `:3005` down after reload/idle | Happened multiple times |
| Font Lab `:7777` down or wrong version | After upgrades without restart |
| Two long-running processes | Neither auto-starts; neither documented in one place in the panel |

## Root causes (architectural)

### 1. Two-layer model is invisible to humans

```
Layer 1: Endpoint (:7777)     → saves picks, copy-edit, SSE to panel
Layer 2: Agent parked          → font_lab_wait blocking, or serve --once
```

Most failures were **Layer 1 up, Layer 2 missing**. The panel distinguishes
this for **Get more** but pick still saves with an off-ramp that sounds like
failure.

### 2. MCP version drift

`.mcp.json` runs `npx -y font-lab mcp` → can cache an old MCP while
`node_modules` and panel are new. User reloads Cursor; still old tools (0.11.0
reported while panel was 0.13.0).

### 3. Agent can't hold a blocking wait across turns easily

`font_lab_wait_for_pick` blocks up to 240s. If the user picks outside that
window, or the agent turn ends, listening stops. User experience: "I picked,
nothing happened."

### 4. Upgrade/init/endpoint not one operation

Easy to get version skew (stale panel, old endpoint, new package).

### 5. Dev server is a third process

Not Font Lab's bug, but the live panel needs **dev + endpoint + (optionally)
agent listen**. Three terminals, zero orchestration.

## What worked well (keep / amplify)

- **0.13 cluster-paint preview** on a hostile site (`/fontlab` islands, dead
  display chain)
- **Inspect/hover** with cluster labels and counts
- **Copy edit** → source with backups
- **Pick payload** with census, scope, islands, `AGENT WIRES ON SHIP`
- **`.font-lab/.gitignore`** — stops commit noise
- **Honest off-ramp** when no agent (better than silent no-op) — but copy
  feels like an error

## Recommendations to make it foolproof

### P0 — Pick delivery (biggest pain)

| Idea | Why |
|---|---|
| **Default: pick persists + agent polls on next message** | Agent calls `font_lab_status` at session start / when user mentions fonts; if fresh `selection.json`, surface it: *"You picked Elegant Contrast 2 min ago — apply?"* |
| **Panel: two clear states** | `ENDPOINT READY` vs `AGENT LISTENING` — already partially there; pick ack should differ: green "Sent to agent ✓" vs amber "Saved — your agent will see this on next check" |
| **`font_lab_wait` as default agent instruction** | Skill/AGENTS.md: after `init`, **always** start `font_lab_wait` in background before telling human to open site |
| **`serve --once` wrapper in install** | `npx font-lab listen` = one command that sets `agentWaiting` and blocks until pick (alias for wait loop tied to endpoint) |
| **Don't rely on 4-minute MCP block alone** | File-based pick is the durable signal; push is optimization |

### P0 — MCP / version alignment

| Idea | Why |
|---|---|
| **`npx font-lab install --local`** or pin MCP to `node_modules/font-lab/mcp.mjs` | Eliminates npx cache vs package drift |
| **`font_lab_status.versions` mismatch → blocking banner in panel** | "MCP 0.11 · panel 0.13 — reload agent session" |
| **Init prints: "Reload Cursor MCP + run `font_lab_wait`"** | Every upgrade |

### P1 — Onboarding / one command

| Idea | Why |
|---|---|
| **`npx font-lab dev`** | Starts endpoint + prints dev server command + optionally spawns wait |
| **Upgrade = install + init + restart endpoint** | Single `npx font-lab upgrade` |
| **Panel boot checklist** | ✓ endpoint ✓ panel version ✓ MCP version ✓ dev server reachable |

### P1 — Messaging consistency

| Idea | Why |
|---|---|
| Remove/stale init note "display won't preview" when cluster-paint is active | User saw contradiction |
| Pick message when `agentWaiting: false`: "Saved. Start your agent with `font_lab_wait` for instant handoff, or say 'apply my font pick' anytime." | Less "broken" |

### P2 — Heartbeat extension

| Idea | Why |
|---|---|
| Heartbeat already helps **Get more** | Extend docs: heartbeat ≠ pick delivery |
| Optional: long-lived **"session mode"** heartbeat refreshed by panel SSE ping every 30s | Agent recently "in session" without blocking |

### P2 — Ship honesty (0.13 already started this)

| Idea | Why |
|---|---|
| After pick, panel summary: *"Auto-ship: body + display via layout. Agent wires: mono, 17 heading islands on /fontlab."* | Sets expectations before apply |
| `font_lab_apply` returns receipt with convergence % | Already in roadmap |

## Suggested "foolproof" happy path (for the team to optimize toward)

```
1. npx font-lab install          # skill + MCP + .font-lab gitignore
2. npx font-lab dev --project .  # endpoint + "run npm run dev" hint
3. Agent: font_lab_wait          # blocks, panel shows AGENT LISTENING
4. Human: flip, Pick
5. Agent: wakes with selection, offers apply (with scope summary)
```

Today step 3 is manual, easy to skip, and times out. Steps 1–2 are three
commands and a reload.

## One-liner for the team

> Preview in 0.13 is solved on our hardest site; the product still feels
> broken because pick save works but pick delivery is a separate,
> un-orchestrated step that agents and humans routinely miss — and
> MCP/version drift makes it worse.
