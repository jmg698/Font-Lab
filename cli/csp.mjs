// Content-Security-Policy scan — the "site loaded, but no Font Lab panel" class, detected
// BEFORE the human hits it. A strict CSP kills the live panel in two silent ways (both from the
// filmed dogfood):
//
//   1. `script-src` without dev `'unsafe-eval'` — Next dev (webpack/HMR/React Refresh) can't
//      run, the client tree never hydrates, and the panel (a client component) simply never
//      appears. The page HTML looks fine; the browser console is the only witness.
//   2. `connect-src` without the :7777 endpoint — even a mounted panel can't reach the
//      pick/copy-edit endpoint, so picks and edits fail (the panel shows OFFLINE).
//
// The engine's own headless captures are immune (they launch with bypassCSP — measurement,
// not policy), which is exactly why the HUMAN's browser needs this scan: the screenshots can
// look perfect while the live panel is dead. Scope: next dev serves headers from next.config.*
// and middleware; a <meta http-equiv> in the layout binds every environment. (Host-level
// headers — vercel.json, netlify.toml — don't apply to `next dev`, so they aren't scanned.)
//
// Read-only, regex-extraction (never executes project code). Config values are often built
// conditionally (`${isDev ? "'unsafe-eval'" : ""}`) — a token that appears only inside an
// interpolation is reported as a VERIFY warning, not a blocker: we refuse to guess which
// branch dev gets, and say so.

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const ENDPOINT_PORT = 7777;

// Candidate files, in the order a Next server actually sources CSP from in dev.
const CSP_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
  "middleware.ts",
  "middleware.js",
  "src/middleware.ts",
  "src/middleware.js",
  "app/layout.tsx",
  "src/app/layout.tsx",
];

// A string "looks like a CSP value" when it names a fetch directive. Single-directive
// fragments count too — array-joined policies are a common authoring pattern.
const DIRECTIVE_RE = /(?:^|;|\s)((?:default|script|style|connect|img|font|frame|worker|media|object)-src(?:-elem|-attr)?|base-uri|form-action)\b/;

// ---- parsing ----------------------------------------------------------------

// "script-src 'self' 'unsafe-eval'; connect-src 'self'" -> Map(directive -> [tokens])
export function parsePolicy(text) {
  const map = new Map();
  for (const part of String(text).split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    if (!DIRECTIVE_RE.test(name + " ")) continue;
    const prev = map.get(name) || [];
    map.set(name, [...prev, ...tokens.slice(1)]);
  }
  return map;
}

// Pull every string/template literal out of a source file that reads like a CSP value.
// Template literals keep their ${…} segments; we record which tokens live only there.
function extractPolicyStrings(src) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[2];
    if (!DIRECTIVE_RE.test(raw)) continue;
    if (raw.length > 4000) continue; // not a policy — a bundle or data blob
    out.push({ raw, template: m[1] === "`" && raw.includes("${") });
  }
  return out;
}

// Merge every policy fragment found in one file into a single directive map (array-joined
// policies arrive as fragments; variants that repeat a directive union their tokens and are
// flagged, so a dev/prod pair downgrades findings to "verify" instead of a false positive).
function mergeFragments(fragments) {
  const merged = new Map();
  let variants = false;
  let template = false;
  for (const f of fragments) {
    template = template || f.template;
    for (const [dir, tokens] of parsePolicy(f.raw)) {
      if (merged.has(dir)) {
        variants = true;
        merged.set(dir, [...new Set([...merged.get(dir), ...tokens])]);
      } else merged.set(dir, tokens);
    }
  }
  return { merged, variants, template };
}

// ---- evaluation -------------------------------------------------------------

const hasToken = (tokens, t) => tokens.some((x) => x.toLowerCase() === t);

// Does a connect-src token list allow http://127.0.0.1:PORT / http://localhost:PORT ?
export function allowsEndpoint(tokens, port = ENDPOINT_PORT) {
  return tokens.some((raw) => {
    const t = raw.toLowerCase().replace(/\/+$/, "");
    if (t === "*" || t === "http:" || t === "http://*") return true;
    const m = t.match(/^(?:http:\/\/)?(localhost|127\.0\.0\.1)(?::(\*|\d+))?$/);
    if (!m) return false;
    return m[2] === "*" || m[2] === String(port);
  });
}

// Evaluate ONE merged policy for the three live-panel blockers. `confidence` is "exact" for a
// plain string policy, "verify" when the policy is templated/varianted — then findings demote
// to warnings with instructions to confirm the dev branch.
export function evaluatePolicy(merged, { port = ENDPOINT_PORT, sourceText = "" } = {}) {
  const findings = [];
  const effective = (dir) => merged.get(dir) ?? merged.get("default-src") ?? null;
  const conditional = (token) => sourceText.includes(token); // present somewhere (an interpolated branch)

  const script = effective("script-src");
  if (script && !hasToken(script, "'unsafe-eval'"))
    findings.push({
      id: "script-unsafe-eval",
      directive: merged.has("script-src") ? "script-src" : "default-src",
      missing: "'unsafe-eval'",
      conditional: conditional("'unsafe-eval'"),
      why: "Next dev (webpack/HMR/React Refresh) needs 'unsafe-eval' in development. Without it the client tree never hydrates — the page renders but NO client component runs, so the Font Lab panel never appears (a silent white-page-adjacent failure).",
    });

  const connect = effective("connect-src");
  if (connect && !allowsEndpoint(connect, port))
    findings.push({
      id: "connect-endpoint",
      directive: merged.has("connect-src") ? "connect-src" : "default-src",
      missing: `http://127.0.0.1:${port} http://localhost:${port}`,
      conditional: conditional(`:${port}`),
      why: `The panel talks to the Font Lab pick/copy-edit endpoint on :${port}; 'self' doesn't cover it (different origin). Blocked connect-src = the panel mounts but shows OFFLINE — picks and double-click copy edits fail.`,
    });

  const style = merged.get("style-src") ?? merged.get("style-src-elem") ?? merged.get("default-src") ?? null;
  if (style && !hasToken(style, "'unsafe-inline'"))
    findings.push({
      id: "style-unsafe-inline",
      directive: merged.has("style-src") ? "style-src" : merged.has("style-src-elem") ? "style-src-elem" : "default-src",
      missing: "'unsafe-inline'",
      conditional: conditional("'unsafe-inline'"),
      why: "Next dev injects styles at runtime and the panel previews by injecting a stylesheet (nonces can't attach to runtime-injected tags). Without dev 'unsafe-inline' in style-src, dev styling and the panel's font painting are blocked.",
    });

  return findings;
}

// ---- the paste-ready patch --------------------------------------------------

export function buildPatch(findings, { port = ENDPOINT_PORT } = {}) {
  if (!findings.length) return null;
  const lines = [
    "// Dev-only CSP allowances Font Lab needs. Headers are read at SERVER START —",
    "// RESTART `next dev` after editing next.config.* or middleware, or nothing changes.",
    `const isDev = process.env.NODE_ENV !== "production";`,
    "// Merge into your Content-Security-Policy value:",
  ];
  const has = (id) => findings.some((f) => f.id === id);
  if (has("script-unsafe-eval"))
    lines.push(`//   script-src:  add  'unsafe-eval'                                  (dev only — HMR/React Refresh; without it the page never hydrates)`);
  if (has("connect-endpoint"))
    lines.push(`//   connect-src: add  http://127.0.0.1:${port} http://localhost:${port}    (dev only — the Font Lab pick/edit endpoint)`);
  if (has("style-unsafe-inline"))
    lines.push(`//   style-src:   add  'unsafe-inline'                                (dev only — runtime-injected dev styles + the panel's preview paint)`);
  lines.push(
    "// Example shape:",
    "//   `script-src 'self'${isDev ? \" 'unsafe-eval'\" : \"\"}; connect-src 'self'${isDev ? \" http://127.0.0.1:" +
      port +
      " http://localhost:" +
      port +
      "\" : \"\"}; …`",
  );
  return lines.join("\n");
}

// ---- the scan ---------------------------------------------------------------

// Read-only scan of the project for CSPs that would break the live panel in the HUMAN's
// browser. Returns { policies, blockers, warnings, patch, note } — a `conditional`/varianted
// finding lands in `warnings` (confirm the dev branch), a plain missing token in `blockers`.
export function scanCsp(projectDir, { port = ENDPOINT_PORT } = {}) {
  const dir = path.resolve(projectDir);
  const policies = [];
  const blockers = [];
  const warnings = [];

  for (const rel of CSP_FILES) {
    const file = path.join(dir, rel);
    if (!existsSync(file)) continue;
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/content-security-policy/i.test(src)) continue;
    const fragments = extractPolicyStrings(src);
    if (!fragments.length) {
      warnings.push({
        id: "csp-unparsed",
        file: rel,
        note: "Content-Security-Policy is referenced here but no policy string could be extracted (fully computed?). Verify manually that dev allows 'unsafe-eval' and connect-src to :" + port + ".",
      });
      continue;
    }
    const { merged, variants, template } = mergeFragments(fragments);
    const findings = evaluatePolicy(merged, { port, sourceText: src });
    const exact = !variants && !template;
    policies.push({
      file: rel,
      directives: Object.fromEntries(merged),
      confidence: exact ? "exact" : "verify",
      findings: findings.map((f) => f.id),
    });
    for (const f of findings) {
      const entry = { ...f, file: rel };
      if (exact && !f.conditional) blockers.push(entry);
      else
        warnings.push({
          ...entry,
          note: f.conditional
            ? `"${f.missing}" appears only in a computed/conditional branch — confirm the DEV build actually includes it (NODE_ENV=development), then restart the dev server.`
            : "This policy is built from variants/templates — confirm the DEV variant includes the allowance, then restart the dev server.",
        });
    }
  }

  const all = [...blockers, ...warnings.filter((w) => w.missing)];
  return {
    scanned: true,
    policies,
    blockers,
    warnings,
    patch: buildPatch(all, { port }),
    note: policies.length
      ? "Next reads headers at SERVER START: after any next.config.*/middleware CSP change, the dev server must be RESTARTED or the old policy keeps serving."
      : "no Content-Security-Policy found in next.config.*/middleware/layout — nothing blocks the panel.",
  };
}
