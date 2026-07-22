// The one place the running tool's version comes from. In CI the release tag is stamped into
// package.json before publish, so VERSION is always the real published version at runtime.
// Used to stamp what installed a project's panel and to warn when the panel goes stale.

import path from "node:path";
import { readFileSync } from "node:fs";

export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

// The version the PROJECT has installed (node_modules/font-lab) — the other half of every
// skew comparison. Null when font-lab isn't a project-local dep (nothing to compare against).
export function installedVersionIn(projectDir) {
  try {
    const v = JSON.parse(readFileSync(path.join(path.resolve(projectDir), "node_modules", "font-lab", "package.json"), "utf8")).version;
    return isRealVersion(v) ? v : null;
  } catch {
    return null;
  }
}

// Semver-ish compare on the numeric x.y.z head (ignores prerelease tags — good enough for
// "is the running tool newer than what installed this panel"). >0 => a newer, <0 => b newer.
export function cmpVersions(a, b) {
  const parse = (v) => String(v || "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export const isRealVersion = (v) => /^\d+\.\d+\.\d+/.test(String(v || ""));
