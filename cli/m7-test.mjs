// M7 verification — the next/font decoupling + multi-framework support.
//
// Proves Font Lab "just works" beyond Next.js: it detects the framework and the current fonts on
// TanStack/Vite/Astro sites that load fonts via Google `@import` (not next/font), ships them via
// the framework-agnostic css-entry branch (self-hosted @font-face + Tailwind @theme + a repoint of
// the project's own role vars), and — where it can't auto-ship — degrades honestly with a
// capability manifest instead of a dead end. Plus the CLI `--version` footgun that booted a server.
//
// Structural + offline: apply runs with { fetch: false } (parity metrics come from the catalog's
// capsize keys, no network), into throwaway fixtures under .m7-tmp/.

import { analyzeProject } from "./analyzer.mjs";
import { applySelection, undo } from "./codegen.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const OUT = HERE + "out/";
const TMP = HERE + ".m7-tmp/";
mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(got: ${extra})` : "");
};

function scaffold(label, files) {
  const dir = path.join(TMP, label);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
const PKG = (deps) => JSON.stringify({ name: "fixture", private: true, dependencies: deps }, null, 2);
// All catalog members → capsize metrics resolve offline (fetch:false).
const SEL = {
  display: { family: "Archivo", source: "google", weights: [400, 700] },
  body: { family: "Hanken Grotesk", source: "google", weights: [400, 600] },
  mono: { family: "Spline Sans Mono", source: "google", weights: [400] },
};
function pick(dir, roles = SEL) {
  mkdirSync(path.join(dir, ".font-lab"), { recursive: true });
  writeFileSync(path.join(dir, ".font-lab/selection.json"), JSON.stringify({ direction: { id: "d", name: "Poster", vibe: "poster" }, roles, pickedAt: "2026-07-01T00:00:00.000Z" }, null, 2));
}

try {
  rmSync(TMP, { recursive: true, force: true });

  // =================================================================== //
  //  1 — Happenings shape: TanStack Start + TW v4 + Google @import       //
  //      + project's own --fd/--fb/--fm vars. The hero case.            //
  // =================================================================== //
  const happCss = `@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@300..700&family=JetBrains+Mono:wght@400..700&display=swap');

:root {
  --fd: 'Archivo Black', sans-serif;
  --fb: 'Space Grotesk', system-ui, sans-serif;
  --fm: 'JetBrains Mono', monospace;
}
@theme inline {
  --font-display: var(--fd);
  --font-sans: var(--fb);
  --font-mono: var(--fm);
}`;
  const happ = scaffold("happenings", {
    "package.json": PKG({ "@tanstack/react-start": "^1.0.0", react: "^19", tailwindcss: "^4" }),
    "src/styles.css": happCss,
  });
  const a = analyzeProject(happ);
  assert("happ: detects framework tanstack-start", a.framework === "tanstack-start", a.framework);
  assert("happ: fontLoading import-url", a.fontLoading === "import-url", a.fontLoading);
  assert("happ: names current display (Archivo Black)", a.replaces.display === "Archivo Black", String(a.replaces.display));
  assert("happ: names current body (Space Grotesk)", a.replaces.body === "Space Grotesk", String(a.replaces.body));
  assert("happ: names current mono (JetBrains Mono)", a.replaces.mono === "JetBrains Mono", String(a.replaces.mono));
  assert("happ: currentFamilies has all three", ["Archivo Black", "Space Grotesk", "JetBrains Mono"].every((f) => a.currentFamilies.includes(f)), JSON.stringify(a.currentFamilies));
  assert("happ: traces role token to project leaf var --fd", a.roles.display?.leafVar === "--fd", String(a.roles.display?.leafVar));
  assert("happ: NOT supported by the next-font gate", a.supported === false);
  assert("happ: applyMode css-entry / shippable", a.applyMode === "css-entry" && a.shippable === true, `${a.applyMode}/${a.shippable}`);
  assert("happ: capabilities autoApply, no livePanel", a.capabilities.autoApply === true && a.capabilities.livePanel === false);
  assert("happ: applyTarget is the CSS entry", a.capabilities.applyTarget === "src/styles.css", String(a.capabilities.applyTarget));

  pick(happ);
  const r = await applySelection(happ, { fetch: false });
  const out = readFileSync(happ + "/src/styles.css", "utf8");
  writeFileSync(OUT + "m7-happenings.styles.css", out);
  assert("happ: apply reports mode css-entry", r.mode === "css-entry");
  assert("happ: fenced block written", /\/\* font-lab:start \*\/[\s\S]*\/\* font-lab:end \*\//.test(out));
  assert("happ: self-hosts @font-face for picked display (FL Archivo)", /@font-face\{font-family:'FL Archivo';/.test(out));
  assert("happ: self-hosts the adjusted-fallback face", /@font-face\{font-family:'FL Archivo Fallback';[^}]*size-adjust:/.test(out));
  assert("happ: @theme maps --font-display to the FL stack", /--font-display: 'FL Archivo', 'FL Archivo Fallback'/.test(out));
  assert("happ: repoints the project's own --fd", /--fd: 'FL Archivo', 'FL Archivo Fallback'/.test(out));
  assert("happ: reports repointed --fd/--fb/--fm", ["--fd", "--fb", "--fm"].every((v) => r.repointed.includes(v)), JSON.stringify(r.repointed));
  assert("happ: drops the Google Fonts @import", !/fonts\.googleapis\.com/.test(out));
  assert("happ: keeps the tailwindcss @import", /@import "tailwindcss"/.test(out));
  assert("happ: self-hosts to public/fontlab", r.selfHosted.dir === "public/fontlab" && r.selfHosted.fonts.length === 3);

  await applySelection(happ, { fetch: false });
  const out2 = readFileSync(happ + "/src/styles.css", "utf8");
  assert("happ: idempotent re-apply (zero diff)", out === out2);

  // reversibility on a fresh copy (single apply)
  const happRev = scaffold("happenings-rev", { "package.json": PKG({ "@tanstack/react-start": "^1.0.0", react: "^19", tailwindcss: "^4" }), "src/styles.css": happCss });
  const before = readFileSync(happRev + "/src/styles.css", "utf8");
  pick(happRev);
  await applySelection(happRev, { fetch: false });
  undo(happRev);
  assert("happ: undo restores styles.css byte-identical", readFileSync(happRev + "/src/styles.css", "utf8") === before);

  // =================================================================== //
  //  2 — Vite + React + TW v4, fonts on the STANDARD role tokens         //
  //      (no custom leaf var → @theme covers it, no :root repoint)       //
  // =================================================================== //
  const vite = scaffold("vite", {
    "package.json": PKG({ vite: "^6", react: "^19", tailwindcss: "^4" }),
    "src/index.css": `@import "tailwindcss";\n@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');\n@theme {\n  --font-display: 'Inter', sans-serif;\n  --font-sans: 'Inter', sans-serif;\n  --font-mono: ui-monospace, monospace;\n}`,
  });
  const av = analyzeProject(vite);
  assert("vite: detects framework vite", av.framework === "vite", av.framework);
  assert("vite: finds non-standard CSS entry src/index.css", av.cssFile === "src/index.css", String(av.cssFile));
  assert("vite: names current display Inter (standard token)", av.replaces.display === "Inter", String(av.replaces.display));
  assert("vite: applyMode css-entry", av.applyMode === "css-entry", av.applyMode);
  pick(vite);
  const rv = await applySelection(vite, { fetch: false });
  const vout = readFileSync(vite + "/src/index.css", "utf8");
  assert("vite: @theme role tokens set to FL stacks", /--font-display: 'FL Archivo'/.test(vout) && /--font-mono: 'FL Spline Sans Mono'/.test(vout));
  assert("vite: no leaf repoint needed (standard tokens)", rv.repointed.length === 0, JSON.stringify(rv.repointed));

  // =================================================================== //
  //  3 — Astro + TW v4 (detected via the `astro` dep)                    //
  // =================================================================== //
  const astro = scaffold("astro", {
    "package.json": PKG({ astro: "^4", tailwindcss: "^4" }),
    "src/styles/global.css": `@import "tailwindcss";\n@theme { --font-display: 'Inter', sans-serif; --font-sans: 'Inter', sans-serif; --font-mono: monospace; }`,
  });
  const aa = analyzeProject(astro);
  assert("astro: detects framework astro", aa.framework === "astro", aa.framework);
  assert("astro: applyMode css-entry", aa.applyMode === "css-entry", aa.applyMode);

  // framework via config file only (no dep)
  const astroCfg = scaffold("astro-cfg", { "package.json": PKG({ tailwindcss: "^4" }), "astro.config.mjs": "export default {}", "src/styles.css": `@import "tailwindcss";` });
  assert("astro: detected from astro.config.mjs (no dep)", analyzeProject(astroCfg).framework === "astro", analyzeProject(astroCfg).framework);

  // =================================================================== //
  //  4 — Fresh Vite + TW v4 with NO fonts yet → css-entry can ADD them   //
  // =================================================================== //
  const fresh = scaffold("fresh", { "package.json": PKG({ vite: "^6", tailwindcss: "^4" }), "src/app.css": `@import "tailwindcss";` });
  const af = analyzeProject(fresh);
  assert("fresh: no current fonts named", af.currentFamilies.length === 0, JSON.stringify(af.currentFamilies));
  assert("fresh: applyMode css-entry (can add fonts)", af.applyMode === "css-entry", af.applyMode);
  pick(fresh);
  await applySelection(fresh, { fetch: false });
  const fout = readFileSync(fresh + "/src/app.css", "utf8");
  assert("fresh: adds @font-face + @theme role map", /@font-face\{font-family:'FL Archivo';/.test(fout) && /--font-display: 'FL Archivo'/.test(fout));

  // =================================================================== //
  //  5a — Tier A: Vite + PLAIN CSS (no Tailwind) but VAR-WIRED → SHIPS   //
  //       via self-hosted @font-face + repointing the project's own vars //
  // =================================================================== //
  const varwired = scaffold("varwired", {
    "package.json": PKG({ vite: "^6", react: "^19" }),
    "src/styles.css": `@import url('https://fonts.googleapis.com/css2?family=Poppins&family=JetBrains+Mono&display=swap');
:root {
  --font-display: 'Poppins', sans-serif;
  --font-body: 'Poppins', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
body { font-family: var(--font-body); }
h1, h2 { font-family: var(--font-display); }
code { font-family: var(--font-mono); }`,
  });
  const aw = analyzeProject(varwired);
  assert("varwired: framework vite, no Tailwind", aw.framework === "vite" && aw.tailwindVersion === null, `${aw.framework}/${aw.tailwindVersion}`);
  assert("varwired: names current fonts via CSS vars (Poppins)", aw.replaces.display === "Poppins" && aw.replaces.body === "Poppins", `${aw.replaces.display}/${aw.replaces.body}`);
  assert("varwired: applyMode css-entry via css-var (Tier A)", aw.applyMode === "css-entry" && aw.cssEntryVia === "css-var", `${aw.applyMode}/${aw.cssEntryVia}`);
  assert("varwired: shipNote mentions repointing font vars (no Tailwind)", /repointing the project's own font var/.test(aw.shipNote), aw.shipNote);
  pick(varwired);
  const rw = await applySelection(varwired, { fetch: false });
  const wout = readFileSync(varwired + "/src/styles.css", "utf8");
  assert("varwired: apply via css-var", rw.via === "css-var", rw.via);
  assert("varwired: self-hosts @font-face", /@font-face\{font-family:'FL Archivo';/.test(wout));
  assert("varwired: repoints all three project vars", ["--font-display", "--font-body", "--font-mono"].every((v) => rw.repointed.includes(v)), JSON.stringify(rw.repointed));
  assert("varwired: sets --font-body to the FL stack", /--font-body: 'FL Hanken Grotesk'/.test(wout));
  assert("varwired: writes NO @theme block (non-Tailwind)", !/@theme/.test(wout));
  assert("varwired: drops the Google @import", !/fonts\.googleapis\.com/.test(wout));
  await applySelection(varwired, { fetch: false });
  assert("varwired: idempotent re-apply", wout === readFileSync(varwired + "/src/styles.css", "utf8"));

  // reversibility on a fresh copy
  const VW_SRC = `:root { --font-body: 'Poppins', sans-serif; }\nbody { font-family: var(--font-body); }`;
  const varRev2 = scaffold("varwired-rev2", { "package.json": PKG({ vite: "^6" }), "src/styles.css": VW_SRC });
  const vbefore = readFileSync(varRev2 + "/src/styles.css", "utf8");
  pick(varRev2);
  await applySelection(varRev2, { fetch: false });
  undo(varRev2);
  assert("varwired: undo restores byte-identical", readFileSync(varRev2 + "/src/styles.css", "utf8") === vbefore);

  // =================================================================== //
  //  5b — Degraded (honest): HARDCODED font-family, no var → refuses     //
  //       (Tier B territory) — still names current fonts for the brief   //
  // =================================================================== //
  const hard = scaffold("hardcoded-plain", {
    "package.json": PKG({ vite: "^6", react: "^19" }),
    "src/styles.css": `@import url('https://fonts.googleapis.com/css2?family=Poppins&display=swap');\nbody { font-family: 'Poppins', sans-serif; }\nh1 { font-family: 'Poppins', sans-serif; }`,
  });
  const ah = analyzeProject(hard);
  assert("hardcoded: framework vite", ah.framework === "vite", ah.framework);
  assert("hardcoded: still names the current font (Poppins) for the brief", ah.currentFamilies.includes("Poppins"), JSON.stringify(ah.currentFamilies));
  assert("hardcoded: applyMode null (no var seam, no Tailwind)", ah.applyMode === null, String(ah.applyMode));
  assert("hardcoded: capability manifest flags manualApply + a target", ah.capabilities.manualApply === true && ah.capabilities.applyTarget === "src/styles.css");
  pick(hard);
  let refusedMsg = "";
  try {
    await applySelection(hard, { fetch: false });
  } catch (e) {
    refusedMsg = e.message;
  }
  assert("hardcoded: apply refuses cleanly (degraded → hand-apply)", /not supported/i.test(refusedMsg), refusedMsg);

  // =================================================================== //
  //  6 — CLI hardening: `--version` must NOT boot the server            //
  // =================================================================== //
  const CLI = fileURLToPath(new URL("./font-lab.mjs", import.meta.url));
  const run = (args) => {
    try {
      return { ok: true, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", timeout: 8000 }) };
    } catch (e) {
      return { ok: false, out: String(e.stdout || "") + String(e.message || "") };
    }
  };
  const ver = run(["--version"]);
  assert("cli: `--version` prints a semver and exits (no server hang)", ver.ok && /^\d+\.\d+\.\d+/.test(ver.out.trim()), ver.out.trim().slice(0, 40));
  const dashV = run(["-v"]);
  assert("cli: `-v` also exits cleanly", dashV.ok && /^\d+\.\d+\.\d+/.test(dashV.out.trim()), dashV.out.trim().slice(0, 40));
  const bogus = run(["--bogus"]);
  assert("cli: unknown flag shows help, never boots the server", bogus.ok && /Font Lab/.test(bogus.out), bogus.out.slice(0, 40));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "m7-report.json", JSON.stringify({ results }, null, 2));
console.log(`\nM7: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M7 PASS");
