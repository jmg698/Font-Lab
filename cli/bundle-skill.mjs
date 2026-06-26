#!/usr/bin/env node
// prepack hook: copy the repo's top-level `skill/` into `cli/skill/` so the published npm
// tarball carries the SKILL. After `npx @jmg698/font-lab install`, install.mjs finds it at
// `cli/skill/font-lab` and copies it into ~/.claude/skills. (cli/skill/ is gitignored — it's a
// build artifact, the source of truth stays at the repo root `skill/`.)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "skill");
const dest = path.join(here, "skill");

if (!existsSync(src)) {
  console.error("bundle-skill: no ../skill to bundle — skipping");
  process.exit(0);
}
cpSync(src, dest, { recursive: true });
console.error(`bundle-skill: copied ${src} -> ${dest}`);
