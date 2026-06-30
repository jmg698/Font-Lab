// Font Lab — flow control for the preview/build step (v2): intake gating (#2) + menu growth (#4).
// Pure and dependency-free, so the routing rules are unit-tested directly (flow-test.mjs).

export const NO_BRIEF_MESSAGE =
  "Font Lab is intake-first — don't mount the generic default menu. Call font_lab_start, ask the " +
  "user the brief questions (what feeling? how bold a departure? brand to evoke/avoid?), compose " +
  "tailored directions with font_lab_compose_directions, then pass those `directions` here. Only " +
  "if the user explicitly wants the deterministic default menu, pass allowFallback: true.";

// init / preparePreview should build the panel from the directions the agent composed FOR a brief.
// With no directions, refuse — unless the caller opts into the deterministic fallback — so an agent
// can't silently mount the generic default menu without asking the user first. Returns the mode.
export function resolveDirectionsMode({ directions, allowFallback } = {}) {
  if (Array.isArray(directions) && directions.length) return "composed";
  if (allowFallback) return "fallback";
  throw new Error(NO_BRIEF_MESSAGE);
}

// Grow the live menu (#4): merge newly-composed directions into the current preview set, de-duping
// by id (incoming wins) and preserving order, so "show me more" APPENDS instead of replacing.
export function mergeDirections(existing = [], incoming = []) {
  const byId = new Map();
  for (const d of [...(existing || []), ...(incoming || [])]) {
    if (d && d.id) byId.set(d.id, d);
  }
  return [...byId.values()];
}
