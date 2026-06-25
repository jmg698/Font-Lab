// M3 verification — the analyzer reads real projects correctly, and codegen consumes that
// analysis to ship BOTH wiring shapes: the role-var path (our fixture) and the adopt path
// (the real jack-mcgovern.com site, whose fonts ride project-named variables on <body>).
//
// Structural only — no build. It applies into throwaway copies so it never touches the
// source repos, and asserts the produced code, idempotency, and byte-exact reversibility.

import { analyzeProject } from "./analyzer.mjs";
import { applySelection, undo } from "./codegen.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  cpSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = HERE + "out/";
const TMP = HERE + ".m3-tmp/";
mkdirSync(OUT, { recursive: true });

const SAMPLE = path.join(ROOT, "examples/sample-next-site");
const CLEAN = path.join(ROOT, "examples/clean-next-site");
const JACK = path.resolve(ROOT, "../jack-mcgovern-site");

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL").padEnd(5), name, extra && !cond ? `(got: ${extra})` : "");
};

// Build a throwaway copy carrying just what the analyzer/codegen read.
function stage(srcDir, label) {
  const dst = path.join(TMP, label);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(path.join(dst, "app"), { recursive: true });
  for (const f of ["package.json", "app/layout.tsx", "app/globals.css"]) {
    const s = path.join(srcDir, f);
    if (existsSync(s)) cpSync(s, path.join(dst, f));
  }
  for (const cfg of ["tailwind.config.ts", "tailwind.config.js"]) {
    const s = path.join(srcDir, cfg);
    if (existsSync(s)) cpSync(s, path.join(dst, cfg));
  }
  return dst;
}

const SELECTION = {
  version: 1,
  pickedAt: "2026-06-25T00:00:00.000Z",
  direction: { id: "editorial-serif", name: "Editorial", vibe: "editorial", rationale: "Warm serif headlines over a clean grotesque body." },
  roles: {
    display: { family: "Fraunces", source: "google", weights: [400, 700] },
    body: { family: "Libre Franklin", source: "google", weights: [400, 600] },
    mono: { family: "JetBrains Mono", source: "google", weights: [400, 700] },
  },
};
function writeSelection(dir, replaces, target) {
  mkdirSync(path.join(dir, ".font-lab"), { recursive: true });
  writeFileSync(path.join(dir, ".font-lab/selection.json"), JSON.stringify({ ...SELECTION, replaces, target }, null, 2));
}

try {
  rmSync(TMP, { recursive: true, force: true });

  // ===================================================================== //
  //  Part 1 — the analyzer reads each project correctly                   //
  // ===================================================================== //

  const aSample = analyzeProject(SAMPLE);
  assert("sample: framework next", aSample.framework === "next");
  assert("sample: App Router", aSample.router === "app");
  assert("sample: Tailwind v4", aSample.tailwindVersion === 4, String(aSample.tailwindVersion));
  assert("sample: css-variable wiring", aSample.fontWiring === "css-variables", aSample.fontWiring);
  assert("sample: class target <html>", aSample.classNameTarget === "html", String(aSample.classNameTarget));
  assert("sample: current display Inter", aSample.replaces.display === "Inter", String(aSample.replaces.display));
  assert("sample: current mono JetBrains Mono", aSample.replaces.mono === "JetBrains Mono", String(aSample.replaces.mono));
  assert("sample: supported", aSample.supported === true, aSample.reasons.join("; "));

  const aClean = analyzeProject(CLEAN);
  assert("clean: no display font wired", aClean.replaces.display === null, String(aClean.replaces.display));
  assert("clean: body Inter via --font-sans", aClean.replaces.body === "Inter", String(aClean.replaces.body));
  assert("clean: supported", aClean.supported === true, aClean.reasons.join("; "));

  const haveJack = existsSync(JACK);
  let aJack = null;
  if (haveJack) {
    aJack = analyzeProject(JACK);
    assert("jack: framework next", aJack.framework === "next");
    assert("jack: App Router", aJack.router === "app");
    assert("jack: Tailwind v4", aJack.tailwindVersion === 4, String(aJack.tailwindVersion));
    assert("jack: css-variable wiring", aJack.fontWiring === "css-variables", aJack.fontWiring);
    assert("jack: class target <body>", aJack.classNameTarget === "body", String(aJack.classNameTarget));
    assert("jack: display = Bricolage Grotesque", aJack.replaces.display === "Bricolage Grotesque", String(aJack.replaces.display));
    assert("jack: body = Hanken Grotesk", aJack.replaces.body === "Hanken Grotesk", String(aJack.replaces.body));
    assert("jack: no mono font wired", aJack.replaces.mono === null, String(aJack.replaces.mono));
    assert("jack: display rides --font-bricolage", aJack.roles.display?.nextFontVar === "--font-bricolage", String(aJack.roles.display?.nextFontVar));
    assert("jack: body rides --font-hanken", aJack.roles.body?.nextFontVar === "--font-hanken", String(aJack.roles.body?.nextFontVar));
    assert("jack: supported", aJack.supported === true, aJack.reasons.join("; "));
  } else {
    console.log("note: jack-mcgovern-site not found alongside Font-Lab — skipping its assertions");
  }

  // ===================================================================== //
  //  Part 2 — codegen ROLE-VAR path on the clean fixture                  //
  // ===================================================================== //

  const cleanTarget = { framework: "next", router: "app", styling: "tailwind", tailwindVersion: 4, fontWiring: "css-variables" };
  {
    const dir = stage(CLEAN, "clean");
    const origLayout = readFileSync(path.join(dir, "app/layout.tsx"), "utf8");
    const origCss = readFileSync(path.join(dir, "app/globals.css"), "utf8");
    writeSelection(dir, aClean.replaces, cleanTarget);
    const r = applySelection(dir);
    const layout = readFileSync(path.join(dir, "app/layout.tsx"), "utf8");
    const css = readFileSync(path.join(dir, "app/globals.css"), "utf8");

    assert("clean: imports Fraunces + Libre_Franklin", /\bFraunces\b/.test(layout) && /\bLibre_Franklin\b/.test(layout));
    assert("clean: fontLabDisplay on --font-display", /const fontLabDisplay = Fraunces\([^)]*--font-display/.test(layout));
    assert("clean: fontLabBody on --font-sans", /const fontLabBody = Libre_Franklin\([^)]*--font-sans/.test(layout));
    assert("clean: fontLabMono on --font-mono", /const fontLabMono = JetBrains_Mono\([^)]*--font-mono/.test(layout));
    assert("clean: removed old `const inter`", !/const inter =/.test(layout));
    assert("clean: html has all 3 role vars", ["fontLabDisplay", "fontLabBody", "fontLabMono"].every((c) => layout.includes(`${c}.variable`)));
    assert("clean: css fenced @theme has 3 role vars", /\/\* font-lab:start \*\/[\s\S]*--font-display[\s\S]*--font-sans[\s\S]*--font-mono[\s\S]*\/\* font-lab:end \*\//.test(css));

    const layout2 = (applySelection(dir), readFileSync(path.join(dir, "app/layout.tsx"), "utf8"));
    assert("clean: idempotent re-apply", layout === layout2);
    assert("clean: replaced reported (inter)", r.replaced.some((x) => /Inter/.test(x.font)));

    // Reversibility on a fresh copy (single apply, like M2).
    const rev = stage(CLEAN, "clean-rev");
    writeSelection(rev, aClean.replaces, cleanTarget);
    applySelection(rev);
    undo(rev);
    assert("clean: undo restores layout byte-identical", readFileSync(path.join(rev, "app/layout.tsx"), "utf8") === origLayout);
    assert("clean: undo restores globals byte-identical", readFileSync(path.join(rev, "app/globals.css"), "utf8") === origCss);
  }

  // ===================================================================== //
  //  Part 3 — codegen ADOPT path on the real jack-mcgovern.com site       //
  // ===================================================================== //

  if (haveJack) {
    const jackTarget = { framework: "next", router: "app", styling: "tailwind", tailwindVersion: 4, fontWiring: "css-variables" };
    const dir = stage(JACK, "jack");
    const origLayout = readFileSync(path.join(dir, "app/layout.tsx"), "utf8");
    const origCss = readFileSync(path.join(dir, "app/globals.css"), "utf8");
    writeSelection(dir, aJack.replaces, jackTarget);

    const r = applySelection(dir);
    const layout = readFileSync(path.join(dir, "app/layout.tsx"), "utf8");
    const css = readFileSync(path.join(dir, "app/globals.css"), "utf8");
    writeFileSync(OUT + "jack-applied.layout.tsx", layout);
    writeFileSync(OUT + "jack-applied.globals.css", css);
    const fenced = (css.match(/\/\* font-lab:start \*\/[\s\S]*?\/\* font-lab:end \*\//) || [""])[0];

    assert("jack: adopts display const (bricolage = Fraunces)", /const bricolage = Fraunces\(/.test(layout));
    assert("jack: display keeps --font-bricolage", /Fraunces\(\{[^}]*--font-bricolage/.test(layout.replace(/\n/g, " ")));
    assert("jack: adopts body const (hanken = Libre_Franklin)", /const hanken = Libre_Franklin\(/.test(layout));
    assert("jack: body keeps --font-hanken", /Libre_Franklin\(\{[^}]*--font-hanken/.test(layout.replace(/\n/g, " ")));
    assert("jack: dropped Bricolage_Grotesque import", !/Bricolage_Grotesque/.test(layout));
    assert("jack: dropped Hanken_Grotesk import", !/Hanken_Grotesk/.test(layout));
    assert("jack: creates fontLabMono on --font-mono", /const fontLabMono = JetBrains_Mono\([^)]*--font-mono/.test(layout));
    assert("jack: <body> keeps bricolage.variable + hanken.variable", /bricolage\.variable/.test(layout) && /hanken\.variable/.test(layout));
    assert("jack: <body> gains fontLabMono.variable", /fontLabMono\.variable/.test(layout));
    assert("jack: fenced @theme maps only --font-mono", /--font-mono/.test(fenced) && !/--font-display/.test(fenced) && !/--font-sans/.test(fenced), fenced.replace(/\n/g, " "));
    assert("jack: project's own @theme (--font-display: var(--font-bricolage)) intact", /--font-display:\s*var\(--font-bricolage\)/.test(css));
    assert("jack: replaces reports Bricolage Grotesque", r.replaced.some((x) => /Bricolage_Grotesque/.test(x.font)));
    assert("jack: class target reported as body", r.classTarget === "body");

    const layout2 = (applySelection(dir), readFileSync(path.join(dir, "app/layout.tsx"), "utf8"));
    assert("jack: idempotent re-apply", layout === layout2);

    // Reversibility on a fresh copy (single apply, like M2).
    const rev = stage(JACK, "jack-rev");
    writeSelection(rev, aJack.replaces, jackTarget);
    applySelection(rev);
    undo(rev);
    assert("jack: undo restores layout byte-identical", readFileSync(path.join(rev, "app/layout.tsx"), "utf8") === origLayout);
    assert("jack: undo restores globals byte-identical", readFileSync(path.join(rev, "app/globals.css"), "utf8") === origCss);
  }
  // ===================================================================== //
  //  Part 4 — branch selection: the analyzer gates what codegen ships     //
  // ===================================================================== //

  // Synthesize minimal projects the analyzer should flag as out-of-branch.
  function synth(label, { pkg, layoutPath, layout, css }) {
    const dir = path.join(TMP, label);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.dirname(path.join(dir, layoutPath)), { recursive: true });
    mkdirSync(path.join(dir, "app"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    writeFileSync(path.join(dir, layoutPath), layout);
    writeFileSync(path.join(dir, "app/globals.css"), css);
    return dir;
  }
  const refuses = (dir, needle) => {
    writeSelection(dir, { display: null, body: null, mono: null }, {});
    try {
      applySelection(dir);
      return false;
    } catch (e) {
      return new RegExp(needle, "i").test(e.message);
    }
  };

  const v3 = synth("v3", {
    pkg: { dependencies: { next: "^15", react: "^19" }, devDependencies: { tailwindcss: "^3.4.0" } },
    layoutPath: "app/layout.tsx",
    layout: `import { Inter } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"], variable: "--font-sans" });\nexport default function RootLayout({ children }) { return (<html className={inter.variable}><body>{children}</body></html>); }`,
    css: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n@theme inline { --font-sans: var(--font-sans); }`,
  });
  assert("v3: analyzer reports Tailwind v3", analyzeProject(v3).tailwindVersion === 3, String(analyzeProject(v3).tailwindVersion));
  assert("v3: codegen refuses (need v4)", refuses(v3, "tailwind v3"));

  const pages = synth("pages", {
    pkg: { dependencies: { next: "^15", react: "^19", tailwindcss: "^4.2.0" }, devDependencies: { "@tailwindcss/postcss": "^4" } },
    layoutPath: "pages/_app.tsx",
    layout: `import { Inter } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"], variable: "--font-sans" });\nexport default function App({ Component, pageProps }) { return (<div className={inter.variable}><Component {...pageProps} /></div>); }`,
    css: `@import "tailwindcss";\n@theme inline { --font-sans: var(--font-sans); }`,
  });
  assert("pages: analyzer reports Pages Router", analyzeProject(pages).router === "pages", String(analyzeProject(pages).router));
  assert("pages: codegen refuses (need app)", refuses(pages, "router is pages"));

  const hard = synth("hardcoded", {
    pkg: { dependencies: { next: "^15", react: "^19", tailwindcss: "^4.2.0" }, devDependencies: { "@tailwindcss/postcss": "^4" } },
    layoutPath: "app/layout.tsx",
    layout: `export default function RootLayout({ children }) { return (<html><body>{children}</body></html>); }`,
    css: `@import "tailwindcss";\nbody { font-family: "Times New Roman", serif; }`,
  });
  assert("hardcoded: analyzer reports hardcoded wiring", analyzeProject(hard).fontWiring === "hardcoded", analyzeProject(hard).fontWiring);
  assert("hardcoded: codegen refuses (need css-variables)", refuses(hard, "hardcoded"));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "m3-report.json", JSON.stringify({ results }, null, 2));
console.log(`\nM3: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join(", "));
  process.exit(5);
}
console.log("M3 PASS");
