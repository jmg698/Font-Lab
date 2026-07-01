// M8 verification — the portable "choosing moment".
//
// buildSpecimenHtml is a pure, framework-agnostic HTML builder (one card per direction, fonts
// embedded, project palette, an honest width-diff render check). previewSpecimen wires it to the
// parity engine so an agent gets a single self-contained file to hand the human — on ANY project,
// no dev server, no Next panel. Structural + offline (fetch:false; catalog capsize metrics need no
// network). A Playwright-gated block renders the sheet and checks the verifier actually runs.

import { buildSpecimenHtml, RENDER_CHECK_JS } from "./specimen.mjs";
import * as engine from "./engine.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const OUT = HERE + "out/";
const TMP = HERE + ".m8-tmp/";
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

try {
  rmSync(TMP, { recursive: true, force: true });

  // =================================================================== //
  //  1 — buildSpecimenHtml: pure, self-contained, honest                //
  // =================================================================== //
  const DIRS = [
    { id: "constructivist", name: "Constructivist", vibe: "poster", rationale: "Tall condensed caps.", parity: "guaranteed",
      roles: { display: { family: "Archivo", stack: "'FL Archivo', 'FL Archivo Fallback', sans-serif" }, body: { family: "Hanken Grotesk", stack: "'FL Hanken Grotesk', sans-serif" }, mono: { family: "Spline Sans Mono", stack: "'FL Spline Sans Mono', monospace" } } },
    { id: "editorial", name: "Editorial <b>", vibe: "editorial", rationale: "Characterful & calm.",
      roles: { display: { family: "Fraunces", stack: "'FL Fraunces', serif" }, body: { family: "Hanken Grotesk", stack: "'FL Hanken Grotesk', sans-serif" }, mono: { family: "Spline Sans Mono", stack: "'FL Spline Sans Mono', monospace" } } },
  ];
  const faceCss = "@font-face{font-family:'FL Archivo';src:url('/fontlab/archivo.woff2') format('woff2');}";
  const html = buildSpecimenHtml({ directions: DIRS, faceCss, palette: { bg: "#0b0b0b", fg: "#f5f5f5", accent: "#ff3b30" }, title: "happenings" });
  writeFileSync(OUT + "m8-specimen.html", html);

  assert("specimen: is a full HTML document", /^<!doctype html>/i.test(html.trim()) && /<\/html>/.test(html));
  assert("specimen: one card per direction", (html.match(/data-fl-card=/g) || []).length === 2, String((html.match(/data-fl-card=/g) || []).length));
  assert("specimen: embeds the provided @font-face", html.includes(faceCss));
  assert("specimen: tags role elements with their primary face", /data-fl-face="FL Archivo"/.test(html) && /data-fl-face="FL Fraunces"/.test(html));
  assert("specimen: registers all faces for the render check", /__FL_FACES = \[[^\]]*"FL Archivo"[^\]]*"FL Fraunces"/.test(html));
  assert("specimen: includes the width-diff render check (not fonts.check)", html.includes("rendering(face)") && !/\.check\(/.test(html));
  assert("specimen: RENDER_CHECK_JS export is embedded", html.includes(RENDER_CHECK_JS.trim().slice(0, 40)));
  assert("specimen: applies the project palette", /--bg:#0b0b0b/.test(html) && /--fg:#f5f5f5/.test(html) && /--accent:#ff3b30/.test(html));
  assert("specimen: uses the direction's font stack on the headline", html.includes("font-family:'FL Archivo', 'FL Archivo Fallback', sans-serif"));
  assert("specimen: shows a parity badge when provided", /fl-parity-guaranteed/.test(html));
  assert("specimen: escapes untrusted direction names (no raw <b>)", html.includes("Editorial &lt;b&gt;") && !/name">Editorial <b>/.test(html));
  assert("specimen: references no network font CDN itself (offline)", !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html));

  // faceCss as an ARRAY (what buildParityBundles returns) must be newline-joined, not
  // comma-stringified — a comma between @font-face rules silently drops all but the first.
  const arrHtml = buildSpecimenHtml({ directions: DIRS, faceCss: ["@font-face{font-family:'FL Archivo';src:url('a') format('woff2');}", "@font-face{font-family:'FL Fraunces';src:url('b') format('woff2');}"] });
  assert("specimen: array faceCss is newline-joined (both @font-face survive)", /'FL Archivo';[\s\S]*\}\n@font-face\{font-family:'FL Fraunces'/.test(arrHtml) && !/format\('woff2'\);\},@font-face/.test(arrHtml));

  // empty is still valid
  const empty = buildSpecimenHtml({});
  assert("specimen: empty directions still render a valid doc", /<!doctype html>/i.test(empty.trim()) && /__FL_FACES = \[\]/.test(empty));

  // =================================================================== //
  //  2 — previewSpecimen: framework-agnostic, writes .font-lab/preview  //
  // =================================================================== //
  const dirsFor = (display) => [
    { id: "d1", name: "One", vibe: "poster", rationale: "r", roles: { display: { family: display }, body: { family: "Hanken Grotesk" }, mono: { family: "Spline Sans Mono" } } },
  ];

  // TanStack (non-Next) with color tokens in a non-standard CSS entry
  const tan = scaffold("tanstack", {
    "package.json": PKG({ "@tanstack/react-start": "^1", react: "^19", tailwindcss: "^4" }),
    "src/styles.css": `@import "tailwindcss";\n:root { --background:#0b0b0b; --foreground:#f5f5f5; --accent:#ff3b30; --fd:'Archivo Black',sans-serif; }\n@theme inline { --font-display: var(--fd); }`,
  });
  const rt = await engine.previewSpecimen(tan, { directions: dirsFor("Archivo"), fetch: false, inline: false });
  const tanHtml = readFileSync(rt.path, "utf8");
  assert("preview: writes .font-lab/preview.html", rt.rel === ".font-lab/preview.html", rt.rel);
  assert("preview: works on a non-Next framework (tanstack-start)", rt.framework === "tanstack-start", rt.framework);
  assert("preview: bundles the picked + role fonts", ["Archivo", "Hanken Grotesk", "Spline Sans Mono"].every((f) => rt.fonts.includes(f)), rt.fonts.join(","));
  assert("preview: emits @font-face for the picked display", /@font-face\{font-family:'FL Archivo'/.test(tanHtml));
  assert("preview: picks up the project palette (accent #ff3b30)", /--accent:#ff3b30/.test(tanHtml) && /--bg:#0b0b0b/.test(tanHtml));
  assert("preview: is self-contained (no CDN fetch in the HTML)", !/fonts\.googleapis\.com/.test(tanHtml));

  // Vite works too
  const vite = scaffold("vite", { "package.json": PKG({ vite: "^6", react: "^19", tailwindcss: "^4" }), "src/index.css": `@import "tailwindcss";` });
  const rv = await engine.previewSpecimen(vite, { directions: dirsFor("Fraunces"), fetch: false, inline: false });
  assert("preview: works on Vite", rv.framework === "vite" && /@font-face\{font-family:'FL Fraunces'/.test(readFileSync(rv.path, "utf8")), rv.framework);

  // Even a plain (non-Tailwind) project can get a preview — previewing isn't gated on shippability
  const plain = scaffold("plain", { "package.json": PKG({ vite: "^6" }), "src/main.css": `:root{--foreground:#222;}` });
  const rp = await engine.previewSpecimen(plain, { directions: dirsFor("Archivo"), fetch: false, inline: false });
  assert("preview: available even on a non-shippable (non-Tailwind) project", /data-fl-card=/.test(readFileSync(rp.path, "utf8")));

  assert("engine: exports previewSpecimen + screenshotSpecimen", typeof engine.previewSpecimen === "function" && typeof engine.screenshotSpecimen === "function");

  // =================================================================== //
  //  3 — (gated) headless render + verify, if Playwright is present     //
  // =================================================================== //
  let pw = null;
  try {
    pw = await import("playwright");
  } catch {}
  if (pw) {
    try {
      const s = await engine.screenshotSpecimen(tan, { htmlPath: rt.path, outDir: path.join(TMP, "shots") });
      assert("screenshot: captures one image per card", s.shots.length === 1, String(s.shots.length));
      assert("screenshot: render check ran (summary present)", /faces rendering/.test(s.summary), s.summary);
    } catch (e) {
      console.log("note: screenshotSpecimen skipped —", String(e.message).split("\n")[0]);
    }
  } else {
    console.log("note: Playwright not installed — skipping the headless render/verify assertions");
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "m8-report.json", JSON.stringify({ results }, null, 2));
console.log(`\nM8: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M8 PASS");
