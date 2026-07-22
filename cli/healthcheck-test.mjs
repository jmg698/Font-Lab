// Healthcheck + version-skew gate + CSP scan — offline. Reproduces the two filmed-demo
// failures and proves they are now caught BEFORE the human is invited:
//
//   1. Version skew: an init running a different font-lab than the project's installed package
//      REFUSES to stamp (the 0.11-MCP-vs-0.13-project trap that shipped a panel importing
//      ./fl-census with no file behind it → Next 500 → "the dev server is down").
//   2. CSP: a strict policy (no dev 'unsafe-eval', no connect-src :7777) is reported as named
//      blockers with a paste-ready patch — instead of a hydration-dead page with no panel.
//
// Plus the tripwires around them: scaffold completeness (missing files, unresolved imports —
// including the BARE `import "./fl-census"` form), the homepage 500-body module sniff, and
// the one-pass healthcheck verdict the skill's VERIFY-FIRST rule acts on.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VERSION } from "./version.mjs";
import { parsePolicy, evaluatePolicy, allowsEndpoint, scanCsp, buildPatch } from "./csp.mjs";
import { versionSkew, checkScaffold, sniffModuleError, healthcheck } from "./healthcheck.mjs";
import * as engine from "./engine.mjs";

const FIXTURE = fileURLToPath(new URL("../examples/clean-next-site/", import.meta.url));
const APP = fileURLToPath(new URL("./out/healthcheck-fixture/", import.meta.url));

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

const DIRECTION = {
  id: "x",
  name: "X",
  vibe: "v",
  rationale: "r",
  roles: { display: { family: "Fraunces", weights: [400] }, body: { family: "Libre Franklin", weights: [400] }, mono: { family: "JetBrains Mono", weights: [400] } },
};
const setInstalled = (v) => {
  mkdirSync(APP + "node_modules/font-lab", { recursive: true });
  writeFileSync(APP + "node_modules/font-lab/package.json", JSON.stringify({ name: "font-lab", version: v }) + "\n");
};

try {
  // ---- CSP: parse + evaluate (pure) -------------------------------------------
  const pol = parsePolicy("default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self' http://127.0.0.1:7777");
  assert("parsePolicy splits directives", pol.get("script-src")?.length === 2 && pol.get("connect-src")?.length === 2);

  assert("allowsEndpoint: exact 127.0.0.1:7777", allowsEndpoint(["'self'", "http://127.0.0.1:7777"]));
  assert("allowsEndpoint: localhost wildcard port", allowsEndpoint(["http://localhost:*"]));
  assert("allowsEndpoint: bare * allows", allowsEndpoint(["*"]));
  assert("allowsEndpoint: 'self' alone blocks", !allowsEndpoint(["'self'"]));
  assert("allowsEndpoint: wrong port blocks", !allowsEndpoint(["http://127.0.0.1:3000"]));

  const evalFind = (policy) => evaluatePolicy(parsePolicy(policy)).map((f) => f.id);
  assert("strict script-src flags unsafe-eval", evalFind("script-src 'self'").includes("script-unsafe-eval"));
  assert("unsafe-eval present → clean", !evalFind("script-src 'self' 'unsafe-eval'").includes("script-unsafe-eval"));
  assert("connect-src 'self' flags endpoint", evalFind("connect-src 'self'").includes("connect-endpoint"));
  assert("connect-src with :7777 → clean", !evalFind("connect-src 'self' http://localhost:7777").includes("connect-endpoint"));
  const dsOnly = evalFind("default-src 'self'");
  assert("default-src-only fallback flags all three", dsOnly.includes("script-unsafe-eval") && dsOnly.includes("connect-endpoint") && dsOnly.includes("style-unsafe-inline"));
  const patch = buildPatch(evaluatePolicy(parsePolicy("default-src 'self'")));
  assert("patch names the dev-only allowances", /'unsafe-eval'/.test(patch) && /127\.0\.0\.1:7777/.test(patch) && /RESTART/i.test(patch));

  // ---- fixture: a clean Next project ------------------------------------------
  rmSync(APP, { recursive: true, force: true });
  mkdirSync(APP + "app", { recursive: true });
  for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) cpSync(FIXTURE + f, APP + f);

  // ---- version skew: the gate at init -----------------------------------------
  assert("no local install → no skew", versionSkew(APP) === null);
  setInstalled("99.0.0");
  const skew = versionSkew(APP);
  assert("skew detected against project install", skew?.installed === "99.0.0" && skew?.direction === "tool-older");
  assert("skew message names the fix", /upgrade/i.test(skew?.message || "") && /reload/i.test(skew?.message || ""));

  let refused = null;
  try {
    await engine.init(APP, { directions: [DIRECTION], fetch: false, log: () => {} });
  } catch (e) {
    refused = e.message;
  }
  assert("init REFUSES on version skew (the filmed bug)", /VERSION SKEW/i.test(refused || ""), refused || "no throw");
  assert("refusal points at npx font-lab upgrade", /npx font-lab upgrade/.test(refused || ""));
  assert("nothing was stamped by the refused init", !existsSync(APP + "app/_fontlab"));

  let prepRefused = null;
  try {
    await engine.preparePreview(APP, { directions: [DIRECTION], fetch: false, log: () => {} });
  } catch (e) {
    prepRefused = e.message;
  }
  assert("prepare_preview refuses on skew too", /VERSION SKEW/i.test(prepRefused || ""));

  const allowed = await engine.init(APP, { directions: [DIRECTION], fetch: false, allowVersionSkew: true, log: () => {} });
  assert("allowVersionSkew overrides deliberately", allowed.mounted === true && allowed.versionSkewAllowed?.installed === "99.0.0");

  // status surfaces the same skew (the quiet layer under the loud gate)
  const st = await engine.status(APP, { port: 59993 });
  assert("status.versions carries installed + skew", st.versions.installed === "99.0.0" && st.versions.skew?.direction === "tool-older");

  // ---- aligned install: init succeeds and self-checks --------------------------
  rmSync(APP + "app/_fontlab", { recursive: true, force: true });
  setInstalled(VERSION);
  assert("aligned install → no skew", versionSkew(APP) === null);
  const r = await engine.init(APP, { directions: [DIRECTION], fetch: false, log: () => {} });
  assert("init reports selfCheck.complete", r.selfCheck?.complete === true);
  assert("init nextStep routes through healthcheck", /font_lab_healthcheck/.test(r.nextStep) && /ready:true/.test(r.nextStep));

  // ---- scaffold completeness: the fl-census class ------------------------------
  let sc = checkScaffold(APP);
  assert("healthy scaffold is complete", sc.complete === true && sc.layoutMounted === true, JSON.stringify(sc));

  rmSync(APP + "app/_fontlab/fl-census.ts");
  sc = checkScaffold(APP);
  assert("missing fl-census.ts caught by name", sc.missing.some((m) => m.includes("fl-census")));
  assert("bare `import \"./fl-census\"` caught as unresolved", sc.unresolvedImports.some((u) => u.specifier === "./fl-census"), JSON.stringify(sc.unresolvedImports));
  assert("scaffold flagged incomplete", sc.complete === false);

  // ---- healthcheck: the one-pass verdict ---------------------------------------
  let hc = await healthcheck(APP, { port: 59993, timeoutMs: 600 });
  assert("healthcheck blocks on incomplete scaffold", hc.ready === false && hc.blockers.some((b) => b.id === "scaffold-incomplete"));
  assert("scaffold blocker names the fix", hc.blockers.find((b) => b.id === "scaffold-incomplete")?.fix.includes("upgrade"));
  assert("do-not-invite rides the verdict", /Do NOT invite/i.test(hc.nextStep));

  // restore the census → ready (endpoint/dev-server down are warnings, not blockers)
  cpSync(fileURLToPath(new URL("./templates/fl-census.ts", import.meta.url)), APP + "app/_fontlab/fl-census.ts");
  hc = await healthcheck(APP, { port: 59993, timeoutMs: 600 });
  assert("complete scaffold + aligned versions → ready", hc.ready === true, JSON.stringify(hc.blockers));
  assert("endpoint down is a warning, not a blocker", hc.warnings.some((w) => w.id === "endpoint-down"));
  assert("arm-first rides the ready nextStep", /ARM|listener/i.test(hc.nextStep));

  // ---- CSP scan on real config files -------------------------------------------
  writeFileSync(
    APP + "next.config.mjs",
    `const csp = "default-src 'self'; script-src 'self'; connect-src 'self'";\n` +
      `export default { async headers() { return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: csp }] }]; } };\n`,
  );
  const scan = scanCsp(APP);
  assert("scan finds the policy file", scan.policies.some((p) => p.file === "next.config.mjs" && p.confidence === "exact"));
  assert("strict CSP → blockers (eval + connect)", scan.blockers.some((b) => b.id === "script-unsafe-eval") && scan.blockers.some((b) => b.id === "connect-endpoint"));
  assert("scan note teaches the restart rule", /RESTART/i.test(scan.note));

  hc = await healthcheck(APP, { port: 59993, timeoutMs: 600 });
  assert("healthcheck blocks on CSP for the live panel", hc.ready === false && hc.blockers.some((b) => b.id.startsWith("csp-")));
  assert("CSP blocker fix points at the patch + restart", /csp\.patch/i.test(hc.blockers.find((b) => b.id.startsWith("csp-"))?.fix || "") );

  // conditional (dev-branched) CSP → verify warning, never a false-positive blocker
  writeFileSync(
    APP + "next.config.mjs",
    "const isDev = process.env.NODE_ENV !== \"production\";\n" +
      "const csp = `default-src 'self'; script-src 'self'${isDev ? \" 'unsafe-eval'\" : \"\"}; connect-src 'self'${isDev ? \" http://127.0.0.1:7777\" : \"\"}`;\n" +
      `export default { async headers() { return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: csp }] }]; } };\n`,
  );
  const scan2 = scanCsp(APP);
  assert("conditional policy → no hard blockers", scan2.blockers.length === 0, JSON.stringify(scan2.blockers));
  assert("conditional policy → verify warnings", scan2.warnings.length > 0 && scan2.warnings.every((w) => /confirm|verify/i.test(w.note || "")));
  rmSync(APP + "next.config.mjs");

  // ---- the homepage probe: 500-body module sniff -------------------------------
  const sniff = sniffModuleError(`<html><body>Module not found: Can't resolve './fl-census'</body></html>`);
  assert("sniff names the missing module", sniff?.specifier === "./fl-census");
  assert("sniff handles Cannot find module", sniffModuleError("Error: Cannot find module './catalog.generated'")?.specifier === "./catalog.generated");
  assert("sniff null on healthy body", sniffModuleError("<html>fine</html>") === null);

  const srv500 = createServer((_q, res) => {
    res.writeHead(500, { "content-type": "text/html" });
    res.end(`<html><body><h1>500</h1><pre>Module not found: Can't resolve './fl-census'</pre></body></html>`);
  });
  await new Promise((ok) => srv500.listen(59981, "127.0.0.1", ok));
  hc = await healthcheck(APP, { baseUrl: "http://127.0.0.1:59981", port: 59993, timeoutMs: 1500 });
  srv500.close();
  const b500 = hc.blockers.find((b) => b.id === "dev-server-500");
  assert("live 500 → blocker naming the module", !!b500 && /fl-census/.test(b500.what), JSON.stringify(hc.blockers));
  assert("500 blocker prescribes upgrade, not guessing", /upgrade/.test(b500?.fix || ""));
  assert("white-page ambiguity is named (build error, not dead server)", /LOOKS like a dead server|build error/i.test(b500?.what || ""));

  const srv200 = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>ok</body></html>");
  });
  await new Promise((ok) => srv200.listen(59982, "127.0.0.1", ok));
  hc = await healthcheck(APP, { baseUrl: "http://127.0.0.1:59982", port: 59993, timeoutMs: 1500 });
  srv200.close();
  assert("healthy homepage → devServer.up + ready", hc.checks.devServer.up === true && hc.ready === true, JSON.stringify(hc.blockers));

  // explicit baseUrl unreachable → blocker (implicit would be a warning)
  hc = await healthcheck(APP, { baseUrl: "http://127.0.0.1:59983", port: 59993, timeoutMs: 700 });
  assert("explicit dead baseUrl → blocker", hc.blockers.some((b) => b.id === "dev-server-down"));
} finally {
  rmSync(APP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
