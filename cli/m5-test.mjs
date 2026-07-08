// M5 verification — the engine facade and the MCP server. The engine logic is offline; the
// MCP server is exercised over real stdio (spawn → initialize → tools/list → tools/call).
// Option 3 is the heart of it: the agent can compose its own directions from any shippable font
// (catalog or admitted), but the menu must clear the anti-generic gate, and the human is always
// the one who picks (we only ever prepare a preview).

import * as engine from "./engine.mjs";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = HERE + "out/";
const TMP = HERE + ".m5-tmp/";
mkdirSync(OUT, { recursive: true });
const CLEAN = path.join(ROOT, "examples/clean-next-site");

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(${extra})` : "");
};

try {
  rmSync(TMP, { recursive: true, force: true });

  // ===================================================================== //
  //  Part 1 — the engine facade                                           //
  // ===================================================================== //

  const a = engine.analyze(CLEAN);
  assert("analyze returns target + current", a.framework === "next" && "replaces" in a);

  const cat = engine.listCatalog({ role: "mono" });
  assert("listCatalog filters by role (mono)", cat.length > 0 && cat.every((f) => f.roles.includes("mono")));
  assert("listCatalog filters by tag (serif)", engine.listCatalog({ tag: "serif" }).every((f) => f.tags.includes("serif")));

  const { directions: curated } = engine.curate(CLEAN);
  assert("curate returns the default menu (~5)", curated.length === 5);

  // option 3: agent composes its own directions (async; distinctive faces clear the gate)
  const composed = await engine.composeDirections([
    { name: "My Pick", vibe: "editorial", display: "Fraunces", body: "Hanken Grotesk", mono: "Spline Sans Mono" },
  ]);
  assert("composeDirections accepts distinctive catalog fonts", composed.directions.length === 1 && composed.directions[0].roles.display.family === "Fraunces");
  assert("composeDirections normalizes id + weights", !!composed.directions[0].id && Array.isArray(composed.directions[0].roles.body.weights));

  // option 3 guard (B1): an all-generic menu is refused; force:true overrides deliberately
  let refused = false, msg = "";
  try {
    await engine.composeDirections([{ display: "Geist", body: "Geist", mono: "Geist Mono" }]);
  } catch (e) {
    refused = true;
    msg = e.message;
  }
  assert("composeDirections refuses an all-generic menu", refused && /too generic|overexposed/.test(msg), msg);
  const forced = await engine.composeDirections([{ display: "Geist", body: "Geist", mono: "Geist Mono" }], { force: true });
  assert("composeDirections force:true overrides the anti-generic gate", forced.directions.length === 1);

  // preparePreview without network (fetch:false) builds the generated module from composed dirs
  const proj = path.join(TMP, "clean");
  mkdirSync(path.join(proj, "app/_fontlab"), { recursive: true });
  for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) cpSync(path.join(CLEAN, f), path.join(proj, f));
  const prep = await engine.preparePreview(proj, { directions: composed.directions, fetch: false });
  assert("preparePreview writes catalog.generated.ts", existsSync(prep.outPath));
  assert("preparePreview reports prepared fonts", prep.prepared.includes("Fraunces"));
  // regression: preparePreview must bake in `wiring`, or the panel renders every role "not wired"
  const genSrc = readFileSync(prep.outPath, "utf8");
  assert("preparePreview bakes in wiring (panel can swap)", /export const wiring = /.test(genSrc) && !/export const wiring = null/.test(genSrc));

  // readSelection: null before a pick, the object after
  assert("readSelection is null before a pick", engine.readSelection(proj) === null);
  mkdirSync(path.join(proj, ".font-lab"), { recursive: true });
  writeFileSync(path.join(proj, ".font-lab/selection.json"), JSON.stringify({ version: 1, direction: { id: "x" } }));
  assert("readSelection returns the pick after one exists", engine.readSelection(proj)?.direction?.id === "x");

  // ===================================================================== //
  //  Part 2 — the MCP server over real stdio                              //
  // ===================================================================== //

  const server = spawn("node", [HERE + "mcp.mjs"], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  let sbuf = "";
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    sbuf += chunk;
    let nl;
    while ((nl = sbuf.indexOf("\n")) !== -1) {
      const line = sbuf.slice(0, nl).trim();
      sbuf = sbuf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
    });

  try {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert("MCP initialize returns serverInfo", init.result?.serverInfo?.name === "font-lab");
    assert("MCP initialize advertises tools capability", !!init.result?.capabilities?.tools);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const list = await rpc("tools/list", {});
    const names = list.result.tools.map((t) => t.name);
    for (const t of ["font_lab_analyze", "font_lab_list_catalog", "font_lab_curate", "font_lab_compose_directions", "font_lab_init", "font_lab_uninit", "font_lab_prepare_preview", "font_lab_read_pick", "font_lab_apply", "font_lab_rewire_dead_roles", "font_lab_undo", "font_lab_wait_for_request"])
      assert(`MCP exposes ${t}`, names.includes(t));
    assert("MCP tool descriptions mention the human keeps the pick", list.result.tools.some((t) => /human/i.test(t.description)));

    const an = await rpc("tools/call", { name: "font_lab_analyze", arguments: { projectDir: CLEAN } });
    const anObj = JSON.parse(an.result.content[0].text);
    assert("MCP analyze call returns analysis", anObj.framework === "next");

    const cu = await rpc("tools/call", { name: "font_lab_curate", arguments: { projectDir: CLEAN, count: 3 } });
    assert("MCP curate call returns 3 directions", JSON.parse(cu.result.content[0].text).length === 3);

    const bad = await rpc("tools/call", { name: "font_lab_compose_directions", arguments: { directions: [{ display: "Geist", body: "Geist", mono: "Geist Mono" }] } });
    assert("MCP surfaces tool errors in-band (isError)", bad.result.isError === true && /too generic|overexposed/.test(bad.result.content[0].text));

    const unknown = await rpc("tools/call", { name: "font_lab_nope", arguments: {} });
    assert("MCP rejects unknown tool", !!unknown.error);

    const noArg = await rpc("tools/call", { name: "font_lab_analyze", arguments: {} });
    assert("MCP enforces required args with a clear in-band error", noArg.result?.isError === true && /missing required argument/i.test(noArg.result.content[0].text));
  } finally {
    server.kill();
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "m5-report.json", JSON.stringify({ results }, null, 2));
console.log(`\nM5: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M5 PASS");
