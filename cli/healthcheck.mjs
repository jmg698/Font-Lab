// The post-init healthcheck — "prove the page works BEFORE inviting the human."
//
// The filmed dogfood failed twice between `init` and the choosing moment, and both failures
// were invisible from the agent's chair until the human hit them:
//
//   1. A version-skewed init stamped a panel importing ./fl-census without writing the file →
//      Next 500 (Module not found) → white page that read as "the dev server is down".
//   2. A strict CSP (no dev 'unsafe-eval', no connect-src :7777) → page HTML served fine, the
//      client tree never hydrated → panel simply absent, picks/edits unreachable.
//
// This module is the tripwire for that whole class: version alignment (tool vs project install
// vs panel stamp vs endpoint), scaffold completeness (every file the panel imports actually on
// disk), a real GET against the homepage (200, with a 500-body sniff that names the missing
// module), the :7777 endpoint, and the CSP scan. The skill rule it exists to enforce:
// **do not invite the human until the healthcheck passes** — a white page or a missing panel
// is an agent failure to catch here, not a human setup step.
//
// Read-only: probes HTTP, reads files, starts nothing, writes nothing.

import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { VERSION, cmpVersions, isRealVersion, installedVersionIn } from "./version.mjs";
import { readDevServer, INIT_MARKER } from "./state.mjs";
import { scanCsp, ENDPOINT_PORT } from "./csp.mjs";

// ---- version skew -----------------------------------------------------------

// The npx-cache trap, decided at the moment it matters. `npx -y font-lab` freezes at whatever
// the cache resolved first; a long-lived MCP server keeps its boot version for the whole
// session. Either way the RUNNING tool and the PROJECT's installed font-lab drift apart — and a
// drifted init stamps a panel that doesn't match the package serving it. Null when aligned or
// when the project has no local font-lab to compare against.
export function versionSkew(projectDir) {
  const installed = installedVersionIn(projectDir);
  if (!installed || !isRealVersion(VERSION)) return null;
  const c = cmpVersions(VERSION, installed);
  if (c === 0) return null;
  const direction = c < 0 ? "tool-older" : "tool-newer";
  return {
    running: VERSION,
    installed,
    direction,
    message:
      direction === "tool-older"
        ? `this process runs font-lab ${VERSION} but the project has ${installed} installed — a stale MCP registration or npx cache. Fix: \`npx font-lab upgrade\` (re-pins the MCP to the project's own install), then RELOAD the agent session so the server restarts on ${installed}.`
        : `this process runs font-lab ${VERSION} but the project has ${installed} installed — the package is behind the tool. Fix: \`npx font-lab upgrade\` (brings the project package to ${VERSION} and re-stamps the panel).`,
  };
}

// ---- scaffold completeness --------------------------------------------------

const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"];

function resolveRelative(fromDir, spec) {
  const base = path.join(fromDir, spec);
  for (const ext of RESOLVE_EXTS) {
    const p = base + ext;
    if (existsSync(p)) return p;
  }
  for (const ext of RESOLVE_EXTS.slice(1)) {
    const p = path.join(base, "index" + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

// Every file the stamped panel actually imports must exist — the exact class that shipped in
// the field as `Module not found: Can't resolve './fl-census'` → Next 500 → "3005 isn't
// working". Statically scans app/_fontlab/ for relative import/require specifiers and resolves
// each against the disk. Pure + cheap (no bundler, no dev server needed).
export function checkScaffold(projectDir) {
  const dir = path.resolve(projectDir);
  const appDir = ["app", "src/app"].map((d) => path.join(dir, d)).find((d) => existsSync(path.join(d, "layout.tsx")));
  const panelDir = appDir
    ? path.join(appDir, "_fontlab")
    : ["app", "src/app"].map((d) => path.join(dir, d, "_fontlab")).find((d) => existsSync(d)) || null;
  const out = {
    installed: false,
    complete: false,
    panelDir: panelDir ? path.relative(dir, panelDir) : null,
    layoutMounted: false,
    missing: [],
    unresolvedImports: [],
  };
  if (!panelDir || !existsSync(panelDir)) return out; // nothing stamped — not an error by itself
  out.installed = true;

  // The three files a healthy init writes, by name (catalog.generated is written by the
  // preview build; the panel imports it, so its absence is a 500 in waiting).
  for (const f of ["FontLabDevPanel.tsx", "fl-census.ts", "catalog.generated.ts"]) {
    if (!existsSync(path.join(panelDir, f))) out.missing.push(path.join(out.panelDir, f));
  }

  // Then the general tripwire: every relative specifier in every scaffold file must resolve —
  // catches template/init drift we haven't named yet, not just the files we know today.
  let entries = [];
  try {
    entries = readdirSync(panelDir).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
  } catch {}
  // Covers every specifier shape the scaffold uses: `from "./x"`, bare side-effect
  // `import "./fl-census"` (the exact import the field bug shipped broken), dynamic
  // `import("./x")`, and `require("./x")`.
  const importRe = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["'](\.\.?\/[^"']+)["']/g;
  for (const f of entries) {
    let src = "";
    try {
      src = readFileSync(path.join(panelDir, f), "utf8");
    } catch {
      continue;
    }
    let m;
    while ((m = importRe.exec(src))) {
      if (!resolveRelative(panelDir, m[1])) out.unresolvedImports.push({ file: path.join(out.panelDir, f), specifier: m[1] });
    }
  }

  // The layout must actually mount the panel (the fenced init block) — files on disk with no
  // mount is a panel that will never render.
  if (appDir) {
    try {
      const layout = readFileSync(path.join(appDir, "layout.tsx"), "utf8");
      out.layoutMounted = layout.includes(INIT_MARKER) && /<FontLabDevPanel\s*\/>/.test(layout);
    } catch {}
  }

  out.complete = out.installed && out.layoutMounted && !out.missing.length && !out.unresolvedImports.length;
  return out;
}

// ---- probes -----------------------------------------------------------------

async function probe(url, { timeoutMs = 2500, asJson = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "manual" });
    const body = asJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
    return { reachable: true, status: res.status, body };
  } catch (e) {
    return { reachable: false, error: String(e?.cause?.code || e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// A Next dev 500 page carries the compiler error in its HTML — name the module instead of
// making the agent (or worse, the human) guess from a white page.
export function sniffModuleError(body) {
  const text = String(body || "");
  const m =
    text.match(/Module not found[^"'<]*(?:Can't|Cannot) resolve '([^']+)'/i) ||
    text.match(/Cannot find module '([^']+)'/i) ||
    (/Module not found/i.test(text) ? [null, null] : null);
  if (!m) return null;
  return { moduleNotFound: true, specifier: m[1] || null };
}

// ---- the healthcheck --------------------------------------------------------

// One pass over everything that must be true before "open your site and pick": versions,
// scaffold, homepage, endpoint, CSP. Returns { ready, blockers, warnings, checks, nextStep }.
// Severity is honest to the path: on a live-panel stack a broken scaffold/CSP is a blocker;
// a dev server that simply isn't running is a warning (screenshot/verify tools start it
// themselves) UNLESS an explicit baseUrl was handed in — then unreachable means broken.
export async function healthcheck(projectDir, { baseUrl, port = ENDPOINT_PORT, timeoutMs = 2500, analysis = null } = {}) {
  const dir = path.resolve(projectDir);
  const blockers = [];
  const warnings = [];
  const block = (id, what, fix) => blockers.push({ id, what, fix });
  const warn = (id, what, fix) => warnings.push({ id, what, ...(fix ? { fix } : {}) });

  // Which loop is this project on? (Analysis may legitimately fail — an unsupported dir still
  // deserves the version/CSP/endpoint checks.)
  let livePanel = false;
  try {
    if (!analysis) {
      const { analyzeProject } = await import("./analyzer.mjs");
      analysis = analyzeProject(dir);
    }
    livePanel = !!analysis?.capabilities?.livePanel;
  } catch (e) {
    warn("analyze-failed", `project analysis failed (${e.message}) — version/CSP/endpoint checks still ran.`);
  }

  // 1) versions — the running tool, the project's install, the panel stamp, the endpoint.
  const skew = versionSkew(dir);
  const versions = { tool: VERSION, installed: installedVersionIn(dir), panel: null, endpoint: null };
  if (skew) block("version-skew", `font-lab version skew: ${skew.message}`, "npx font-lab upgrade — then reload the agent session.");

  // 2) scaffold completeness (live-panel stacks only — nothing mounts elsewhere).
  const scaffold = livePanel ? checkScaffold(dir) : { installed: false, notApplicable: true };
  if (livePanel && scaffold.installed) {
    try {
      const panelSrc = readFileSync(path.join(dir, scaffold.panelDir, "FontLabDevPanel.tsx"), "utf8");
      const m = panelSrc.match(/PANEL_VERSION\s*=\s*["']([^"']+)["']/);
      if (m && isRealVersion(m[1])) versions.panel = m[1];
    } catch {}
    if (versions.panel && isRealVersion(VERSION) && cmpVersions(VERSION, versions.panel) > 0)
      warn("panel-stale", `the stamped panel is v${versions.panel} but v${VERSION} is running.`, "npx font-lab upgrade (re-stamps, keeping the human's directions) — or font_lab_init.");
    if (!scaffold.complete) {
      const what = [
        scaffold.missing.length ? `missing files: ${scaffold.missing.join(", ")}` : null,
        scaffold.unresolvedImports.length
          ? `unresolved imports: ${scaffold.unresolvedImports.map((u) => `${u.file} → "${u.specifier}"`).join(", ")}`
          : null,
        !scaffold.layoutMounted ? "panel not mounted in layout.tsx" : null,
      ]
        .filter(Boolean)
        .join("; ");
      block(
        "scaffold-incomplete",
        `panel scaffold is incomplete (${what}) — Next will 500 (Module not found) and the site reads as a dead server.`,
        "npx font-lab upgrade re-stamps the whole scaffold at the installed version (or re-run font_lab_init).",
      );
    }
  } else if (livePanel && !scaffold.installed) {
    warn("not-inited", "no panel scaffold in this project yet.", "font_lab_init({ projectDir, directions }) mounts it (after compose).");
  }

  // 3) the dev server — a REAL GET against the page the human would open.
  const explicitBase = !!baseUrl;
  if (!baseUrl) baseUrl = readDevServer(dir)?.origin || null;
  let devServer = { checked: false };
  if (baseUrl) {
    const base = String(baseUrl).replace(/\/+$/, "");
    const r = await probe(base + "/", { timeoutMs });
    devServer = { checked: true, url: base, ...(r.reachable ? { up: true, status: r.status } : { up: false, error: r.error }) };
    if (!r.reachable) {
      const what = `dev server at ${base} is not responding.`;
      const fix = "restart it (background task, bound to 127.0.0.1) — or use font_lab_screenshot_directions / font_lab_verify, which start it themselves.";
      explicitBase ? block("dev-server-down", what, fix) : warn("dev-server-down", what, fix);
    } else if (r.status >= 500) {
      const sniff = sniffModuleError(r.body);
      devServer.moduleError = sniff?.specifier || null;
      block(
        "dev-server-500",
        `the homepage returns ${r.status}${sniff ? ` — Module not found${sniff.specifier ? `: "${sniff.specifier}"` : ""}` : ""}. The browser shows a white/error page; it LOOKS like a dead server but is a build error.`,
        sniff
          ? "a stale/incomplete Font Lab scaffold is the usual cause: npx font-lab upgrade re-stamps it (then reload the page). If the module isn't Font Lab's, read the dev server log."
          : "read the dev server output for the compile error.",
      );
    } else if (r.status >= 400) {
      warn("dev-server-4xx", `the homepage returns ${r.status} — check the route (the panel mounts on every page of the App Router layout).`);
    }
  } else {
    devServer = { checked: false, note: "no dev server recorded or passed — not fatal (screenshot/verify start one themselves), but the LIVE panel path needs it running." };
    if (livePanel) warn("dev-server-unknown", devServer.note);
  }

  // 4) the :7777 pick/edit endpoint.
  const ep = await probe(`http://127.0.0.1:${port}/status`, { timeoutMs: Math.min(timeoutMs, 1200), asJson: true });
  const endpoint = ep.reachable && ep.body?.ok ? { up: true, port, version: ep.body.version ?? null } : { up: false, port };
  if (endpoint.up) {
    versions.endpoint = endpoint.version;
    if (isRealVersion(endpoint.version) && isRealVersion(VERSION) && cmpVersions(VERSION, endpoint.version) > 0) {
      endpoint.stale = true;
      warn("endpoint-stale", `the :${port} endpoint runs v${endpoint.version}, tool is v${VERSION}.`, `relaunch \`npx font-lab serve --project <dir>\` — the new serve takes the port over from a stale one automatically.`);
    }
  } else if (livePanel) {
    warn("endpoint-down", `no pick/edit endpoint on :${port} — the panel will show OFFLINE and picks/copy edits won't save.`, "start it as a background task before inviting the human: npx font-lab --project <dir> (ARM FIRST, INVITE SECOND).");
  }

  // 5) CSP — the silent panel-killer. Blockers only where the human's browser runs the panel.
  const csp = scanCsp(dir, { port });
  for (const b of csp.blockers) {
    const what = `CSP in ${b.file}: ${b.directive} is missing ${b.missing} — ${b.why}`;
    const fix = "apply the dev-only allowance (see csp.patch) and RESTART the dev server (headers are startup-bound).";
    livePanel ? block(`csp-${b.id}`, what, fix) : warn(`csp-${b.id}`, what, fix);
  }
  for (const w of csp.warnings) warn(`csp-${w.id}`, `CSP in ${w.file}: ${w.note || w.why}`);

  const ready = blockers.length === 0;
  return {
    ready,
    blockers,
    warnings,
    checks: { versions, ...(skew ? { versionSkew: skew } : {}), scaffold, devServer, endpoint, csp },
    nextStep: ready
      ? livePanel
        ? (devServer.up
            ? `All clear — ARM a listener (serve --once as a background task, or font_lab_wait), THEN invite the human to open ${devServer.url} and pick.`
            : "No blockers — start the dev server (background task), re-run this healthcheck to confirm the page serves, then arm a listener and invite the human.") +
          " Address warnings if any name the live-panel path."
        : "No blockers for this stack's loop (screenshots → select → apply). Warnings, if any, name what to tidy."
      : "Do NOT invite the human to open the site yet — clear the blockers first (each carries its fix), then re-run font_lab_healthcheck until ready:true.",
  };
}
