// Version stamp + stale-panel drift — offline. Proves: the tool stamps its version into the
// panel (on init) and the generated module (on generateCatalog), and engine.status reports
// drift so a stale panel is caught — even a pre-stamp one (the exact npx-cache trap).

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VERSION, cmpVersions, isRealVersion } from "./version.mjs";
import { generateCatalog } from "./catalog-build.mjs";
import * as engine from "./engine.mjs";

const FIXTURE = fileURLToPath(new URL("../examples/clean-next-site/", import.meta.url));
const APP = fileURLToPath(new URL("./out/version-fixture/", import.meta.url));

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

try {
  // ---- version helpers --------------------------------------------------------
  assert("VERSION is a real semver", isRealVersion(VERSION), VERSION);
  assert("cmpVersions: newer > older", cmpVersions("0.9.3", "0.9.1") > 0);
  assert("cmpVersions: equal is 0", cmpVersions("0.9.3", "0.9.3") === 0);
  assert("cmpVersions: older < newer", cmpVersions("0.9.1", "0.10.0") < 0);
  assert("isRealVersion rejects the placeholder", !isRealVersion("__FONTLAB_VERSION__"));

  // ---- generateCatalog stamps generatedBy -------------------------------------
  rmSync(APP, { recursive: true, force: true });
  mkdirSync(APP + "app/_fontlab", { recursive: true });
  await generateCatalog(
    APP,
    [{ id: "x", name: "X", vibe: "v", rationale: "r", roles: { display: { family: "Fraunces", weights: [400] }, body: { family: "Libre Franklin", weights: [400] }, mono: { family: "JetBrains Mono", weights: [400] } } }],
    { target: { framework: "next" }, replaces: { display: "Inter", body: "Inter", mono: null }, wiring: { display: { var: "--font-x", el: "html" }, body: { var: "--font-y", el: "html" }, mono: null } },
    { fetch: false },
  );
  const gen = readFileSync(APP + "app/_fontlab/catalog.generated.ts", "utf8");
  assert("generated module stamps generatedBy", new RegExp(`export const generatedBy = "${VERSION.replace(/\./g, "\\.")}"`).test(gen));

  // ---- init stamps PANEL_VERSION into the copied panel ------------------------
  rmSync(APP, { recursive: true, force: true });
  mkdirSync(APP + "app", { recursive: true });
  for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) cpSync(FIXTURE + f, APP + f);
  await engine.init(APP, {
    directions: [{ id: "x", name: "X", vibe: "v", rationale: "r", roles: { display: { family: "Fraunces", weights: [400] }, body: { family: "Libre Franklin", weights: [400] }, mono: { family: "JetBrains Mono", weights: [400] } } }],
    fetch: false,
    log: () => {},
  });
  const panel = readFileSync(APP + "app/_fontlab/FontLabDevPanel.tsx", "utf8");
  assert("copied panel is stamped (placeholder replaced)", !panel.includes("__FONTLAB_VERSION__"));
  assert("copied panel carries the real PANEL_VERSION", new RegExp(`PANEL_VERSION = "${VERSION.replace(/\./g, "\\.")}"`).test(panel));

  // ---- engine.status drift detection ------------------------------------------
  const setPanel = (body) => writeFileSync(APP + "app/_fontlab/FontLabDevPanel.tsx", body);
  const drift = async () => (await engine.status(APP, { port: 59991 })).versions; // port down: pure local check

  setPanel(`const PANEL_VERSION = "0.9.1";`);
  let d = await drift();
  assert("old panel flagged stale", d.stale === true && d.panel === "0.9.1" && d.tool === VERSION);
  assert("stale drift carries an actionable hint", /re-run font_lab_init/i.test(d.hint || ""));

  setPanel(`const PANEL_VERSION = "${VERSION}";`);
  d = await drift();
  assert("current panel not stale", d.stale === false && d.panel === VERSION);

  setPanel(`export function FontLabDevPanel(){ return null; }`);
  d = await drift();
  assert("pre-stamp panel flagged stale (the reported bug)", d.stale === true && d.panel === null && !!d.hint);

  rmSync(APP + "app/_fontlab", { recursive: true, force: true });
  rmSync(APP + "app/fonts", { recursive: true, force: true });
  d = await drift();
  assert("no panel installed => not stale", d.stale === false && d.panel === null);
} finally {
  rmSync(APP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
