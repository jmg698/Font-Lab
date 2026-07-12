#!/usr/bin/env node
// Claude Code hook (UserPromptSubmit) — TRUE next-turn pick delivery. stdout from a
// UserPromptSubmit hook is injected into the model's context, so the moment the human comes
// back to chat and types ANYTHING ("did you get it?", "now fix the nav"), the agent already
// knows an unapplied pick is waiting — no polling, no rendezvous, no pasted panel message.
//
// Installed into <project>/.claude/settings.json by `font-lab install --host claude` (only
// when a stable script path exists — the project's own node_modules install, or a --local
// checkout). Silent when nothing is pending; never blocks (exit 0 on every path); reads two
// small JSON files, so it adds no perceptible latency to the turn.

try {
  const path = await import("node:path");
  const { pendingPick, readRequest } = await import("./state.mjs");
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const pick = pendingPick(path.resolve(project));
  if (pick) {
    console.log(
      `[Font Lab] UNDELIVERED PICK: the human picked "${pick.direction?.name ?? "?"}" ${pick.age} ago in the live panel and it has NOT been applied.` +
        (pick.stale ? " The pick is old — confirm it still stands before applying." : "") +
        (pick.scope ? ` Ship scope: ${pick.scope}.` : "") +
        " Offer font_lab_apply; after applying, run font_lab_verify for the convergence receipt.",
    );
  }
  // Same next-turn delivery for the panel's "Get more" ask — without this, a request made while
  // no agent was parked waits for the next Font Lab TOOL call, but the human's next message
  // (about anything) is the earlier, better moment.
  const req = readRequest(path.resolve(project));
  if (req?.status === "pending") {
    const mins = Math.round(Math.max(0, Date.now() - (Date.parse(req.at || "") || Date.now())) / 60000);
    const ago = mins < 1 ? "moments" : mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
    const brief = Object.entries(req.brief || {})
      .filter(([, v]) => (Array.isArray(v) ? v.length : v))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("; ");
    console.log(
      `[Font Lab] UNFULFILLED "GET MORE" REQUEST: the human asked for more font options in the live panel ${ago} ago${brief ? ` (brief — ${brief})` : ""} and nothing has composed them yet. ` +
        `Compose fresh directions honoring the brief (font_lab_compose_directions), avoiding the families in request.exclude, then font_lab_more_directions to append them to the panel.`,
    );
  }
} catch {} // a hook must never break the turn it rides on
process.exit(0);
