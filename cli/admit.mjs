// Font Lab — the dynamic shippability gate (v2, A2).
//
// This is what turns the catalog from a 41-font MENU into a GATE + verified cache. Given ANY
// font family — any Google font (~1,500), or a supported open foundry (Fontshare/Velvetyne) —
// it answers one question: *can we ship this with preview == ship?* and returns a verdict:
//
//   • "guaranteed"  — variable woff2 + derivable capsize metrics → full WYSIWYG (the catalog bar).
//   • "best-effort" — shippable, but parity isn't guaranteed (static weights, or metrics we
//                      couldn't derive). We SHOW it anyway with an honest warning and let the
//                      human decide — strive for WYSIWYG, soft-degrade, never hard-block.
//   • "unavailable" — genuinely can't ship (no fetchable source, or a license that forbids
//                      self-hosting). The only case we refuse.
//
// Design: the GATE LOGIC is pure and dependency-free (tested in cli/admit-test.mjs). The impure
// edges — Google metadata, the foundry APIs, and capsize metric extraction (@capsizecss/unpack)
// — are isolated behind injectable resolvers so the decision logic is verifiable without a
// network or node_modules. The catalog is the seed cache: a member is an instant "guaranteed".

import { catalog } from "./catalog.mjs";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ── pure helpers ──────────────────────────────────────────────────────────────

export const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

const CATALOG_BY_NORM = new Map(Object.keys(catalog).map((k) => [normalize(k), k]));

// Case-insensitive catalog lookup → { family, entry } or null. The catalog is the verified cache.
export function catalogMatch(family) {
  const key = CATALOG_BY_NORM.get(normalize(family));
  return key ? { family: key, entry: catalog[key] } : null;
}

// Map a Google/foundry category string to a CSS generic family (for the metric-matched fallback).
// NB: "Sans Serif" contains "serif" — check sans first.
export function mapCategory(c) {
  const x = normalize(c);
  if (/sans/.test(x)) return "sans-serif";
  if (/serif/.test(x)) return "serif";
  if (/mono/.test(x)) return "monospace";
  return "sans-serif";
}

// The heart of the soft-degrade policy: classify parity and collect the honest caveats.
export function classifyParity({ variable, hasMetrics }) {
  const warnings = [];
  if (!variable)
    warnings.push("static weights — the preview self-hosts a single file, so some weights may render slightly differently once applied");
  if (!hasMetrics)
    warnings.push("exact fallback metrics couldn't be derived — using a category fallback, so the first paint may shift the layout slightly (CLS)");
  return { parity: variable && hasMetrics ? "guaranteed" : "best-effort", warnings };
}

const LICENSE_OK = /ofl|open font license|apache|ubuntu font license|\bmit\b|\bisc\b|free for (personal and )?commercial|libre/i;
const LICENSE_BAD = /preview|trial|evaluation|all rights reserved|\bdemo\b/i;

// Licensing is a hard admission criterion alongside parity (REDESIGN risk #2). Google is OFL/
// Apache by policy; for foundries we require a permissive, self-hostable license.
export function licenseOk(license, source) {
  if (source === "google" || source === "catalog") return true;
  const l = String(license || "");
  if (LICENSE_BAD.test(l)) return false;
  return LICENSE_OK.test(l);
}

function guaranteedFromCatalog(m) {
  return {
    family: m.family, shippable: true, parity: "guaranteed", source: "catalog",
    css2: m.entry.css2, woff2Url: null, capsize: m.entry.capsize, category: null,
    variable: true, license: "OFL/Apache (Google)", warnings: [], reason: null, roles: m.entry.roles,
  };
}

function unavailable(family, reason) {
  return {
    family, shippable: false, parity: "unavailable", source: null, css2: null, woff2Url: null,
    capsize: null, category: null, variable: false, license: null, warnings: [], reason,
  };
}

const safe = async (fn) => {
  try {
    return await fn();
  } catch {
    return null; // soft-degrade: a resolver that throws is treated as "didn't find it", never fatal
  }
};

// ── the gate ────────────────────────────────────────────────────────────────
// admit(family, deps?) → verdict. Impure deps are injectable (defaults do the real work):
//   resolveGoogle(family)    → { found, family, css2, variable, category } | { found:false }
//   resolveFontshare(family) → { found, family, woff2Url, variable, category, license } | {found:false}
//   deriveMetrics({source, css2?, woff2Url?}) → { metrics, woff2Url } | { metrics:null }
//   cache  → optional Map-like { get(normKey), set(normKey, verdict) } (the project verified cache)
export async function admit(family, deps = {}) {
  const {
    resolveGoogle = resolveGoogleDefault,
    resolveFontshare = resolveFontshareDefault,
    deriveMetrics = deriveMetricsDefault,
    cache,
    allowBestEffort = true,
  } = deps;

  // 1. the catalog is the verified cache — a member is an instant guarantee, no network.
  const m = catalogMatch(family);
  if (m) return guaranteedFromCatalog(m);

  // 2. the project's admitted cache (previously vetted non-catalog fonts).
  const key = normalize(family);
  if (cache?.get) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  // 3. resolve a shippable source — Google first (largest, OFL/Apache), then open foundries.
  let verdict = null;
  const g = await safe(() => resolveGoogle(family));
  if (g?.found) {
    const dm = await safe(() => deriveMetrics({ source: "google", css2: g.css2 }));
    const { parity, warnings } = classifyParity({ variable: !!g.variable, hasMetrics: !!dm?.metrics });
    verdict = {
      family: g.family || family, shippable: true, parity, source: "google",
      css2: g.css2, woff2Url: dm?.woff2Url || null, capsize: null,
      category: mapCategory(dm?.metrics?.category || g.category), variable: !!g.variable,
      license: "OFL/Apache (Google)", warnings, reason: null, roles: g.roles || null,
    };
  } else {
    const f = await safe(() => resolveFontshare(family));
    if (f?.found) {
      if (!licenseOk(f.license, "fontshare")) {
        verdict = unavailable(f.family || family, `license doesn't permit self-hosting (${f.license || "unknown"})`);
      } else {
        const dm = await safe(() => deriveMetrics({ source: "fontshare", woff2Url: f.woff2Url }));
        const { parity, warnings } = classifyParity({ variable: !!f.variable, hasMetrics: !!dm?.metrics });
        verdict = {
          family: f.family || family, shippable: true, parity, source: "fontshare",
          css2: null, woff2Url: f.woff2Url, capsize: null,
          category: mapCategory(dm?.metrics?.category || f.category), variable: !!f.variable,
          license: f.license || null, warnings, reason: null, roles: f.roles || null,
        };
      }
    }
  }

  if (!verdict)
    verdict = unavailable(family, "not found in Google Fonts or a supported open foundry, and not a catalog member");

  // Caller asked for WYSIWYG only — downgrade a best-effort to a refusal with the reason.
  if (!allowBestEffort && verdict.parity === "best-effort")
    verdict = unavailable(verdict.family, `only a best-effort (non-WYSIWYG) ship is possible: ${verdict.warnings.join("; ")}`);

  if (cache?.set && verdict.parity !== "unavailable") cache.set(key, verdict);
  return verdict;
}

export const isShippable = (verdict) => !!verdict && verdict.parity !== "unavailable";

// ── default resolvers (the impure network/metrics edge) ─────────────────────
// Isolated so the gate logic above is testable without them. Verified by the deps+network
// harness, not here. Endpoints: Google's keyless metadata catalog and css2; Fontshare's v2 API;
// capsize metric extraction via @capsizecss/unpack.

let _googleList = null;
async function googleMetadata() {
  if (_googleList) return _googleList;
  const res = await fetch("https://fonts.google.com/metadata/fonts");
  const text = await res.text();
  // The endpoint prefixes JSON with ")]}'" (anti-hijacking) — strip before parsing.
  const json = JSON.parse(text.replace(/^\)\]\}'/, ""));
  _googleList = json.familyMetadataList || [];
  return _googleList;
}

export async function resolveGoogleDefault(family) {
  const list = await googleMetadata();
  const hit = list.find((f) => normalize(f.family) === normalize(family));
  if (!hit) return { found: false };
  const wght = (hit.axes || []).find((a) => a.tag === "wght");
  const variable = !!wght && Number(wght.min) < Number(wght.max);
  const range = wght ? `${Math.round(wght.min)}..${Math.round(wght.max)}` : "400";
  const css2 = `${hit.family.replace(/\s+/g, "+")}:wght@${range}`;
  return { found: true, family: hit.family, css2, variable, category: hit.category || null };
}

async function googleWoff2Url(css2) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${css2}&display=swap`, { headers: { "User-Agent": UA } });
  const css = await res.text();
  const m =
    css.match(/\/\* latin \*\/\s*@font-face\s*\{[^}]*?url\((https:[^)]+\.woff2)\)/) ||
    css.match(/url\((https:[^)]+\.woff2)\)/);
  return m ? m[1] : null;
}

export async function deriveMetricsDefault({ source, css2, woff2Url }) {
  let url = woff2Url || (css2 ? await googleWoff2Url(css2) : null);
  if (!url) return { metrics: null, woff2Url: null };
  try {
    const { fromUrl } = await import("@capsizecss/unpack");
    const metrics = await fromUrl(url);
    return { metrics, woff2Url: url };
  } catch {
    return { metrics: null, woff2Url: url }; // shippable best-effort: we have the file, not the metrics
  }
}

let _fontshareList = null;
async function fontshareList() {
  if (_fontshareList) return _fontshareList;
  const res = await fetch("https://api.fontshare.com/v2/fonts?limit=200");
  const json = await res.json();
  _fontshareList = json.fonts || (Array.isArray(json) ? json : []);
  return _fontshareList;
}

function pickWoff2(styles = []) {
  const variable = styles.find((s) => /variable/i.test(s.name || "") && (s.url || s.file?.url));
  const any = styles.find((s) => s.url || s.file?.url);
  const chosen = variable || any;
  return chosen ? { url: chosen.url || chosen.file?.url, variable: !!variable } : null;
}

export async function resolveFontshareDefault(family) {
  const list = await fontshareList();
  const hit = list.find((f) => normalize(f.name || f.family) === normalize(family));
  if (!hit) return { found: false };
  const file = pickWoff2(hit.styles || hit.fonts || []);
  if (!file) return { found: false };
  return {
    found: true, family: hit.name || hit.family, woff2Url: file.url,
    variable: !!hit.is_variable || file.variable, category: hit.category || null,
    license: hit.license || "Free for commercial use (Fontshare)",
  };
}
