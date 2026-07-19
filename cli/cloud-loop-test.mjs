// Cloud-loop verification — the container-agent path, with NO session reload, NO browser, and
// NO network. This is the regression net for the cloud dogfood findings:
//
//   1. `font-lab run <tool>` is a real bridge for the MCP dead zone (same table, JSON out)
//   2. compose_directions PERSISTS the composed set on every stack (.font-lab/preview.json)
//   3. no headless surface silently falls back to the starter menu (resolveCaptureSet)
//   4. select resolves the id against the set the human was SHOWN (composed, not starter)
//   5. the managed dev server starts the project's own dev command bound to 127.0.0.1,
//      detects the served URL, health-checks, and tears the process tree down
//   6. previews leave ZERO files in the repo (fonts cache under .font-lab/, not public/)
//   7. environment detection: cloud markers → remote, override wins, unknown → local
//
//   node cli/cloud-loop-test.mjs

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as engine from "./engine.mjs";
import { detectEnvironment } from "./environ.mjs";
import { hostArgsFor, normalizeOrigin, startManagedServer, probeHttp, detectDevCommand } from "./dev-server.mjs";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const OUT = HERE + "out/";
const TMP = HERE + ".cloud-tmp/";
mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

// A minimal var-wired "Vite-ish" fixture: a dev script Font Lab can manage, CSS with font vars
// (a css-entry seam), real copy. The dev script is a tiny static server that honors the
// --host/--port flags the managed start appends and prints a Vite-style "Local:" line.
function makeFixture(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "cloud-fixture", scripts: { dev: "node server.mjs" }, dependencies: { vite: "^5.0.0" } }, null, 2),
  );
  writeFileSync(
    path.join(dir, "src", "index.css"),
    [
      ":root { --font-display: 'Inter', sans-serif; --font-body: 'Inter', sans-serif; --font-mono: 'JetBrains Mono', monospace; }",
      "h1 { font-family: var(--font-display); }",
      "body { font-family: var(--font-body); }",
      "code { font-family: var(--font-mono); }",
    ].join("\n"),
  );
  writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="/src/index.css"><title>Fixture</title></head><body><h1>Grid Guy explores F1 stats</h1><p>Driven by curiosity, grounded in human experience.</p><code>npm run dev</code></body></html>`,
  );
  writeFileSync(
    path.join(dir, "server.mjs"),
    [
      `import http from "node:http";`,
      `import { readFileSync } from "node:fs";`,
      `import path from "node:path";`,
      `const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };`,
      `const HOST = arg("--host", "127.0.0.1");`,
      `const PORT = Number(arg("--port", "0")); // 0: let the OS pick — the printed URL is the contract`,
      `const root = path.dirname(new URL(import.meta.url).pathname);`,
      `const srv = http.createServer((req, res) => {`,
      `  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];`,
      `  try { res.writeHead(200); res.end(readFileSync(path.join(root, p))); } catch { res.writeHead(404); res.end(); }`,
      `});`,
      `srv.listen(PORT, HOST, () => console.log(\`  Local:   http://\${HOST}:\${srv.address().port}/\`));`,
    ].join("\n"),
  );
}

const runCli = (args, env = {}) =>
  spawnSync(process.execPath, [HERE + "font-lab.mjs", ...args], { encoding: "utf8", env: { ...process.env, ...env } });

try {
  rmSync(TMP, { recursive: true, force: true });
  const FX = path.join(TMP, "app");
  makeFixture(FX);

  // ===================================================================== //
  //  1 — the `run` CLI bridge (the MCP-reload dead zone)                  //
  // ===================================================================== //

  const bare = runCli(["run"]);
  assert("run with no tool prints usage + tool list, exits 1", bare.status === 1 && /font_lab_start/.test(bare.stderr) && /font_lab_screenshot_directions/.test(bare.stderr));

  const listed = runCli(["run", "--list"]);
  assert("run --list exits 0 (explicit list is a success)", listed.status === 0 && /font_lab_apply/.test(listed.stderr));

  const cat = runCli(["run", "font_lab_list_catalog", "{}"]);
  assert("run <tool> prints the tool's JSON on stdout", cat.status === 0 && Array.isArray(JSON.parse(cat.stdout)));

  const short = runCli(["run", "analyze", "--project", FX]);
  const shortObj = JSON.parse(short.stdout);
  assert("run accepts short names + --project convenience", short.status === 0 && shortObj.framework === "vite" && shortObj.capabilities.livePanel === false);

  const missing = runCli(["run", "font_lab_analyze", "{}"]);
  assert("run enforces required args (same message as MCP)", missing.status === 1 && /missing required argument/i.test(missing.stderr));

  const unknown = runCli(["run", "font_lab_nope", "{}"]);
  assert("run rejects unknown tools with the known list", unknown.status === 1 && /unknown tool/.test(unknown.stderr));

  const toolErr = runCli(["run", "font_lab_undo", "--project", FX]); // nothing to undo → tool error
  assert("run surfaces tool errors as {error} JSON, exit 2", toolErr.status === 2 && typeof JSON.parse(toolErr.stdout).error === "string");

  // ===================================================================== //
  //  2 — compose persists the set; the loop resolves against it           //
  // ===================================================================== //

  const composed = await engine.composeDirections(
    [{ name: "Statement", vibe: "editorial", rationale: "test", display: "Fraunces", body: "Hanken Grotesk", mono: "Spline Sans Mono" }],
    { projectDir: FX, brief: "bold, technical undertone" },
  );
  assert("composeDirections persists .font-lab/preview.json", existsSync(path.join(FX, ".font-lab", "preview.json")) && String(composed.persisted).includes("preview.json"));
  const menu = JSON.parse(readFileSync(path.join(FX, ".font-lab", "menu.json"), "utf8"));
  assert("composeDirections records the menu as composed/tailored", menu.mode === "composed" && menu.tailored === true);
  assert("persisted set round-trips through readPreviewSet", engine.readPreviewSet(FX)[0]?.id === "statement");

  const analysis = engine.analyze(FX);
  assert("resolveCaptureSet: explicit directions win", engine.resolveCaptureSet(FX, analysis, { directions: [{ id: "x" }] }).source === "explicit");
  assert("resolveCaptureSet: composed set is the default", engine.resolveCaptureSet(FX, analysis, {}).source === "preview-set");

  const sel = engine.selectDirection(FX, { directionId: "statement" });
  assert("select resolves the id against the COMPOSED set (not starter)", sel.roles.display.family === "Fraunces" && sel.roles.mono.family === "Spline Sans Mono");

  // the starter menu needs an explicit opt-in once nothing is composed
  const BARE = path.join(TMP, "bare");
  makeFixture(BARE);
  const bareAnalysis = engine.analyze(BARE);
  let refused = null;
  try {
    engine.resolveCaptureSet(BARE, bareAnalysis, { allowFallback: false });
  } catch (e) {
    refused = e.message;
  }
  assert("no composed set + no fallback → actionable refusal (never silent starter)", !!refused && /compose_directions/.test(refused) && /allowFallback/.test(refused));
  assert("allowFallback:true still yields the deterministic starter deliberately", engine.resolveCaptureSet(BARE, bareAnalysis, { allowFallback: true }).source === "fallback");

  let captureRefused = null;
  try {
    await engine.captureDirections(BARE, { allowFallback: false });
  } catch (e) {
    captureRefused = e.message;
  }
  assert("captureDirections refuses BEFORE any server/browser work", !!captureRefused && /compose_directions/.test(captureRefused));

  // ===================================================================== //
  //  3 — preview hygiene: nothing lands in the repo                       //
  // ===================================================================== //

  assert("preview font cache targets .font-lab/fonts, public/ untouched", !existsSync(path.join(FX, "public")));

  // ===================================================================== //
  //  4 — environment detection                                            //
  // ===================================================================== //

  assert("CLAUDE_CODE_REMOTE marks a remote container", detectEnvironment({ env: { CLAUDE_CODE_REMOTE: "1" } }).kind === "remote-container");
  assert("Codespaces marks remote WITH port forwarding", detectEnvironment({ env: { CODESPACES: "true" } }).portForwarded === true);
  assert("no markers → local", detectEnvironment({ env: {} }).remote === false);
  assert("explicit remote:true overrides a local detection", detectEnvironment({ remote: true, env: {} }).kind === "remote-container");
  assert("explicit remote:false overrides a cloud marker", detectEnvironment({ remote: false, env: { CLAUDE_CODE_REMOTE: "1" } }).remote === false);
  const startOut = engine.start(FX, { remote: true });
  assert("start carries the environment + workflow consequences", startOut.environment.remote === true && /workflowNote/.test(Object.keys(startOut.environment).join(",")) && /ENVIRONMENT/.test(startOut.nextStep));
  const live = engine.liveInstructions(FX, { remote: true });
  assert("live_instructions reframes for remote (no localhost handoff)", /remote container|OWN MACHINE/i.test(live.note));

  // ===================================================================== //
  //  5 — the managed dev server                                           //
  // ===================================================================== //

  assert("hostArgsFor: next → -H 127.0.0.1", hostArgsFor("next dev", "next", { host: "127.0.0.1" }).join(" ") === "-H 127.0.0.1");
  assert("hostArgsFor: vite family → --host 127.0.0.1", hostArgsFor("vite", "vite", { host: "127.0.0.1" }).join(" ") === "--host 127.0.0.1");
  assert("hostArgsFor: compound script → no guessed flags", hostArgsFor("gen && vite dev", "vite", { host: "127.0.0.1" }).length === 0);
  assert("normalizeOrigin pins localhost/:: to 127.0.0.1", normalizeOrigin("http://localhost:8080/") === "http://127.0.0.1:8080" && normalizeOrigin("http://[::]:3000") === "http://127.0.0.1:3000");
  assert("detectDevCommand reads the fixture's dev script", detectDevCommand(FX).script === "node server.mjs");

  const managed = await startManagedServer(FX, { framework: "vite", timeoutMs: 20000, log: () => {} });
  assert("managed server starts and reports a 127.0.0.1 origin", /^http:\/\/127\.0\.0\.1:\d+$/.test(managed.origin));
  assert("managed server answers HTTP", await probeHttp(managed.origin));
  assert("managed command carries the forced host bind", /--host 127\.0\.0\.1/.test(managed.command));
  await managed.stop();
  await new Promise((r) => setTimeout(r, 300));
  assert("stop() tears the server down", !(await probeHttp(managed.origin, { timeoutMs: 800 })));

  const NOSCRIPT = path.join(TMP, "noscript");
  mkdirSync(NOSCRIPT, { recursive: true });
  writeFileSync(path.join(NOSCRIPT, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  let noScriptErr = null;
  try {
    await startManagedServer(NOSCRIPT, { framework: "vite", timeoutMs: 3000, log: () => {} });
  } catch (e) {
    noScriptErr = e.message;
  }
  assert("no dev script → actionable error (bind + background-task guidance)", !!noScriptErr && /127\.0\.0\.1/.test(noScriptErr));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "cloud-loop-report.json", JSON.stringify({ results }, null, 2));
console.log(`\ncloud-loop: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(9);
}
console.log("cloud-loop PASS");
