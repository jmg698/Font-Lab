// Font Lab engine (M5) — the stable programmatic facade the MCP server and CLIs wrap. One
// import surface over the whole pipeline so the agent can drive the loop:
//
//   analyze → (curate  OR  listCatalog + composeDirections) → preparePreview → readSelection → apply
//
// The taste split is enforced here, not just documented:
//   • the HUMAN makes the final pick (we only ever prepare a preview; we never auto-select);
//   • the AGENT may take the wheel on the *menu* — compose its own directions — but every
//     font it chooses must be a catalog member, so the parity / ship guarantee always holds.
//   • the curator is the strong default the agent gets for free.

import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { catalog, get as catalogGet, inCatalog } from "./catalog.mjs";
import { curate as curateDirections } from "./curator.mjs";
import { analyzeProject, toTarget } from "./analyzer.mjs";
import { generateCatalog } from "./catalog-build.mjs";
import { applySelection, undo as undoApply, rewireCoverage } from "./codegen.mjs";

const ROLES = ["display", "body", "mono"];
const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── read ────────────────────────────────────────────────────────────────────

export function analyze(projectDir) {
  return analyzeProject(path.resolve(projectDir));
}

// Browse the catalog so the agent can compose its own directions. Filter by role/tag.
export function listCatalog({ role, tag } = {}) {
  return Object.entries(catalog)
    .filter(([, e]) => (!role || e.roles.includes(role)) && (!tag || e.tags.includes(tag)))
    .map(([family, e]) => ({ family, roles: e.roles, tags: e.tags }));
}

// The default menu: ~5 deterministic directions for this project.
export function curate(projectDir, opts = {}) {
  const analysis = analyzeProject(path.resolve(projectDir));
  return { analysis, directions: curateDirections(analysis, opts) };
}

// ── option 3: the agent composes its own directions ──────────────────────────
// specs: [{ name, vibe?, rationale?, display, body, mono, weights? }]
// Parity guard: every family must be a catalog member; otherwise throw with suggestions.
export function composeDirections(specs) {
  if (!Array.isArray(specs) || !specs.length) throw new Error("composeDirections: provide a non-empty array of directions");
  const warnings = [];
  const directions = specs.map((s, i) => {
    if (!s || !s.display || !s.body || !s.mono) throw new Error(`direction[${i}]: needs display, body, and mono families`);
    for (const role of ROLES) {
      const fam = s[role];
      if (!inCatalog(fam)) {
        const near = suggest(fam, role);
        throw new Error(`direction[${i}].${role}: "${fam}" is not in the Font Lab catalog${near ? ` — did you mean ${near}?` : ""}`);
      }
      if (!catalogGet(fam).roles.includes(role)) warnings.push(`"${fam}" isn't a typical ${role} font (allowed, but check it reads well)`);
    }
    const name = s.name || `${s.display} / ${s.body}`;
    return {
      id: s.id || slugId(name),
      name,
      vibe: s.vibe || "custom",
      rationale: s.rationale || `${s.display} headings over ${s.body}.`,
      roles: {
        display: { family: s.display, weights: s.weights?.display || [400, 700] },
        body: { family: s.body, weights: s.weights?.body || [400, 600] },
        mono: { family: s.mono, weights: s.weights?.mono || [400, 700] },
      },
    };
  });
  return { directions, warnings };
}

function suggest(fam, role) {
  const f = (fam || "").toLowerCase();
  const hit = Object.keys(catalog).find((k) => k.toLowerCase().includes(f) || f.includes(k.toLowerCase()));
  if (hit) return `"${hit}"`;
  const someInRole = Object.entries(catalog).filter(([, e]) => e.roles.includes(role)).slice(0, 3).map(([k]) => `"${k}"`);
  return someInRole.length ? someInRole.join(", ") : null;
}

// ── prepare the live preview (build parity bundles into the project) ──────────
// directions: optional agent-composed/curated directions; if omitted, curate for the project.
export async function preparePreview(projectDir, { directions, vibe, count, fetch = true, log } = {}) {
  const dir = path.resolve(projectDir);
  const analysis = analyzeProject(dir);
  const dirs = directions && directions.length ? directions : curateDirections(analysis, { vibe, count });
  const meta = { target: toTarget(analysis), replaces: analysis.replaces };
  const result = await generateCatalog(dir, dirs, meta, { fetch, log });
  return { analysis, prepared: result.fonts, directions: result.directions, outPath: result.outPath };
}

// ── the human's pick, and shipping it ────────────────────────────────────────

export function readSelection(projectDir) {
  const p = path.join(path.resolve(projectDir), ".font-lab", "selection.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function apply(projectDir) {
  return applySelection(path.resolve(projectDir));
}

// Fix a role the analyzer flags as dead (declared but not actually rendered). Reversible.
export function rewire(projectDir) {
  return rewireCoverage(path.resolve(projectDir));
}

export function undo(projectDir) {
  return undoApply(path.resolve(projectDir));
}
