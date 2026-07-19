// Where is the agent running, and can the HUMAN reach this machine's localhost?
//
// Font Lab's two preview surfaces split exactly on that question: the live panel (+ the :7777
// pick/edit endpoint) needs the human's browser to open URLs on the machine the agent controls;
// the screenshot path doesn't. A local IDE agent (Cursor, Claude Code CLI, Windsurf) and a cloud
// container agent (Claude Code on the web, Codex cloud, CI) are the same loop with a different
// choosing moment — this module is how every tool knows which one it's in WITHOUT forking the
// product into "local mode" and "cloud mode".
//
// Detection is best-effort by design: we check env markers the major cloud sandboxes actually
// set (verified where we could), and every caller accepts an explicit `remote` override — the
// agent reading its own system prompt always knows better than our heuristic. Unknown
// environment ⇒ "local", because overclaiming remoteness would hide the best preview surface
// from the majority case.

// [marker env var, kind] — first hit wins. Two remote grades:
//   remote-container       nothing forwards ports to the human (claude.ai web sessions, CI,
//                          Codex cloud) — the panel and :7777 are unreachable BY DESIGN.
//   remote-port-forwarded  the platform tunnels localhost to the human's browser/IDE
//                          (Codespaces, Gitpod, Cloud Shell) — the panel CAN work, through the
//                          forwarded URL rather than a raw localhost one.
const MARKERS = [
  ["CLAUDE_CODE_REMOTE", "remote-container"], // Claude Code on the web / cloud sandbox
  ["CODEX_PROXY_CERT", "remote-container"], // OpenAI Codex cloud container
  ["CODESPACES", "remote-port-forwarded"], // GitHub Codespaces (auto-forwards ports)
  ["GITPOD_WORKSPACE_ID", "remote-port-forwarded"], // Gitpod (workspace URL port proxy)
  ["CLOUD_SHELL", "remote-port-forwarded"], // Google Cloud Shell (web preview)
];

/**
 * @param {{ remote?: boolean, env?: NodeJS.ProcessEnv }} opts
 *   remote — explicit override from the agent (true: treat as remote-container; false: local).
 * @returns {{ kind: string, remote: boolean, marker: string|null, overridden: boolean,
 *             portForwarded: boolean, localhostNote: string }}
 */
export function detectEnvironment({ remote, env = process.env } = {}) {
  let kind = "local";
  let marker = null;
  for (const [name, k] of MARKERS) {
    if (env[name]) {
      kind = k;
      marker = name;
      break;
    }
  }
  const overridden = remote === true || remote === false;
  if (remote === true && kind === "local") kind = "remote-container";
  if (remote === false) kind = "local";
  const isRemote = kind !== "local";
  const portForwarded = kind === "remote-port-forwarded";
  const localhostNote = !isRemote
    ? "Local session: the human can open this machine's localhost — the live panel and the :7777 pick/edit endpoint are the best choosing moment (start both as background tasks)."
    : portForwarded
      ? `Remote workspace with port forwarding (${marker}): the human can't open raw localhost URLs on this machine, but the platform forwards ports — the live panel and :7777 can work through the FORWARDED URLs. If forwarding is awkward, the screenshot path needs nothing from the human.`
      : `Remote container${marker ? ` (${marker})` : ""}: the human CANNOT reach this machine's localhost, by design — the live panel and the :7777 endpoint are not available to them here. Screenshots of the real site are the choosing moment, and copy edits route through you editing source directly.`;
  return { kind, remote: isRemote, marker: overridden ? marker : marker, overridden, portForwarded, localhostNote };
}

// The flow-level consequences of being remote, spelled out once so font_lab_start,
// live_instructions, and status all narrate the SAME contract instead of three drifting copies.
export function remoteWorkflowNote(environment) {
  if (!environment?.remote) return null;
  const parts = [
    environment.localhostNote,
    "Drive the pick with font_lab_screenshot_directions — it can start the project's dev server itself (managed, bound to 127.0.0.1, stopped after), so don't fight backgrounding: leave `ensureServer` on and show the human the hero shots in chat.",
    "If this workspace is EPHEMERAL (uncommitted work is lost when the container is reclaimed), committing is how work survives: put the human's font/copy changes and Font Lab's scaffolding in SEPARATE, labeled commits on your working branch and tell the human what you committed — but never push anywhere they didn't designate, and never merge.",
  ];
  return parts.join(" ");
}
