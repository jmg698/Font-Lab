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
  assert("clean: no dead roles (no false positives)", aClean.coverage.deadRoles.length === 0, aClean.coverage.deadRoles.join(","));
  assert("sample: no dead roles (no false positives)", aSample.coverage.deadRoles.length === 0, aSample.coverage.deadRoles.join(","));

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
    // Coverage diagnostics — the foolproofing: detect a swap that won't be visible.
    assert("jack: flags display as a dead role", aJack.coverage.deadRoles.includes("display"), aJack.coverage.deadRoles.join(","));
    assert("jack: does NOT flag body as dead", !aJack.coverage.deadRoles.includes("body"));
    assert("jack: reports other font subsystems (/gus, /fonts)", aJack.coverage.otherSubsystems.length >= 2, String(aJack.coverage.otherSubsystems.length));
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
    // Consts carry a DISTINCT family-named var (SHIP-SPEC: avoids `--font-sans: var(--font-sans)`);
    // the role token is mapped to it in the @theme block (asserted below).
    assert("clean: fontLabDisplay carries --font-fraunces", /const fontLabDisplay = Fraunces\([^)]*--font-fraunces/.test(layout));
    assert("clean: fontLabBody carries --font-libre-franklin", /const fontLabBody = Libre_Franklin\([^)]*--font-libre-franklin/.test(layout));
    assert("clean: fontLabMono carries --font-jetbrains-mono", /const fontLabMono = JetBrains_Mono\([^)]*--font-jetbrains-mono/.test(layout));
    assert("clean: @theme maps --font-display -> --font-fraunces", /--font-display:\s*var\(--font-fraunces\)/.test(css));
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
    assert("jack: creates fontLabMono carrying --font-jetbrains-mono", /const fontLabMono = JetBrains_Mono\([^)]*--font-jetbrains-mono/.test(layout));
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

  // Write an arbitrary file tree (rel path -> contents). Used by the Bucket 2 shapes below,
  // which vary layout/css location and split fonts across files — things `synth` can't express.
  function scaffold(label, files) {
    const dir = path.join(TMP, label);
    rmSync(dir, { recursive: true, force: true });
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(dir, relPath);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return dir;
  }
  const PKG4 = JSON.stringify(
    { dependencies: { next: "^16", react: "^19", tailwindcss: "^4" }, devDependencies: { "@tailwindcss/postcss": "^4" } },
    null,
    2,
  );
  const SHIP = { framework: "next", router: "app", styling: "tailwind", tailwindVersion: 4, fontWiring: "css-variables" };
  const ship = (dir, a) => (writeSelection(dir, a.replaces, SHIP), applySelection(dir));

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

  // ===================================================================== //
  //  Part 5 — "beyond jack": shapes a real Next+TW4 site has that the      //
  //  analyzer used to misread. Two now ship; two are detected + refused    //
  //  with a precise reason (full codegen support is a follow-on).          //
  // ===================================================================== //

  const CSS_TWO = `@import "tailwindcss";\n@theme inline {\n  --font-sans: var(--font-sans);\n  --font-mono: var(--font-mono);\n}`;

  // --- Fix 2: root layout under a top-level route group (SUPPORTED, ships) ---
  {
    const dir = scaffold("routegroup", {
      "package.json": PKG4,
      "app/(marketing)/layout.tsx": `import { Inter, JetBrains_Mono } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"], variable: "--font-sans" });\nconst mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });\nexport default function RootLayout({ children }) {\n  return (<html lang="en" className={\`\${inter.variable} \${mono.variable}\`}><body>{children}</body></html>);\n}`,
      "app/globals.css": CSS_TWO,
    });
    const a = analyzeProject(dir);
    assert("routegroup: App Router detected", a.router === "app", a.router);
    assert("routegroup: finds root layout in (marketing)", a.declarationFile === "app/(marketing)/layout.tsx", String(a.declarationFile));
    assert("routegroup: body font Inter", a.replaces.body === "Inter", String(a.replaces.body));
    assert("routegroup: supported", a.supported === true, a.reasons.join("; "));
    ship(dir, a);
    const laid = readFileSync(path.join(dir, "app/(marketing)/layout.tsx"), "utf8");
    assert("routegroup: codegen edits the route-group layout", /fontLabBody = Libre_Franklin/.test(laid), laid.slice(0, 80));
  }

  // --- Fix 3: Tailwind entry at a non-standard path (SUPPORTED, ships) ---
  {
    const dir = scaffold("altcss", {
      "package.json": PKG4,
      "app/layout.tsx": `import { Inter } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"], variable: "--font-sans" });\nexport default function RootLayout({ children }) {\n  return (<html lang="en" className={inter.variable}><body>{children}</body></html>);\n}`,
      "src/styles/main.css": `@import "tailwindcss";\n@theme inline {\n  --font-sans: var(--font-sans);\n}`,
    });
    const a = analyzeProject(dir);
    assert("altcss: finds non-standard CSS entry", a.cssFile === "src/styles/main.css", String(a.cssFile));
    assert("altcss: Tailwind v4", a.tailwindVersion === 4, String(a.tailwindVersion));
    assert("altcss: supported", a.supported === true, a.reasons.join("; "));
    ship(dir, a);
    const cssOut = readFileSync(path.join(dir, "src/styles/main.css"), "utf8");
    assert("altcss: codegen writes @theme into the found CSS", /font-lab:start[\s\S]*--font-sans:\s*var\(--font-libre-franklin\)/.test(cssOut));
  }

  // --- Fix 1a: fonts in a sibling module via relative import (DETECTED, refused) ---
  {
    const dir = scaffold("modrel", {
      "package.json": PKG4,
      "app/layout.tsx": `import { sans, mono } from "./fonts";\nexport default function RootLayout({ children }) {\n  return (<html lang="en" className={\`\${sans.variable} \${mono.variable}\`}><body>{children}</body></html>);\n}`,
      "app/fonts.ts": `import { Inter, JetBrains_Mono } from "next/font/google";\nexport const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });\nexport const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });`,
      "app/globals.css": CSS_TWO,
    });
    const a = analyzeProject(dir);
    assert("modrel: names the real body font (Inter) from ./fonts", a.replaces.body === "Inter", String(a.replaces.body));
    assert("modrel: reads css-variable wiring (not 'hardcoded')", a.fontWiring === "css-variables", a.fontWiring);
    assert("modrel: records the source module on the role", a.roles.body?.fromModule === "app/fonts.ts", String(a.roles.body?.fromModule));
    assert("modrel: does NOT flag the primary module as an 'other subsystem'", !a.coverage.otherSubsystems.some((s) => s.file === "app/fonts.ts"));
    assert("modrel: refused with a module-specific reason", a.supported === false && /separate module/i.test(a.reasons.join("; ")), a.reasons.join("; "));
    assert("modrel: codegen refuses (module)", refuses(dir, "module"));
  }

  // --- Fix 1b: fonts in a shared module via `@/` alias (DETECTED, refused) ---
  {
    const dir = scaffold("modalias", {
      "package.json": PKG4,
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }, null, 2),
      "app/layout.tsx": `import { display } from "@/lib/fonts";\nexport default function RootLayout({ children }) {\n  return (<html lang="en" className={display.variable}><body>{children}</body></html>);\n}`,
      "lib/fonts.ts": `import { Bricolage_Grotesque } from "next/font/google";\nexport const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });`,
      "app/globals.css": `@import "tailwindcss";\n@theme inline {\n  --font-display: var(--font-display);\n}`,
    });
    const a = analyzeProject(dir);
    assert("modalias: resolves @/ alias to lib/fonts.ts", a.roles.display?.fromModule === "lib/fonts.ts", String(a.roles.display?.fromModule));
    assert("modalias: names the aliased display font", a.roles.display?.family === "Bricolage Grotesque", String(a.roles.display?.family));
    assert("modalias: refused with a module-specific reason", a.supported === false && /separate module/i.test(a.reasons.join("; ")), a.reasons.join("; "));
  }

  // --- Fix 4: font vars pinned on a wrapper, not <html>/<body> (DETECTED, refused) ---
  {
    const dir = scaffold("wrapper", {
      "package.json": PKG4,
      "app/layout.tsx": `import { Inter } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"], variable: "--font-sans" });\nexport default function RootLayout({ children }) {\n  return (<html lang="en"><body><div className={inter.variable}>{children}</div></body></html>);\n}`,
      "app/globals.css": `@import "tailwindcss";\n@theme inline {\n  --font-sans: var(--font-sans);\n}`,
    });
    const a = analyzeProject(dir);
    assert("wrapper: no html/body class target", a.classNameTarget === null, String(a.classNameTarget));
    assert("wrapper: detects the real carrier tag (<div>)", a.classNameTargetTag === "div", String(a.classNameTargetTag));
    assert("wrapper: refused, not silently treated as <html>", a.supported === false && /<div>/.test(a.reasons.join("; ")), a.reasons.join("; "));
    assert("wrapper: codegen refuses (wrapper)", refuses(dir, "div"));
  }
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
