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
  const { pendingPick } = await import("./state.mjs");
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
} catch {} // a hook must never break the turn it rides on
process.exit(0);
