#!/usr/bin/env node
// Regression test for the @theme/@import codegen bugs found on the real jack-mcgovern.com run:
//   A) the block was inserted BETWEEN two @imports (invalid CSS),
//   B) it emitted a self-referential `--font-mono: var(--font-mono)`,
//   C) it lost Tailwind v4's last-wins merge to the project's own `--font-mono` (font loaded, unused).
// Exercises the pure composeCss() transform against a globals.css that mirrors jack's structure.

import { composeCss, composeCssEntry } from "./codegen.mjs";

let pass = 0,
  fail = 0;
const ok = (name, cond) => (cond ? (pass++, console.log(`PASS  ${name}`)) : (fail++, console.log(`FAIL  ${name}`)));

// A jack-like entry CSS: two @imports, then the project's OWN @theme that already defines --font-mono.
const css = `@import "tailwindcss";
@import "tw-animate-css";

@theme {
  --color-bg: oklch(0.98 0 0);
  --font-bricolage: "Bricolage Grotesque", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, monospace;
}

@layer base {
  h1, h2, h3 { font-family: var(--font-bricolage); }
}
`;

// body -> Figtree, mono -> JetBrains Mono (both new role-var roles, like jack's run).
const rv = [
  { role: "body", family: "Figtree", varName: "--font-sans", fontVar: "--font-figtree" },
  { role: "mono", family: "JetBrains Mono", varName: "--font-mono", fontVar: "--font-jetbrains-mono" },
];

const out = composeCss(css, rv);
const startAt = out.indexOf("/* font-lab:start */");
const blockText = out.slice(startAt, out.indexOf("/* font-lab:end */"));

// A — every @import precedes our block (no @import after it; nothing wedged between the two imports)
ok("A: both @imports precede our block", startAt > out.indexOf('@import "tw-animate-css";'));
ok("A: no @import appears after our block", out.indexOf("@import", startAt) === -1);

// B — distinct font vars, never self-referential
ok("B: maps mono token to the distinct font var", blockText.includes("--font-mono: var(--font-jetbrains-mono);"));
ok("B: maps sans token to the distinct font var", blockText.includes("--font-sans: var(--font-figtree);"));
ok("B: no self-referential token", !/--font-(sans|mono|display):\s*var\(\s*--font-(sans|mono|display)\s*\)/.test(blockText));

// C — our @theme block comes AFTER the project's own --font-mono, so last-wins favors the new font
ok("C: our block beats the project's --font-mono (last-wins)", startAt > out.lastIndexOf("--font-mono: ui-monospace"));
ok("C: block is @theme inline (derefs the runtime var)", blockText.includes("@theme inline {"));

// Idempotency — re-running is a stable no-op
ok("idempotent: re-applying yields identical output", composeCss(out, rv) === out);

// Simplest case — single @import, no project @theme: block lands after the import, still valid
const simple = composeCss(`@import "tailwindcss";\n\nbody { margin: 0; }\n`, rv);
ok("simple: block placed after the lone @import", simple.indexOf("/* font-lab:start */") > simple.indexOf('@import "tailwindcss";'));
ok("simple: no @import after the block", simple.indexOf("@import", simple.indexOf("/* font-lab:start */")) === -1);

// Removal — empty roles strips the block cleanly
ok("removal: empty roles removes the fenced block", !composeCss(out, []).includes("font-lab:start"));

// ── composeCssEntry: the Tailwind v3 shape (utility + Preflight-base overrides) ──
// v3 has no @theme; the seam is source order — the fence must land at the END so its
// equal-specificity `html {}` / `.font-*` rules beat Preflight and the generated utilities.
const tw3In = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`;
const tw3Args = {
  faceCss: ["@font-face{font-family:'FL X';src:url('/fontlab/x.woff2') format('woff2');}"],
  roleStacks: {},
  leafVars: {},
  utilities: { "font-heading": "'FL X', serif", "font-sans": "'FL Y', sans-serif" },
  baseStack: "'FL Y', sans-serif",
};
const tw3Out = composeCssEntry(tw3In, tw3Args);
ok("entry/tw3: html base override emitted", tw3Out.includes("html { font-family: 'FL Y', sans-serif; }"));
ok("entry/tw3: utility overrides emitted", tw3Out.includes(".font-heading { font-family: 'FL X', serif; }") && tw3Out.includes(".font-sans { font-family: 'FL Y', sans-serif; }"));
ok("entry/tw3: no @theme block for v3", !/@theme/.test(tw3Out));
ok("entry/tw3: fence appended after the @tailwind directives", tw3Out.indexOf("/* font-lab:start */") > tw3Out.lastIndexOf("@tailwind"));
ok("entry/tw3: idempotent re-compose", composeCssEntry(tw3Out, tw3Args) === tw3Out);
ok("entry/tw3: no utilities/base -> none emitted (v4/var shapes unchanged)", !/font-family/.test(composeCssEntry(tw3In, { faceCss: [], roleStacks: {}, leafVars: { "--fd": "'FL X', serif" } }).replace(/--fd:[^;]+;/, "")));

console.log(`\nCSS codegen: ${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
