// rewire verification — a Jack-shaped project (Tailwind v4 @theme inline + a hand-written
// `h1 { font-family: var(--font-display) }`) has a DEAD display role; `rewire` points that raw
// usage at the published leaf var so it renders, leaves @theme alone, clears the dead flag,
// and is byte-for-byte reversible. Offline.

import { analyzeProject } from "./analyzer.mjs";
import { rewireCoverage, undo } from "./codegen.mjs";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const OUT = HERE + "out/";
const TMP = HERE + ".rewire-tmp/";
mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (n, c, e = "") => { results.push({ name: n, pass: !!c }); console.log((c ? "PASS" : "FAIL").padEnd(5), n, e && !c ? `(${e})` : ""); };

const LAYOUT = `import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
export default function RootLayout({ children }) {
  return (<html lang="en"><body className={\`\${bricolage.variable} \${hanken.variable} font-sans\`}>{children}</body></html>);
}
`;
const GLOBALS = `@import "tailwindcss";

@theme inline {
  --font-display: var(--font-bricolage), ui-sans-serif, system-ui, sans-serif;
  --font-sans: var(--font-hanken), ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  h1, h2, h3 { font-family: var(--font-display); }
  body { @apply bg-white; }
}
`;
const PKG = JSON.stringify({ dependencies: { next: "^15", react: "^19", tailwindcss: "^4.2.0" }, devDependencies: { "@tailwindcss/postcss": "^4" } }, null, 2);

try {
  rmSync(TMP, { recursive: true, force: true });
  const dir = path.join(TMP, "proj");
  mkdirSync(path.join(dir, "app"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), PKG);
  writeFileSync(path.join(dir, "app/layout.tsx"), LAYOUT);
  writeFileSync(path.join(dir, "app/globals.css"), GLOBALS);
  const cssPath = path.join(dir, "app/globals.css");
  const orig = readFileSync(cssPath, "utf8");

  const before = analyzeProject(dir);
  assert("analyzer flags display as dead", before.coverage.deadRoles.includes("display"), before.coverage.deadRoles.join(","));
  assert("analyzer does NOT flag body (uses utility)", !before.coverage.deadRoles.includes("body"));

  const r = rewireCoverage(dir);
  const css = readFileSync(cssPath, "utf8");
  assert("rewire reports display fixed", r.rewired.some((x) => x.role === "display" && x.to === "--font-bricolage"), JSON.stringify(r.rewired));
  assert("base rule now uses the leaf var", /h1, h2, h3 \{ font-family: var\(--font-bricolage\); \}/.test(css), css.match(/h1[^}]*}/)?.[0]);
  assert("@theme definition left intact", /--font-display: var\(--font-bricolage\)/.test(css));
  assert("did not touch body / --font-sans", /--font-sans: var\(--font-hanken\)/.test(css));

  const after = analyzeProject(dir);
  assert("dead flag cleared after rewire", !after.coverage.deadRoles.includes("display"), after.coverage.deadRoles.join(","));

  undo(dir);
  assert("undo restores globals byte-identical", readFileSync(cssPath, "utf8") === orig);

  // no-op when there's nothing dead
  const r2 = rewireCoverage(dir);
  assert("re-rewire after undo finds the dead role again", r2.rewired.length >= 1);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
writeFileSync(OUT + "rewire-report.json", JSON.stringify({ results }, null, 2));
console.log(`\nrewire: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) { console.error("FAILED:", failed.map((f) => f.name).join(", ")); process.exit(5); }
console.log("rewire PASS");
