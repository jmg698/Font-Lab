"use client";

// Font Lab dev panel — "Galley", the editor's proof slip. Portable build, installed by
// `font-lab init` into a real project. Design spec: docs/PANEL-VISION.md.
//
// THE CENSUS (render-first, RFC-ROLES-AND-COVERAGE rev 2.1; ./fl-census.ts): at mount the
// panel reads the RENDERED page — every visible text element's computed family/size/weight —
// and clusters it into the site's actual voices (heading / body / label), each cluster keyed by
// (rendered style, structural voice, provenance). A flip PAINTS a voice's clusters through one
// injected stylesheet (`[data-flv=…]{font-family:… !important}`) instead of overriding the
// site's CSS variables — so the preview works identically on healthy wiring, dead variable
// chains, inline-style brand islands, and system-stack mono. Preview is structurally unable to
// no-op; the analyzer's `wiring` is kept only as SHIP-scope honesty (a role with no live seam
// previews fine and is badged "agent wires on ship" — the pick carries the census + scope so
// the shipping agent knows exactly what to touch).
//
// The census also powers what the sentinel scan used to: inspect (hover the page → the chip
// names the voice/font), the role x-ray, the all-roles map, per-flip change flashes + edge
// ticks + row verdicts ("what changed AND what didn't"), coverage stats, and J-jump.
// Paint is STYLE-ONLY (attributes + one stylesheet, never wraps/creates/edits nodes) — the
// contract that keeps the copy-edit machinery below intact.
//
// Copy edits ride the same slip: double-click any all-text element, retype, Enter. The panel
// reads the React 19 fiber `_debugStack` call-site frame and POSTs it to the endpoint's
// /edit, which resolves it via the dev source map and rewrites the JSX literal reversibly
// (cli/copyedit.mjs). Refusals (dynamic text, duplicates) surface honestly; nothing guesses.
//
// The panel keeps a live SSE line to the pick endpoint (GET /events on :7777) so the human
// can SEE the loop: offline / ready / agent listening → Pick → saved → shipped (with undo).
//
// Dev-only (mounted behind a NODE_ENV guard in layout). Shadow-DOM isolated. Zero deps.

import { useEffect } from "react";
import { catalogFontFaceCss, directions, replaces, target, wiring, menuMode, type Direction } from "./catalog.generated";
import "./fl-census"; // side-effect module: window.__flCensus (census / cluster / paint)

const ENDPOINT = "http://localhost:7777";
const STORE_KEY = "fontlab.working.v1";
// Stamped by `font_lab_init` with the tool version that installed this panel (left as the
// literal placeholder in the repo template; replaced on copy).
const PANEL_VERSION = "0.9.3";
const isRealVersion = (v: string) => /^\d+\.\d+\.\d+/.test(v || "");
const cmpVersions = (a: string, b: string) => {
  const parse = (v: string) => String(v || "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};
const ROLES = ["display", "body", "mono"] as const;
type Role = (typeof ROLES)[number];
// The census speaks structural voices; the curation language stays display/body/mono. This map
// is the bridge: flipping a role paints every cluster of its voice.
const VOICE: Record<Role, string> = { display: "heading", body: "body", mono: "label" };
const ROLE_OF: Record<string, Role> = { heading: "display", body: "body", label: "mono" };

type Cand = { family: string; stack: string; weights: number[]; source: string; parity: string; tag?: string };
type Conn = "offline" | "ready" | "agent";
type Dir = { id: string; name: string; vibe: string; rationale: string; roles: Record<Role, Cand> };
const wir = (wiring || {}) as Partial<Record<Role, { var: string; el: string } | null>>;

function currentLabel(rendered?: Partial<Record<Role, { family: string }>>): string {
  const fams = [
    rendered?.display?.family ?? replaces?.display,
    rendered?.body?.family ?? replaces?.body,
  ].filter(Boolean) as string[];
  const uniq = [...new Set(fams)];
  return uniq.length ? `Current — ${uniq.join(" / ")}` : "Current";
}

export function FontLabDevPanel() {
  useEffect(() => {
    const root = document.documentElement;
    const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
    // The editorial voice. Local serif-italic stack for now; docs/PANEL-VISION.md specs embedded
    // Instrument Serif subsets as the build-step upgrade — this stack is its fallback either way.
    const SERIF_I = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";

    // ---- data --------------------------------------------------------------------------
    let dirs: Dir[] = (directions as unknown as Dir[]).slice();
    const CANDS: Record<Role, Cand[]> = { display: [], body: [], mono: [] };
    const rebuildCands = () => {
      for (const role of ROLES) {
        const seen = new Set<string>();
        CANDS[role] = [];
        for (const d of dirs) {
          const c = d.roles[role];
          if (!seen.has(c.family)) {
            seen.add(c.family);
            CANDS[role].push({ ...c, source: c.source ?? "google", parity: c.parity ?? "guaranteed" });
          }
        }
      }
    };
    rebuildCands();

    // Every role PREVIEWS (paint reaches everything that renders). `wiring` is ship-scope
    // honesty only: a role with no live seam is badged "agent wires on ship", never disabled.
    const shipWired = (role: Role) => !!wir[role];
    const flc = () => (window as unknown as { __flCensus?: any }).__flCensus;
    // The rendered "Current" per role — measured by the census (what eyes see), NOT `replaces`
    // (what source declares). On a dead-chain site the two disagree; the census wins.
    const renderedCurrent: Partial<Record<Role, { family: string; stack: string }>> = {};
    let censusDone = false;
    function captureCurrent() {
      const fc = flc();
      if (!fc) return;
      const fams = fc.renderedFamilies() as Record<string, string>;
      const paintedNow = (fc.paintedVoices?.() ?? {}) as Record<string, string>;
      for (const role of ROLES) {
        const fam = fams[VOICE[role]];
        if (!fam) continue;
        const el = document.querySelector(`[data-flv="${VOICE[role]}"]`);
        // While that voice is painted, an element's computed stack is OUR preview face — keep the
        // previously captured site stack (or the bare family) instead of laundering paint as "current".
        const stack = paintedNow[VOICE[role]]
          ? (renderedCurrent[role]?.stack ?? `'${fam}'`)
          : el ? getComputedStyle(el).fontFamily : `'${fam}'`;
        renderedCurrent[role] = { family: fam, stack };
      }
      // Truthful before-label on the TOC's row 0 — rendered families, not declared ones.
      const t0 = shadow.querySelector('.toc-row[data-idx="0"] .tname') as HTMLElement | null;
      if (t0) t0.textContent = currentLabel(renderedCurrent);
    }
    function ensureCensus() {
      const fc = flc();
      if (!fc || censusDone) return;
      fc.census();
      censusDone = true;
      captureCurrent();
    }

    const FACE_ID = "fontlab-catalog-faces";
    if (!document.getElementById(FACE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = FACE_ID;
      styleEl.textContent = catalogFontFaceCss;
      document.head.appendChild(styleEl);
    }
    // Page-side FX classes (x-ray, flash, spotlight, edit outline). Element-level classes so
    // highlights are scroll-proof; __fl_ prefix to stay clear of host-site CSS.
    const FX_ID = "fontlab-page-fx";
    if (!document.getElementById(FX_ID)) {
      const fx = document.createElement("style");
      fx.id = FX_ID;
      fx.textContent = `
        .__fl_hover { box-shadow: inset 0 -2px 0 0 #B7CC00 !important; border-radius: 2px; }
        .__fl_hit { box-shadow: inset 0 -2px 0 0 #B7CC00, inset 0 0 0 200vmax rgba(231,255,59,.13) !important; border-radius: 2px; }
        .__fl_other { box-shadow: inset 0 0 0 1px rgba(120,120,110,.45) !important; border-radius: 2px; }
        .__fl_flash { position: relative; }
        .__fl_flash::after { content: ""; position: absolute; inset: -3px -5px; border-radius: 3px; pointer-events: none;
          background: rgba(231,255,59,.28); box-shadow: 0 0 0 1px rgba(183,204,0,.5); opacity: 0; animation: __fl_decay 700ms ease-out; }
        .__fl_flash_soft { position: relative; }
        .__fl_flash_soft::after { content: ""; position: absolute; inset: -3px -5px; border-radius: 3px; pointer-events: none;
          background: rgba(231,255,59,.12); opacity: 0; animation: __fl_decay 700ms ease-out; }
        @keyframes __fl_decay { 0% { opacity: 1; } 100% { opacity: 0; } }
        .__fl_spot { position: relative; }
        .__fl_spot::after { content: ""; position: absolute; inset: -5px -8px; border-radius: 4px; pointer-events: none;
          box-shadow: 0 0 0 2px #B7CC00; opacity: 0; animation: __fl_pulse 1.4s ease-out; }
        @keyframes __fl_pulse { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
        .__fl_editing { outline: 2px solid #B7CC00 !important; outline-offset: 3px; border-radius: 2px;
          background: rgba(231,255,59,.07) !important; cursor: text; }
        @media (prefers-reduced-motion: reduce) {
          .__fl_flash::after, .__fl_flash_soft::after { animation: none; opacity: 1; transition: opacity .2s linear 1.1s; }
          .__fl_spot::after { animation: none; opacity: 1; }
        }`;
      document.head.appendChild(fx);
    }

    // ---- state -------------------------------------------------------------------------
    const state = {
      cursor: 0, // 0 = Current, 1..n = dirs
      sel: { display: -1, body: -1, mono: -1 } as Record<Role, number>,
      focus: "display" as Role,
      beforeView: false,
      lastView: null as null | { sel: Record<Role, number>; cursor: number },
      inspect: true,
      expanded: true,
      keysOpen: false,
      mixCount: 0,
      conn: "offline" as Conn,
      savedId: null as string | null,
      shipped: null as { current: boolean } | null,
      saving: false,
    };
    const BEFORE_SEL: Record<Role, number> = { display: -1, body: -1, mono: -1 };

    const famOf = (role: Role, sel = state.sel) =>
      sel[role] < 0 ? (renderedCurrent[role]?.family ?? replaces?.[role] ?? "current") : CANDS[role][sel[role]].family;
    const candOf = (role: Role, sel = state.sel) => (sel[role] < 0 ? null : CANDS[role][sel[role]]);
    const stackOf = (role: Role, sel = state.sel) => (sel[role] < 0 ? (renderedCurrent[role]?.stack ?? "") : CANDS[role][sel[role]].stack);
    const trio = (sel = state.sel) => ROLES.map((r) => famOf(r, sel)).join(" / ");
    const onCurrent = (sel = state.sel) => ROLES.every((r) => sel[r] < 0);
    const matchedDir = (sel = state.sel): Dir | null =>
      onCurrent(sel) ? null : dirs.find((d) => ROLES.every((r) => d.roles[r].family === famOf(r, sel))) || null;
    const effSel = () => (state.beforeView ? BEFORE_SEL : state.sel);
    const activeId = () => {
      const eff = effSel();
      if (onCurrent(eff)) return "current";
      return matchedDir(eff)?.id ?? "mixed";
    };
    const workingParity = (sel = effSel()): "guaranteed" | "best-effort" =>
      ROLES.some((r) => { const c = candOf(r, sel); return !!c && c.parity !== "guaranteed"; }) ? "best-effort" : "guaranteed";

    // ---- paint (the preview mechanism) ---------------------------------------------------
    // A flip paints the role's VOICE through fl-census's single stylesheet — attribute
    // selectors + !important reach dead chains, inline-style islands, and system-stack mono
    // identically. sel < 0 clears the voice back to the site's own rendering.
    function paintRole(role: Role, sel: Record<Role, number>) {
      const fc = flc();
      if (!fc) return;
      fc.paintVoice(VOICE[role], sel[role] < 0 ? null : CANDS[role][sel[role]].stack);
    }

    type ScanHit = { el: HTMLElement; role: Role; chars: number };
    let scanCache: ScanHit[] | null = null;
    const OURS = (el: Element) => !!(el.closest("#fontlab-panel-host") || el.closest("#fontlab-overlay-host"));
    // The census stamps every classified element with its voice (data-flv); scan() is a cached
    // view over those stamps in role terms — same shape the sentinel scan used to return, so
    // coverage/x-ray/flash/J-jump ride it unchanged.
    function scan(): ScanHit[] {
      if (scanCache) return scanCache;
      ensureCensus();
      const out: ScanHit[] = [];
      document.querySelectorAll<HTMLElement>("[data-flv]").forEach((el) => {
        const role = ROLE_OF[el.getAttribute("data-flv") || ""];
        if (!role || OURS(el)) return;
        let chars = 0;
        for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) chars += n.textContent!.trim().length;
        if (chars > 0) out.push({ el, role, chars });
      });
      scanCache = out;
      return out;
    }
    const invalidateScan = () => { scanCache = null; };
    // Keep the stamps alive through hydration churn, HMR, lazy content, and client-side route
    // changes: restamp new nodes into existing clusters; when too much text no longer matches
    // any known cluster (a route change brought a new voice), take a fresh census — paint rules
    // are voice-keyed, so they re-attach to the new stamps automatically.
    const maintain = () => {
      invalidateScan();
      const fc = flc();
      if (!fc || !censusDone || editingEl) return; // never fight the caret; endEdit catches up
      const r = fc.restamp();
      if (r.unmatchedChars > Math.max(40, r.totalChars * 0.1)) {
        fc.recensus();
        captureCurrent();
      }
    };
    let moDebounce: ReturnType<typeof setTimeout> | null = null;
    const inOurs = (n: Node) => {
      const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
      return el ? OURS(el) : false;
    };
    const mo = new MutationObserver((muts) => {
      if (muts.every((m) => inOurs(m.target))) return;
      if (moDebounce) clearTimeout(moDebounce);
      moDebounce = setTimeout(maintain, 300);
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    function coverage() {
      const chars: Record<Role, number> = { display: 0, body: 0, mono: 0 };
      const count: Record<Role, number> = { display: 0, body: 0, mono: 0 };
      let total = 0;
      for (const { role, chars: c } of scan()) { chars[role] += c; count[role]++; total += c; }
      return { chars, count, total };
    }

    // ---- keymap: single source of truth for every painted key hint ------------------------
    // The resting colophon spine, the "? keys" back page, and their tooltips all render from
    // this table. `keys` lists the exact e.key values each entry covers; panel-keys-test.mjs
    // asserts this table and the onKey handler below never drift apart.
    type KeyDef = { kbd: string; label: string; title: string; group: string; keys: string[]; spine?: boolean };
    const KEYMAP: KeyDef[] = [
      { kbd: "←→", label: "direction", group: "navigate", keys: ["ArrowLeft", "ArrowRight"], spine: true, title: "previous / next direction" },
      { kbd: "↑↓", label: "role", group: "navigate", keys: ["ArrowUp", "ArrowDown"], spine: true, title: "move between the three roles" },
      { kbd: "[ ]", label: "font", group: "navigate", keys: ["[", "]"], spine: true, title: "previous / next font for the focused role (or the text you're pointing at)" },
      { kbd: "space", label: "snap back", group: "proof", keys: [" "], title: "snap back to the direction you viewed last — tap repeatedly to compare two finalists" },
      { kbd: "B", label: "before", group: "proof", keys: ["b", "B"], title: "tap: toggle the site's current fonts · hold the key to peek" },
      { kbd: "S", label: "save mix", group: "record", keys: ["s", "S"], title: "save a hand-mixed set as a direction in the list" },
      { kbd: "↵", label: "pick", group: "record", keys: ["Enter"], title: "save your pick — same as the PICK button" },
      { kbd: "X", label: "inspect", group: "inspect", keys: ["x"], title: "hover-identify text on the page (on by default) · double-click retypes words" },
      { kbd: "⇧X", label: "map", group: "inspect", keys: ["X"], title: "tag every element on the page with its role at once" },
      { kbd: "J", label: "jump", group: "inspect", keys: ["j", "J"], title: "scroll to the nearest element of the focused role" },
      { kbd: "`", label: "collapse", group: "panel", keys: ["`"], title: "tuck the panel to its masthead bar — ` reopens" },
      { kbd: "?", label: "keys", group: "panel", keys: ["?", "Escape"], title: "this back page — ? opens · esc closes" },
    ];
    const keyHint = (k: KeyDef) => `<span title="${k.title}"><kbd>${k.kbd}</kbd> ${k.label}</span>`;
    const spineHTML = KEYMAP.filter((k) => k.spine).map(keyHint).join("");
    const keysPageHTML = [...new Set(KEYMAP.map((k) => k.group))].map((g) =>
      `<div class="kgrp"><span class="kgl u">${g}</span><span class="kks">${KEYMAP.filter((k) => k.group === g).map(keyHint).join("")}</span></div>`).join("");

    // ---- hosts -------------------------------------------------------------------------
    const overlay = document.createElement("div");
    overlay.id = "fontlab-overlay-host";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    document.body.appendChild(overlay);

    const host = document.createElement("div");
    host.id = "fontlab-panel-host";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .slip { width: 344px; background: #100F0D; color: #F2EFE5; border: 1px solid rgba(242,239,229,.14);
          border-radius: 6px; box-shadow: 0 22px 60px rgba(8,7,4,.6); font-family: ${MONO}; position: relative; overflow: hidden; }
        button { font-family: inherit; background: none; border: 0; color: inherit; cursor: pointer; }
        button:focus-visible { outline: 2px solid #E7FF3B; outline-offset: 1px; }
        .u { text-transform: uppercase; letter-spacing: .14em; }
        .linkish { color: rgba(242,239,229,.8); text-decoration: underline dotted; font-size: inherit; padding: 0; }

        .mast { display: flex; align-items: center; gap: 9px; padding: 10px 14px; height: 46px; }
        .badge { width: 26px; height: 26px; background: #191813; border: 1px solid rgba(242,239,229,.14); border-radius: 3px;
          display: grid; place-items: center; font-size: 14px; color: #F2EFE5; flex: none; }
        .wordmark { font-size: 11px; letter-spacing: .18em; font-weight: 600; white-space: nowrap; }
        .collapsed-info { display: none; align-items: baseline; gap: 6px; margin-left: 2px; font-size: 9.5px;
          color: rgba(242,239,229,.6); letter-spacing: .06em; min-width: 0; flex: 0 1 auto; overflow: hidden; }
        /* the unsaved marker is STATE — it never truncates; under pressure the \` hint gives
           way first, then the direction name, and the marker keeps its full width */
        .collapsed-info .ciname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
        .collapsed-info .ciunsaved { color: #E7FF3B; flex: none; white-space: nowrap; }
        .collapsed-info .ciopen { opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 999 auto; }
        .slip[data-collapsed="true"] .collapsed-info { display: inline-flex; }
        /* collapsed, the presence keeps its dot (the state) and cedes the label's width */
        .slip[data-collapsed="true"] #presLabel { display: none; }
        .slip[data-collapsed="true"] .presence { margin-left: auto; }
        .inspect-btn { width: 26px; height: 22px; display: grid; place-items: center; border: 1px solid rgba(242,239,229,.18);
          border-radius: 2px; font-size: 12px; color: rgba(242,239,229,.75); margin-left: auto; flex: none; }
        .inspect-btn[aria-pressed="true"] { background: #F2EFE5; color: #100F0D; border-color: #F2EFE5; }
        .presence { display: flex; align-items: center; gap: 6px; font-size: 8.5px; letter-spacing: .12em; color: rgba(242,239,229,.66); flex: none; }
        .pdot { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid rgba(242,239,229,.5); }
        .presence[data-conn="ready"] .pdot { background: #F2EFE5; border-color: #F2EFE5; }
        .presence[data-conn="agent"] .pdot { background: #6EE7A0; border-color: #6EE7A0; animation: fl-pulse 2.4s ease-in-out infinite; }
        @keyframes fl-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        .dogear { position: absolute; top: 0; right: 0; width: 0; height: 0; border-style: solid; border-width: 0 16px 16px 0;
          border-color: transparent #191813 transparent transparent; cursor: pointer; filter: drop-shadow(-1px 1px 0 rgba(242,239,229,.12)); }
        .oxford { border-top: 2px solid rgba(242,239,229,.3); border-bottom: 1px solid rgba(242,239,229,.14); height: 5px; }

        .notice { display: none; margin: 10px 14px 0; padding: 9px 11px; border: 1px solid rgba(233,138,109,.4); border-radius: 3px; background: #191813; }
        .notice[data-show="true"] { display: block; animation: fl-notice .24s cubic-bezier(.25,1,.5,1); }
        .notice .nh { font-size: 9.5px; letter-spacing: .14em; color: #E98A6D; font-weight: 600; }
        .notice .nb { margin-top: 4px; font-size: 10px; line-height: 1.55; color: rgba(242,239,229,.78); }
        .notice code { background: rgba(242,239,229,.1); padding: 0 4px; border-radius: 3px; font-family: inherit; font-size: 9.5px; }
        @keyframes fl-notice { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: none; } }

        .sect { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; }
        .sect .lab { font-size: 9.5px; letter-spacing: .16em; color: rgba(242,239,229,.58); font-weight: 600; }
        .sect .rule { flex: 1; border-top: 1px solid rgba(242,239,229,.14); }
        .sect .counter { font-size: 10px; font-variant-numeric: tabular-nums; color: rgba(242,239,229,.58); }
        .sect .counter b { color: #E7FF3B; font-weight: 600; }
        .sect .starter { font-size: 8.5px; letter-spacing: .12em; font-weight: 700; text-transform: uppercase;
          color: #100F0D; background: #E9A88F; border-radius: 3px; padding: 2px 6px; cursor: help; white-space: nowrap; }
        .sect .starter[hidden] { display: none; }
        .toc { max-height: 148px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(242,239,229,.2) transparent;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 12px), transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, #000 8px, #000 calc(100% - 12px), transparent 100%); }
        .toc-row { display: flex; align-items: baseline; gap: 8px; width: 100%; height: 37px; padding: 7px 14px; text-align: left; }
        .toc-row:hover { background: #191813; }
        .toc-row .folio { font-size: 10px; font-variant-numeric: tabular-nums; color: rgba(242,239,229,.5); min-width: 18px; flex: none; }
        .toc-row[aria-current="true"] .folio { color: #E7FF3B; }
        .toc-row .tname { font-size: 14.5px; color: #F2EFE5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          position: relative; padding-bottom: 2px; max-width: 200px; }
        .toc-row[aria-current="true"] .tname::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 3px;
          background: #E7FF3B; animation: fl-draw .16s ease-out; transform-origin: left; }
        @keyframes fl-draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .toc-row .leader { flex: 1; border-bottom: 1px dotted rgba(242,239,229,.28); transform: translateY(-3px); min-width: 12px; }
        .toc-row .vibe { font-size: 9px; letter-spacing: .1em; color: rgba(242,239,229,.5); flex: none; }
        .toc-cue { display: none; padding: 2px 14px 6px; font-size: 8.5px; letter-spacing: .1em; color: rgba(242,239,229,.45); text-align: right; width: 100%; }
        .toc-cue[data-show="true"] { display: block; }

        /* "none of these — ask for more" — the in-panel demand channel */
        .more-trigger { display: block; width: calc(100% - 28px); margin: 4px 14px 10px; padding: 7px 10px; text-align: left;
          background: none; border: 1px dashed rgba(242,239,229,.22); border-radius: 4px; color: rgba(242,239,229,.72);
          font-size: 10.5px; letter-spacing: .02em; cursor: pointer; }
        .more-trigger:hover { border-color: rgba(242,239,229,.4); color: #F2EFE5; background: #191813; }
        .more-sheet { margin: 0 14px 10px; padding: 12px; background: #17160f; border: 1px solid rgba(242,239,229,.14); border-radius: 5px; }
        .more-sheet[hidden] { display: none; }
        .more-sheet .mh { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: rgba(242,239,229,.6); font-weight: 600; margin-bottom: 8px; }
        .more-q { margin-bottom: 9px; }
        .more-q .ql { font-size: 10.5px; color: rgba(242,239,229,.82); font-family: ${SERIF_I}; font-style: italic; margin-bottom: 5px; }
        .more-q .ql .qhint { font-family: ${MONO}; font-style: normal; font-size: 8px; letter-spacing: .1em; text-transform: uppercase;
          color: rgba(242,239,229,.42); margin-left: 6px; white-space: nowrap; }
        .more-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .more-chip { font-size: 10px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(242,239,229,.2);
          background: none; color: rgba(242,239,229,.75); cursor: pointer; white-space: nowrap; }
        .more-chip:hover { border-color: rgba(242,239,229,.45); color: #F2EFE5; }
        .more-chip[aria-pressed="true"] { background: #E7FF3B; border-color: #E7FF3B; color: #100F0D; font-weight: 600; }
        .more-note { width: 100%; margin-top: 2px; padding: 7px 9px; background: #100F0D; border: 1px solid rgba(242,239,229,.2);
          border-radius: 4px; color: #F2EFE5; font-size: 11px; font-family: inherit; resize: vertical; min-height: 34px; box-sizing: border-box; }
        .more-note:focus { outline: none; border-color: #B7CC00; }
        .more-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
        .more-send { flex: none; background: #F2EFE5; color: #100F0D; border: 0; border-radius: 4px; padding: 6px 14px;
          font-weight: 700; font-size: 10.5px; letter-spacing: .06em; cursor: pointer; }
        .more-send:hover { background: #fff; }
        .more-cancel { background: none; border: 0; color: rgba(242,239,229,.55); font: inherit; font-size: 10px; cursor: pointer; padding: 0; }
        .more-cancel:hover { color: #F2EFE5; }
        .more-ack { margin-top: 9px; font-size: 10.5px; line-height: 1.5; color: rgba(242,239,229,.8); }
        .more-ack[data-tone="good"] { color: #9BE7B8; } .more-ack[data-tone="warn"] { color: #E9A88F; }
        .more-ack .offramp { display: block; margin-top: 6px; }
        .more-ack .linkish { color: #E7FF3B; text-decoration: underline; cursor: pointer; background: none; border: 0; font: inherit; padding: 0; }

        .standfirst { padding: 10px 14px 12px; border-top: 1px solid rgba(242,239,229,.1); font-family: ${SERIF_I}; font-style: italic;
          font-size: 13.5px; line-height: 1.45; color: rgba(242,239,229,.88); min-height: 40px; letter-spacing: .01em; }
        /* save-mix lives on the sentence that names it — shown only when there is a mix to save */
        .standfirst .savelink { font: inherit; color: #F2EFE5; text-decoration: underline dotted; text-underline-offset: 3px;
          text-decoration-color: rgba(242,239,229,.5); padding: 0; }
        .standfirst .savelink:hover { text-decoration-color: #F2EFE5; }

        .spread { border-top: 1px solid rgba(242,239,229,.14); }
        .row { display: grid; grid-template-columns: 22px 1fr auto; padding: 8px 14px 8px 0; border-bottom: 1px solid rgba(242,239,229,.08);
          position: relative; cursor: pointer; }
        .row:last-child { border-bottom: 0; }
        .row .margin { display: grid; place-items: center; font-size: 9px; color: rgba(242,239,229,.4); }
        .row[data-focus="true"] .margin { color: #100F0D; position: relative; z-index: 1; font-weight: 700; }
        .row[data-focus="true"]::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 16px; background: #E7FF3B; }
        .row .mid { min-width: 0; padding-left: 10px; }
        .row .labline { display: flex; align-items: center; gap: 6px; font-size: 9px; letter-spacing: .14em; color: rgba(242,239,229,.55); }
        .row .cov { margin-left: auto; letter-spacing: .04em; font-size: 8.5px; color: rgba(242,239,229,.42); font-variant-numeric: tabular-nums;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; visibility: hidden; }
        /* routine coverage reveals under the hand; the honesty edges stay pinned — a zero
           ("0 spots" = an invisible pick) and the post-flip verdicts are always shown */
        .row:hover .cov, .row[data-focus="true"] .cov, .row .cov[data-pin="true"],
        .row .cov[data-verdict="changed"], .row .cov[data-verdict="same"] { visibility: visible; }
        .row .cov[data-verdict="changed"] { color: #F2EFE5; }
        .row .parity { border: 1px solid rgba(233,138,109,.5); color: #E98A6D; border-radius: 2px; padding: 0 3px; font-size: 8.5px; letter-spacing: 0; }
        .row .wtag { border: 1px solid rgba(242,239,229,.3); border-radius: 2px; padding: 0 4px; font-size: 8px; letter-spacing: .1em;
          color: rgba(242,239,229,.6); white-space: nowrap; flex: none; }
        .row .spec { display: flex; align-items: baseline; gap: 8px; margin-top: 2px; }
        .row .fam { font-size: 20px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #F6F3EA; transition: color 1.6s ease; }
        .row .fam[data-just="true"] { color: #E7FF3B; transition: color .05s; }
        .row[data-role="body"] .fam { font-size: 16px; } .row[data-role="mono"] .fam { font-size: 13.5px; }
        .row .tagline { font-family: ${SERIF_I}; font-style: italic; font-size: 11.5px; color: rgba(242,239,229,.55); margin-top: 1px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: .01em; min-height: 0; }
        .row .right { display: flex; align-items: center; gap: 3px; padding-left: 8px; }
        .row .pos { font-size: 9.5px; font-variant-numeric: tabular-nums; color: rgba(242,239,229,.5); margin-right: 3px; white-space: nowrap; }
        /* steppers rest quiet and appear under the hand — the same gesture that lights the
           margin bar. visibility (not opacity) so a hidden step is never tabbable/clickable.
           The counter stays: "font 03/04" is state, the buttons are only affordance. */
        .row .step { width: 24px; height: 24px; border: 1px solid rgba(242,239,229,.16); border-radius: 2px; font-size: 12px;
          color: rgba(242,239,229,.8); display: grid; place-items: center; visibility: hidden; }
        .row:hover .step, .row[data-focus="true"] .step { visibility: visible; }
        .row .step:hover:not(:disabled) { background: #232219; }
        .row .step:disabled { opacity: .25; cursor: not-allowed; }
        .row .bkt { visibility: hidden; font-size: 8.5px; letter-spacing: .04em; color: rgba(242,239,229,.4); margin-right: 2px; }
        .row[data-focus="true"] .bkt { visibility: visible; }
        .row[data-dimmed="true"] { opacity: .7; }

        .pickwrap { padding: 10px 14px 6px; border-top: 1px solid rgba(242,239,229,.14); display: flex; gap: 8px; }
        /* compare-the-proof sits beside pass-the-proof. PAPER when pressed (like the inspect
           toggle), never yellow — compare is neither the editor's hand nor a caution. */
        .beforetog { flex: none; height: 40px; padding: 0 12px; border: 1px solid rgba(242,239,229,.25); border-radius: 3px;
          font-size: 9.5px; letter-spacing: .1em; color: rgba(242,239,229,.8); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .beforetog:hover { background: #232219; }
        .beforetog[aria-pressed="true"] { background: #F2EFE5; color: #100F0D; border-color: #F2EFE5; }
        .pick { flex: 1; height: 40px; background: #E7FF3B; color: #100F0D; border-radius: 3px; font-size: 11px; font-weight: 700;
          letter-spacing: .12em; display: inline-flex; align-items: center; justify-content: center; gap: 8px; position: relative; }
        .pick .enterhint { position: absolute; right: 12px; font-size: 9.5px; font-weight: 400; opacity: .5; letter-spacing: 0; }
        .pick:disabled .enterhint { display: none; }
        .pick:hover:not(:disabled) { background: #EFFF66; }
        .pick:disabled { background: #232219; color: rgba(242,239,229,.45); cursor: not-allowed; }
        .pick[data-state="shipped"] { background: #100F0D; color: #E7FF3B; border: 1px solid #E7FF3B; }
        .pick .tick { width: 14px; height: 14px; display: none; }
        .pick[data-state="picked"] .tick, .pick[data-state="shipped"] .tick { display: block; }
        .pick .tick path { fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 20; }
        .pick[data-just="true"] .tick path { animation: fl-tickdraw .42s cubic-bezier(.25,1,.5,1); }
        @keyframes fl-tickdraw { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
        .status { padding: 7px 14px 10px; font-size: 10px; line-height: 1.55; color: rgba(242,239,229,.7); min-height: 30px; }
        .status b { color: #F2EFE5; font-weight: 600; }
        .status[data-tone="good"] { color: #9BE7B8; } .status[data-tone="warn"] { color: #E9A88F; }

        .colophon { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 8px; padding: 9px 14px 11px;
          border-top: 1px solid rgba(242,239,229,.14); font-size: 8.5px; letter-spacing: .06em; color: rgba(242,239,229,.62); }
        /* the one interactive element in the colophon — boxed so it LOOKS interactive at rest */
        .keysdoor { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; flex: none;
          border: 1px solid rgba(242,239,229,.3); border-radius: 3px; color: rgba(242,239,229,.85); letter-spacing: inherit; font-size: inherit; }
        .keysdoor:hover { border-color: rgba(242,239,229,.6); }
        .keysdoor[aria-expanded="true"] { background: #F2EFE5; color: #100F0D; border-color: #F2EFE5; }
        .keysdoor[aria-expanded="true"] kbd { color: #100F0D; border-color: rgba(16,15,13,.4); }
        kbd { border: 1px solid rgba(242,239,229,.28); border-radius: 2px; padding: 1px 4px; font-family: inherit; font-size: 8.5px; color: rgba(242,239,229,.8); }
        .ver { font-size: 8.5px; color: rgba(242,239,229,.35); }

        /* the back page — the full key reference, flipped to via "? keys". An overlay over the
           slip body (Pick never moves) that never covers the masthead's presence/unsaved state.
           It IS the back of the slip: click anywhere to flip it back over (the keycaps are
           reference, not controls), so a first-run reader is never trapped needing the keyboard. */
        .keys { display: none; position: absolute; left: 0; right: 0; top: 51px; bottom: 0; z-index: 5; background: #191813;
          border-top: 1px solid rgba(242,239,229,.2); padding: 12px 14px; overflow-y: auto; flex-direction: column; cursor: pointer; }
        .keys[data-open="true"] { display: flex; }
        .keys .kmsub { font-family: ${SERIF_I}; font-style: italic; font-size: 12.5px; color: rgba(242,239,229,.7); padding-bottom: 8px; }
        .keys .kgrp { display: grid; grid-template-columns: 64px 1fr; gap: 10px; padding: 8px 0; border-top: 1px solid rgba(242,239,229,.12); align-items: baseline; }
        .keys .kgl { font-size: 8.5px; letter-spacing: .2em; color: rgba(242,239,229,.5); }
        .keys .kks { display: flex; flex-wrap: wrap; gap: 5px 12px; font-size: 9.5px; color: rgba(242,239,229,.75); letter-spacing: .04em; }
        .keys .kks span { display: inline-flex; align-items: center; gap: 4px; }
        .keys .kmfoot { margin-top: auto; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;
          font-size: 8.5px; color: rgba(242,239,229,.45); }
        .keys .kmfoot .khint { flex: 1; min-width: 0; }
        .keys .kmfoot .khint kbd { margin: 0 1px; }
        /* the explicit dismiss — paper-filled so it reads as the primary action on first sight */
        .keys .kmdone { flex: none; background: #F2EFE5; color: #100F0D; border-radius: 3px; padding: 6px 14px; font-weight: 700;
          letter-spacing: .1em; font-size: 9.5px; }
        .keys .kmdone:hover { background: #fff; }

        .slip[data-collapsed="true"] > :not(.mast):not(.dogear) { display: none; }
        .slip[data-collapsed="true"] .inspect-btn { display: none; }
        @media (prefers-reduced-motion: reduce) { * { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
      </style>
      <div class="slip" data-collapsed="false" role="group" aria-label="Font Lab">
        <div class="mast">
          <div class="badge" id="aa" title="the current display font">Aa</div>
          <span class="wordmark u">FONT LAB</span>
          <span class="collapsed-info" id="collapsedInfo"></span>
          <button class="inspect-btn" id="inspectBtn" aria-pressed="true" title="Inspect — hover the page to identify text (X toggles)">⌖</button>
          <div class="presence" id="presence" data-conn="offline"><span class="pdot"></span><span id="presLabel">CONNECTING…</span></div>
        </div>
        <div class="dogear" id="dogear" title="collapse"></div>
        <div class="oxford"></div>
        <div class="keys" id="keys" data-open="false" role="dialog" aria-label="All keys — the back of the slip">
          <div class="kmsub">the back of the slip — every key, grouped by act</div>
          ${keysPageHTML}
          <div class="kmfoot"><span class="khint">tap anywhere to flip back · <kbd>?</kbd> reopens it</span><button class="kmdone" id="keysClose" aria-label="flip back to the panel">Got it</button></div>
        </div>
        <div class="notice" id="notice" data-show="false">
          <div class="nh u" id="noticeHead"></div>
          <div class="nb" id="noticeBody"></div>
        </div>
        <div class="sect">
          <span class="lab u">DIRECTION</span>
          <span class="starter" id="starter" hidden title="This is Font Lab's starter menu — the same deterministic set every project falls back to, not yet tailored to this one. For options chosen for what you're going for, ask your agent to run intake and compose a tailored menu.">STARTER · NOT TAILORED</span>
          <span class="rule"></span>
          <span class="counter" id="counter"></span>
        </div>
        <div class="toc" id="toc"></div><button class="toc-cue" id="tocCue"></button>
        <button class="more-trigger" id="moreTrigger">None of these? Tell Font Lab what you want →</button>
        <div class="more-sheet" id="moreSheet" hidden>
          <div class="mh">What are you looking for?</div>
          <div class="more-q" data-q="feeling" data-multi="true"><div class="ql">What should the type feel like?<span class="qhint">combine any</span></div><div class="more-chips" role="group" aria-label="What should the type feel like — combine any that apply">
            <button class="more-chip" data-v="editorial &amp; literary">editorial</button><button class="more-chip" data-v="technical &amp; precise">technical</button><button class="more-chip" data-v="warm &amp; human">warm</button><button class="more-chip" data-v="bold &amp; expressive">bold</button><button class="more-chip" data-v="quiet &amp; minimal">minimal</button><button class="more-chip" data-v="classic &amp; trustworthy">classic</button>
          </div></div>
          <div class="more-q" data-q="departure"><div class="ql">How far from the current look?</div><div class="more-chips">
            <button class="more-chip" data-v="a subtle refinement">subtle</button><button class="more-chip" data-v="a clear shift">a clear shift</button><button class="more-chip" data-v="a dramatic rebrand">dramatic</button>
          </div></div>
          <div class="more-q" data-q="brand"><div class="ql">A brand or aesthetic to evoke — or avoid?</div>
            <textarea class="more-note" id="moreBrand" rows="1" placeholder="e.g. like a respected magazine · not another SaaS template"></textarea></div>
          <div class="more-q"><div class="ql">Anything else? (optional)</div>
            <textarea class="more-note" id="moreNote" rows="2" placeholder="what you're going for, in your words"></textarea></div>
          <div class="more-actions">
            <button class="more-send" id="moreSend">Get more →</button>
            <button class="more-cancel" id="moreCancel">cancel</button>
          </div>
          <div class="more-ack" id="moreAck" hidden></div>
        </div>
        <div class="standfirst" id="standfirst"></div>
        <div class="spread" id="spread"></div>
        <div class="pickwrap">
          <button class="beforetog" id="beforeTog" data-fl-action="compare" aria-pressed="false"
            title="toggle the site's current fonts (B) · hold B peeks">⇄ before</button>
          <button class="pick" id="pick" data-state="idle" data-fl-action="pick">
            <svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 8.6 6.2 12l7-8"/></svg>
            <span id="pickLabel">PICK</span>
            <span class="enterhint" aria-hidden="true">↵</span>
          </button>
        </div>
        <div class="status" id="status"></div>
        <div class="colophon">
          ${spineHTML}
          <button class="keysdoor" id="keysDoor" aria-expanded="false" title="every key, grouped by act — ? opens · esc closes"><kbd>?</kbd> keys</button>
          <span class="ver">v${PANEL_VERSION}</span>
        </div>
      </div>`;

    const $ = <T extends HTMLElement = HTMLElement>(id: string) => shadow.getElementById(id) as unknown as T;
    const slip = shadow.querySelector(".slip") as HTMLElement;
    const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

    // Badge the starter (deterministic fallback) menu as provisional — a menu that was never
    // tailored to this project shouldn't pass itself off as one that was. (Older generated modules
    // predate `menuMode`; treat a missing value as composed and stay quiet.)
    if (menuMode === "fallback") { const s = $("starter"); if (s) s.hidden = false; }

    // Pick-guard hints must never stomp a real message (save acks, edit acks, receipts).
    let statusKind: "" | "guard" | "msg" = "";
    const setStatus = (text: string, tone: "" | "good" | "warn" = "", kind: "guard" | "msg" = "msg") => {
      $("status").textContent = text;
      $("status").dataset.tone = tone;
      statusKind = text ? kind : "";
    };
    const setStatusHTML = (html: string, tone: "" | "good" | "warn" = "") => {
      $("status").innerHTML = html;
      $("status").dataset.tone = tone;
      statusKind = "msg";
    };
    const guardStatus = (text: string) => { if (statusKind === "" || statusKind === "guard") setStatus(text, "", "guard"); };

    function updateTocCue() {
      const toc = $("toc"), cue = $("tocCue");
      const hidden = Math.max(0, Math.round((toc.scrollHeight - toc.scrollTop - toc.clientHeight) / 37));
      cue.dataset.show = String(hidden > 0);
      if (hidden > 0) cue.textContent = `+${hidden} more ↓`;
    }
    // ≈ parity honesty: the per-role chip is the persistent surface (it never fades); the full
    // sentence is narrated once per face, the first time that face enters the working mix.
    const fidSaid = new Set<string>();

    // ---- change receipt: flash + ticks + row verdicts + status line ----------------------
    let tickTimer: ReturnType<typeof setTimeout> | null = null;
    let verdictTimer: ReturnType<typeof setTimeout> | null = null;
    let lastChangedRoles: Role[] = [];
    let verdictActive = false;

    function flash(els: HTMLElement[]) {
      const visible = scan().filter(({ el }) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).length;
      const cls = visible && els.length / visible > 0.6 ? "__fl_flash_soft" : "__fl_flash";
      const byRole = new Map(scan().map((e) => [e.el, e.role]));
      els.forEach((el) => {
        const delay = REDUCED ? 0 : Math.max(0, ROLES.indexOf(byRole.get(el) as Role)) * 80;
        setTimeout(() => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }, delay);
      });
      setTimeout(() => els.forEach((el) => { el.classList.remove("__fl_flash"); el.classList.remove("__fl_flash_soft"); }), (REDUCED ? 1400 : 780) + 200);
    }
    function drawTicks(seen: ScanHit[]) {
      overlay.querySelectorAll(".fl-tick").forEach((t) => t.remove());
      if (tickTimer) clearTimeout(tickTimer);
      for (const { el } of seen) {
        const r = el.getBoundingClientRect();
        const t = document.createElement("div");
        t.className = "fl-tick";
        t.style.cssText = `position:fixed;right:0;width:14px;height:2px;background:#B7CC00;z-index:2147483646;pointer-events:auto;cursor:pointer;top:${Math.min(innerHeight - 4, Math.max(2, r.top + r.height / 2))}px`;
        t.title = "changed here — click to scroll";
        t.addEventListener("click", () => { el.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" }); spotlight(el); });
        overlay.appendChild(t);
      }
      tickTimer = setTimeout(() => overlay.querySelectorAll(".fl-tick").forEach((t) => t.remove()), 4200);
    }
    function spotlight(el: HTMLElement) {
      el.classList.remove("__fl_spot"); void el.offsetWidth; el.classList.add("__fl_spot");
      setTimeout(() => el.classList.remove("__fl_spot"), 1500);
    }
    function jumpNearest(role: Role) {
      const els = scan().filter((e) => e.role === role);
      if (!els.length) return;
      const mid = innerHeight / 2;
      els.sort((a, b) => Math.abs(a.el.getBoundingClientRect().top - mid) - Math.abs(b.el.getBoundingClientRect().top - mid));
      const target2 = els.find(({ el }) => { const r = el.getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight; }) || els[0];
      target2.el.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
      setTimeout(() => spotlight(target2.el), 350);
    }

    function reportChange(prevSel: Record<Role, number>, nextSel: Record<Role, number>, changedRoles: Role[]) {
      const liveChanged = changedRoles; // paint previews every role — nothing is preview-dead
      lastChangedRoles = liveChanged;
      const cov = coverage();
      for (const role of ROLES) {
        const row = shadow.querySelector(`.row[data-role="${role}"]`) as HTMLElement | null;
        if (!row) continue;
        const a = famOf(role, prevSel), b = famOf(role, nextSel);
        const v = row.querySelector(".cov") as HTMLElement;
        if (a !== b) {
          v.textContent = role === "body" ? `→ ${cov.count.body} elements changed`
            : `→ ${cov.count[role]} spot${cov.count[role] === 1 ? "" : "s"} changed`;
          v.dataset.verdict = "changed";
          (row.querySelector(".fam") as HTMLElement).dataset.just = "true";
          row.dataset.dimmed = "false";
        } else {
          v.textContent = "unchanged";
          v.dataset.verdict = "same";
          row.dataset.dimmed = String(changedRoles.length > 0);
        }
      }
      verdictActive = true;
      if (verdictTimer) clearTimeout(verdictTimer);
      verdictTimer = setTimeout(() => {
        verdictActive = false;
        shadow.querySelectorAll(".row").forEach((r) => {
          (r as HTMLElement).dataset.dimmed = "false";
          ((r as HTMLElement).querySelector(".fam") as HTMLElement).dataset.just = "false";
        });
        render();
      }, 2600);
      if (liveChanged.length) {
        const els = scan().filter((e) => liveChanged.includes(e.role));
        const vh = innerHeight;
        const seen = els.filter(({ el }) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
        const below = els.filter(({ el }) => el.getBoundingClientRect().top >= vh).length;
        const above = els.length - seen.length - below;
        flash(seen.map((e) => e.el));
        drawTicks(seen);
        let msg = `${els.length} element${els.length === 1 ? "" : "s"} changed`;
        if (!seen.length && els.length) msg += ` · <b>0 in view — J jumps to nearest</b>`;
        else if (below || above) msg += `${below ? ` · ${below} below ↓` : ""}${above ? ` · ${above} above ↑` : ""}`;
        setStatusHTML(`${msg} · <button class="linkish" id="replay">↺ replay</button>`);
        const rb = shadow.getElementById("replay");
        if (rb) rb.addEventListener("click", () => {
          const now = scan().filter((e) => lastChangedRoles.includes(e.role))
            .filter(({ el }) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
          flash(now.map((e) => e.el));
        });
      }
    }

    function applyToPage(prevSel: Record<Role, number> | null, nextSel: Record<Role, number>, opts: { silent?: boolean } = {}) {
      ensureCensus(); // clusters must exist before the first paint
      const changed: Role[] = [];
      for (const role of ROLES) {
        paintRole(role, nextSel);
        if (prevSel && famOf(role, prevSel) !== famOf(role, nextSel)) changed.push(role);
      }
      invalidateScan();
      if (prevSel && !opts.silent) reportChange(prevSel, nextSel, changed);
      return changed;
    }

    // ---- x-ray + map + keyboard pulse ---------------------------------------------------
    let xrayRole: Role | null = null, xrayAll = false;
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;
    function setXray(role: Role | null, all = false) {
      xrayRole = role; xrayAll = all;
      for (const { el, role: r } of scan()) {
        el.classList.toggle("__fl_hit", !!role && r === role);
        el.classList.toggle("__fl_other", all && r !== role);
      }
      overlay.querySelectorAll(".fl-xchip").forEach((c) => c.remove());
      if (all) {
        for (const { el, role: r } of scan()) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > innerHeight || rect.height < 16) continue;
          const chip = document.createElement("div");
          chip.className = "fl-xchip";
          chip.textContent = r[0].toUpperCase();
          chip.style.cssText = `position:fixed;left:${Math.max(16, rect.left - 6)}px;top:${Math.max(8, rect.top)}px;transform:translate(-100%,-40%);z-index:2147483646;` +
            `font:600 9px ${MONO};padding:1px 4px;border-radius:3px;pointer-events:none;` +
            (r === role ? "background:#E7FF3B;color:#100F0D;" : "background:rgba(16,15,13,.85);color:rgba(242,239,229,.9);border:1px solid rgba(242,239,229,.3);");
          overlay.appendChild(chip);
        }
      }
      const covTag = overlay.querySelector(".fl-covtag");
      if (covTag) covTag.remove();
      if (role && !all) {
        const cov = coverage();
        const tag = document.createElement("div");
        tag.className = "fl-covtag";
        tag.textContent = role === "body"
          ? `BODY — ${cov.count.body} elements · ${cov.total ? Math.round((cov.chars.body / cov.total) * 100) : 0}% of text on this page`
          : `${role.toUpperCase()} — ${cov.count[role]} spot${cov.count[role] === 1 ? "" : "s"} on this page`;
        let top = innerHeight - 60;
        const rowEl = shadow.querySelector(`.row[data-role="${role}"]`) as HTMLElement | null;
        if (rowEl) top = Math.max(8, rowEl.getBoundingClientRect().top + 6);
        tag.style.cssText = `position:fixed;right:376px;top:${top}px;z-index:2147483646;background:#100F0D;color:#F2EFE5;` +
          `font:10px ${MONO};letter-spacing:.08em;padding:7px 10px;border-radius:3px;border:1px solid rgba(242,239,229,.2);pointer-events:none;white-space:nowrap;`;
        overlay.appendChild(tag);
      }
    }
    function pulseXray(role: Role) {
      if (pulseTimer) clearTimeout(pulseTimer);
      setXray(role);
      pulseTimer = setTimeout(() => { if (xrayRole === role && !xrayAll) setXray(null); }, 800);
    }

    // ---- inspect: always-on hover layer, no click interception ---------------------------
    let hoverHit: ScanHit | null = null;
    let hoverChip: HTMLElement | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let chipVisible = false;
    let lastInspectEvent: MouseEvent | null = null;
    function inspectClear() {
      if (hoverHit) { hoverHit.el.classList.remove("__fl_hover"); hoverHit = null; }
      if (hoverChip) hoverChip.style.display = "none";
      if (dwellTimer) clearTimeout(dwellTimer);
      chipVisible = false;
    }
    function positionChip(e: MouseEvent) {
      if (!hoverHit) return;
      lastInspectEvent = e;
      if (!hoverChip) {
        hoverChip = document.createElement("div");
        hoverChip.style.cssText = `position:fixed;z-index:2147483647;background:#100F0D;color:#F2EFE5;font:10px ${MONO};` +
          "letter-spacing:.06em;padding:6px 9px;border-radius:3px;border:1px solid rgba(242,239,229,.25);pointer-events:none;white-space:nowrap;line-height:1.6;";
        overlay.appendChild(hoverChip);
      }
      const cs = getComputedStyle(hoverHit.el);
      const cov = coverage();
      const editable = hasEditableRun(hoverHit.el);
      const trapped = editable && !!hoverHit.el.closest(INTERACTIVE);
      const role = hoverHit.role;
      // name the live font in its own typeface — the same touch the panel rows use
      const specimen = stackOf(role, effSel()) || MONO;
      hoverChip.style.display = "block";
      hoverChip.innerHTML =
        `<b style="color:#E7FF3B;font-weight:600">${role.toUpperCase()}</b> · <span style="font-family:${specimen.replace(/"/g, "'")};font-size:13px;line-height:1">${esc(famOf(role, effSel()))}</span> · ${Math.round(parseFloat(cs.fontSize))}px · ${cov.count[role]} on page` +
        `<br><span style="color:rgba(242,239,229,.55)">[ or ] to flip fonts · ${editable ? (trapped ? "⌥ double-click to retype (it's a link)" : "double-click to retype") : "words come from data / markup"}</span>`;
      const r = hoverHit.el.getBoundingClientRect();
      const x = Math.max(8, Math.min(innerWidth - hoverChip.offsetWidth - 8, e.clientX - 20));
      let y = r.top - hoverChip.offsetHeight - 6;
      if (y < 8) y = Math.min(innerHeight - hoverChip.offsetHeight - 8, r.bottom + 6);
      hoverChip.style.left = x + "px";
      hoverChip.style.top = y + "px";
    }
    // [ or ] flips the live fonts; keep the hovering chip's name + specimen in sync
    function refreshChip() {
      if (chipVisible && hoverHit && lastInspectEvent) positionChip(lastInspectEvent);
    }
    const inspectMove = (e: MouseEvent) => {
      if (!state.inspect || !state.expanded || editingEl) return;
      const t = e.target as Element | null;
      if (!t || OURS(t)) { inspectClear(); return; }
      const hit = scan().find(({ el }) => el.contains(t));
      if (!hit) { inspectClear(); return; }
      if (!hoverHit || hoverHit.el !== hit.el) {
        if (hoverHit) hoverHit.el.classList.remove("__fl_hover");
        hoverHit = hit;
        hit.el.classList.add("__fl_hover");
        if (state.focus !== hit.role) { state.focus = hit.role; render(); }
        if (!chipVisible) { // dwell before the first chip; instant once visible
          if (dwellTimer) clearTimeout(dwellTimer);
          dwellTimer = setTimeout(() => { chipVisible = true; positionChip(e); }, 160);
          return;
        }
      }
      if (chipVisible) positionChip(e);
    };
    document.addEventListener("mousemove", inspectMove, true);

    // ---- copy edit: double-click any words, retype, Enter saves to source ----------------
    // Locator (React 19): the JSX call site is the first app frame in the fiber's _debugStack.
    function fiberOf(el: Element): any {
      const k = Object.keys(el).find((k2) => k2.startsWith("__reactFiber$"));
      return k ? (el as any)[k] : null;
    }
    function callSite(el: Element): { url: string; line: number; column: number } | null {
      const f = fiberOf(el);
      const stack = f && f._debugStack && (f._debugStack.stack || "" + f._debugStack);
      if (!stack) return null;
      for (const ln of String(stack).split("\n")) {
        if (/react-stack-top-frame|jsxDEV/.test(ln)) continue;
        const m = ln.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
        if (m) return { url: m[1], line: +m[2], column: +m[3] };
      }
      return null;
    }
    // A "run" is one rendered text node — which is exactly one JsxText node in source, the unit the
    // write-back rewrites (cli/copyedit.mjs resolveTarget). So a headline like
    //   <h1>You pick the type.<br/><em>Your agent ships it.</em></h1>
    // has three runs, and each edits on its own, leaving the inline markup (<em>, <br/>, links)
    // untouched. That's why editing keys off the run under the cursor — NOT "is the whole element
    // pure text," which refused any block that carried a single <em> or <br/>.
    const INTERACTIVE = "a[href], button, [role='button'], [role='link']";
    // Does this element carry at least one directly-editable run (a non-empty text node of its own)?
    // Only used to word the hover chip; the double-click resolves the exact run under the pointer.
    function hasEditableRun(el: Element): boolean {
      if (!el || el.nodeType !== 1 || OURS(el)) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
    }
    // The exact text node under the pointer (falls back to the target's first non-empty text child).
    function textNodeAtPoint(e: MouseEvent, t: Element): Text | null {
      let node: Node | null = null;
      const anyDoc = document as any;
      if (anyDoc.caretPositionFromPoint) {
        const cp = anyDoc.caretPositionFromPoint(e.clientX, e.clientY);
        if (cp && cp.offsetNode) node = cp.offsetNode;
      } else if (anyDoc.caretRangeFromPoint) {
        const r = anyDoc.caretRangeFromPoint(e.clientX, e.clientY);
        if (r) node = r.startContainer;
      }
      if (!node || node.nodeType !== 3)
        node = Array.from(t.childNodes).find((n) => n.nodeType === 3 && n.textContent!.trim()) ?? null;
      return node && node.nodeType === 3 && node.textContent!.trim() ? (node as Text) : null;
    }
    // Resolve the run the user aimed at: the text node, its nearest ELEMENT ancestor (whose call-site
    // the write-back needs), and whether that element holds ONLY this run (edit it in place) or the run
    // is a bare sibling of inline markup (wrap it just for the edit).
    function editableRunAt(e: MouseEvent, t: Element): { node: Text; host: HTMLElement; soleText: boolean; runText: string } | null {
      const node = textNodeAtPoint(e, t);
      if (!node) return null;
      const host = node.parentElement;
      if (!host || OURS(host)) return null;
      const soleText = Array.from(host.childNodes).every(
        (n) => n === node || (n.nodeType === 3 && !n.textContent!.trim()),
      );
      return { node, host, soleText, runText: node.textContent || "" };
    }
    let editingEl: HTMLElement | null = null;       // the contenteditable host (an element, or a temp wrap span)
    let editingSourceEl: HTMLElement | null = null; // the real element whose call-site the edit maps to
    let editingWrap: HTMLElement | null = null;     // a throwaway span we inserted to isolate a bare run (else null)
    let editingOriginal = "";

    // ---- floating edit result: pin the save ack / refusal reason to the words the human just
    // edited — where their eyes already are — instead of only in the panel footer, which is
    // easy to miss. Same overlay layer and visual language as the inspect hover chip. A refusal
    // lingers longer (there's a reason to read) and a save carries a one-click undo.
    let editToast: HTMLElement | null = null;
    let editToastTimer: ReturnType<typeof setTimeout> | null = null;
    function hideEditToast() {
      if (editToastTimer) { clearTimeout(editToastTimer); editToastTimer = null; }
      if (editToast) editToast.style.display = "none";
    }
    function showEditToast(el: HTMLElement, html: string, tone: "good" | "warn") {
      if (!editToast) { editToast = document.createElement("div"); overlay.appendChild(editToast); }
      const accent = tone === "good" ? "#E7FF3B" : "#FF6B57";
      editToast.style.cssText =
        `position:fixed;z-index:2147483647;max-width:320px;background:#100F0D;color:#F2EFE5;` +
        `font:11px ${MONO};letter-spacing:.02em;line-height:1.6;padding:9px 12px;border-radius:4px;` +
        `border:1px solid rgba(242,239,229,.18);border-left:3px solid ${accent};` +
        `box-shadow:0 12px 40px rgba(0,0,0,.5);pointer-events:auto;`;
      editToast.innerHTML = html;
      editToast.style.display = "block";
      // pin above the edited text; flip below if it would clip the top of the viewport
      const r = el.getBoundingClientRect();
      editToast.style.left = Math.max(8, Math.min(innerWidth - editToast.offsetWidth - 8, r.left)) + "px";
      let y = r.top - editToast.offsetHeight - 8;
      if (y < 8) y = Math.min(innerHeight - editToast.offsetHeight - 8, r.bottom + 8);
      editToast.style.top = y + "px";
      if (editToastTimer) clearTimeout(editToastTimer);
      editToastTimer = setTimeout(hideEditToast, tone === "good" ? 4200 : 9000);
    }
    async function runUndo() {
      hideEditToast();
      try {
        const u = await fetch(ENDPOINT + "/undo", { method: "POST" });
        if (u.ok) setStatus("Restored — byte-exact undo.", "good");
        else setStatus("Undo failed — npx font-lab-undo from the terminal.", "warn");
      } catch { setStatus("Endpoint offline — npx font-lab, then undo.", "warn"); }
    }
    const TOAST_UNDO = `<button class="fl-toast-undo" style="background:none;border:0;color:#E7FF3B;font:inherit;text-decoration:underline;cursor:pointer;padding:0;margin-left:6px">undo</button>`;

    const onDblClick = (e: MouseEvent) => {
      if (!state.expanded || editingEl) return;
      const t = e.target as Element | null;
      if (!t || OURS(t)) return;
      const run = editableRunAt(e, t);
      if (!run) return;
      // Words inside a link or button don't open the editor here on Chromium: alt-clicking a link
      // fires a browser default (follow/download the target) and suppressing it — which we must, so the
      // click doesn't navigate — also cancels the dblclick this handler waited on. Trapped text is
      // opened by onGuardedDown on the second mousedown instead; this branch stays as a harmless
      // fallback for engines that DO deliver the dblclick. Plain text still opens on a plain
      // double-click, and a plain (no-alt) double-click on trapped text is refused so inspect never
      // steals a navigation click.
      const trapped = run.host.closest(INTERACTIVE);
      if (trapped && !OURS(trapped) && !e.altKey) return;
      e.preventDefault();
      startEditRun(run);
    };
    document.addEventListener("dblclick", onDblClick, true);
    // Single clicks pass straight through to the site (inspect "never steals a click"). But when the
    // human alt/option-clicks text inside a link or button, they mean "let me edit these words," not
    // "navigate" — so swallow those clicks in the capture phase before the anchor navigates or the
    // React onClick fires. Keep swallowing even while editing: the editor may be mounted ON the link,
    // and an alt-click there must never fall through to navigation. Everything without alt, and
    // everything outside a link/button, is untouched.
    const onGuardedClick = (e: MouseEvent) => {
      if (!state.expanded || !e.altKey) return;
      const t = e.target as Element | null;
      if (!t || OURS(t)) return;
      const trapped = t.closest?.(INTERACTIVE);
      if (trapped && !OURS(trapped) && (t.textContent || "").trim()) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("click", onGuardedClick, true);
    document.addEventListener("auxclick", onGuardedClick, true);
    // The alt-double-click that opens trapped text: because suppressing the link's alt-click default
    // (above) also cancels its dblclick, ride the SECOND mousedown (detail === 2) — which fires
    // reliably even with the click default prevented — to open the run editor. Narrowly scoped: only
    // an expanded panel, alt held, a genuine double, and real text inside a link/button.
    const onGuardedDown = (e: MouseEvent) => {
      if (!state.expanded || editingEl || !e.altKey || e.detail < 2) return;
      const t = e.target as Element | null;
      if (!t || OURS(t)) return;
      const trapped = t.closest?.(INTERACTIVE);
      if (!trapped || OURS(trapped) || !(t.textContent || "").trim()) return;
      const run = editableRunAt(e, t);
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      startEditRun(run);
    };
    document.addEventListener("mousedown", onGuardedDown, true);
    function editKeys(e: KeyboardEvent) {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    }
    const onEditBlur = () => { void saveEdit(); };
    function startEditRun(run: { node: Text; host: HTMLElement; soleText: boolean; runText: string }) {
      inspectClear();
      hideEditToast();
      let editEl: HTMLElement;
      if (run.soleText) {
        // the run is the element's only content — edit it in place (the common leaf case)
        editEl = run.host;
        editingWrap = null;
      } else {
        // a bare run sitting beside inline markup (<em>, <br/>, a link) — wrap JUST this text node in a
        // throwaway span so contenteditable touches only these words, never the siblings. Unwrapped on end.
        const span = document.createElement("span");
        span.setAttribute("data-fl-edit-wrap", "");
        run.node.parentNode!.insertBefore(span, run.node);
        span.appendChild(run.node);
        editEl = span;
        editingWrap = span;
      }
      editingEl = editEl;
      editingSourceEl = run.host; // the call-site maps to the real element, never the temp span
      editingOriginal = run.runText;
      editEl.classList.add("__fl_editing");
      editEl.setAttribute("contenteditable", "plaintext-only");
      editEl.focus();
      // select the run so a retype replaces it cleanly
      try {
        const sel = getSelection();
        const r = document.createRange();
        r.selectNodeContents(editEl);
        sel?.removeAllRanges();
        sel?.addRange(r);
      } catch {}
      setStatus("Retype in place — ⏎ saves to source · esc cancels.");
      editEl.addEventListener("keydown", editKeys);
      editEl.addEventListener("blur", onEditBlur);
    }
    function endEdit(): { editEl: HTMLElement; sourceEl: HTMLElement; wrap: HTMLElement | null } | null {
      const editEl = editingEl;
      const sourceEl = editingSourceEl;
      const wrap = editingWrap;
      if (!editEl) return null;
      editEl.removeEventListener("keydown", editKeys);
      editEl.removeEventListener("blur", onEditBlur);
      editEl.removeAttribute("contenteditable");
      editEl.classList.remove("__fl_editing");
      editingEl = null;
      editingSourceEl = null;
      editingWrap = null;
      setTimeout(maintain, 300); // census catch-up: restamps were suspended while the caret was live
      return { editEl, sourceEl: sourceEl || editEl, wrap };
    }
    // Collapse a temporary edit-wrap span back to a plain text node once editing ends, so the page DOM
    // is left exactly as we found it (plus the retyped words). No-op for the in-place case.
    function unwrapEdit(wrap: HTMLElement | null) {
      if (!wrap || !wrap.parentNode) return;
      wrap.replaceWith(document.createTextNode(wrap.textContent || ""));
    }
    async function saveEdit() {
      const ctx = endEdit();
      if (!ctx) return;
      const { editEl, sourceEl, wrap } = ctx;
      const before = editingOriginal;
      const after = (editEl.textContent || "").replace(/\s+/g, " ").trim();
      if (after === before.replace(/\s+/g, " ").trim()) { unwrapEdit(wrap); setStatus(""); return; }
      invalidateScan();
      setStatus("Saving words to source…");
      // The temp wrap is about to be collapsed, so anchor every toast on the real element instead.
      const anchor = sourceEl;
      try {
        const res = await fetch(ENDPOINT + "/edit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // the call-site is the run's nearest element; oldText is the run's OWN words, so the endpoint
          // rewrites exactly that JsxText node and leaves any sibling <em>/<br/>/links untouched.
          body: JSON.stringify({ frame: callSite(sourceEl), oldText: before, newText: after }),
        });
        const j = await res.json().catch(() => ({}) as any);
        if (res.ok && j.ok) {
          unwrapEdit(wrap);
          setStatusHTML(`Saved ✓ <b>${esc(j.file)}:${esc(j.line)}</b> — words are in your source. <button class="linkish" id="undoEdit">undo</button>`, "good");
          shadow.getElementById("undoEdit")?.addEventListener("click", runUndo);
          showEditToast(anchor, `<b style="color:#E7FF3B;font-weight:600">Saved ✓</b> ${esc(j.file)}:${esc(j.line)}${TOAST_UNDO}`, "good");
          editToast?.querySelector(".fl-toast-undo")?.addEventListener("click", runUndo);
        } else {
          // Refused (dynamic text, duplicate phrase, unmappable) — revert the DOM so the page
          // never lies about what's in source, and say why, pinned to where the words snapped
          // back so the reason is impossible to miss.
          editEl.textContent = before;
          unwrapEdit(wrap);
          const why = j.error || `endpoint said ${res.status}`;
          setStatus(`Not saved — ${why}.`, "warn");
          // If the endpoint decided this edit can't be automated (data-driven text, or a phrase in
          // several files with no call site), it hands back a ready-to-paste instruction for a
          // coding agent. Offer a one-click copy so the human's next step is "paste to your agent,"
          // not a dead end.
          const agentPrompt: string = typeof j.agentPrompt === "string" ? j.agentPrompt : "";
          const handoff = agentPrompt
            ? `<br><button class="fl-toast-agent" style="background:none;border:0;color:#E7FF3B;font:inherit;text-decoration:underline;cursor:pointer;padding:0;margin-top:6px">Copy fix for your agent →</button>`
            : "";
          showEditToast(anchor, `<b style="color:#FF6B57;font-weight:600">Couldn't save</b><br><span style="color:rgba(242,239,229,.75)">${esc(why)}</span>${handoff}`, "warn");
          const agentBtn = agentPrompt ? editToast?.querySelector(".fl-toast-agent") : null;
          if (agentBtn) {
            agentBtn.addEventListener("click", async () => {
              try { await navigator.clipboard.writeText(agentPrompt); agentBtn.textContent = "Copied ✓ — paste it to your agent"; }
              catch { agentBtn.textContent = "Copy blocked — it's in the console"; console.log("[Font Lab] ask your agent:\n" + agentPrompt); }
            });
          }
        }
      } catch {
        editEl.textContent = before;
        unwrapEdit(wrap);
        setStatus("Endpoint offline — run npx font-lab, then retype.", "warn");
        showEditToast(anchor, `<b style="color:#FF6B57;font-weight:600">Couldn't save</b><br><span style="color:rgba(242,239,229,.75)">Endpoint offline — run <b>npx font-lab</b> in your site's folder, then retype.</span>`, "warn");
      }
    }
    function cancelEdit() {
      const ctx = endEdit();
      if (!ctx) return;
      ctx.editEl.textContent = editingOriginal;
      unwrapEdit(ctx.wrap);
      hideEditToast();
      setStatus("Edit cancelled — nothing written.");
    }

    // ---- build -------------------------------------------------------------------------
    function buildToc() {
      const toc = $("toc");
      toc.innerHTML = "";
      const rows = [{ id: "current", name: currentLabel(), vibe: "baseline", dir: null as Dir | null }]
        .concat(dirs.map((d) => ({ id: d.id, name: d.name, vibe: d.vibe, dir: d as Dir | null })));
      rows.forEach((r, i) => {
        const b = document.createElement("button");
        b.className = "toc-row";
        b.dataset.idx = String(i);
        b.dataset.flId = r.id;
        const nameStyle = r.dir
          ? `style="font-family:${r.dir.roles.display.stack.replace(/"/g, "'")}"`
          : `style="font-family:${MONO};font-size:11px;color:rgba(242,239,229,.7)"`;
        b.innerHTML = `<span class="folio">${String(i).padStart(2, "0")}</span><span class="tname" ${nameStyle}>${esc(r.name)}</span><span class="leader"></span><span class="vibe u">${esc(r.vibe)}</span>`;
        b.addEventListener("click", () => selectEntry(i));
        toc.appendChild(b);
      });
    }
    function buildSpread() {
      const wrap = $("spread");
      wrap.innerHTML = "";
      for (const role of ROLES) {
        const row = document.createElement("div");
        row.className = "row";
        row.dataset.role = role;
        row.innerHTML = `
          <div class="margin">${role[0].toUpperCase()}</div>
          <div class="mid">
            <div class="labline"><span class="u">${role}</span><span class="parity" hidden>≈</span><span class="wtag u" hidden title="This role has no live variable seam — the preview is real (painted on the rendered page), and on ship your agent wires the change into source (the pick carries the exact scope).">AGENT WIRES ON SHIP</span><span class="cov"></span></div>
            <div class="spec"><span class="fam" data-fl-fam="${role}"></span></div>
            <div class="tagline"></div>
          </div>
          <div class="right"><span class="pos"></span><span class="bkt" aria-hidden="true">[ ]</span><button class="step" data-fl-dec="${role}" aria-label="previous ${role} font">‹</button><button class="step" data-fl-inc="${role}" aria-label="next ${role} font">›</button></div>`;
        row.addEventListener("click", (e) => { if ((e.target as Element).closest(".step")) return; state.focus = role; render(); });
        row.addEventListener("mouseenter", () => { if (!xrayAll) { state.focus = role; setXray(role); render(); } });
        row.addEventListener("mouseleave", () => { if (!xrayAll) setXray(null); });
        row.querySelector(`[data-fl-dec="${role}"]`)!.addEventListener("click", (ev) => { ev.stopPropagation(); cycleRole(role, -1); });
        row.querySelector(`[data-fl-inc="${role}"]`)!.addEventListener("click", (ev) => { ev.stopPropagation(); cycleRole(role, +1); });
        wrap.appendChild(row);
      }
    }

    // ---- render ------------------------------------------------------------------------
    function render() {
      const eff = effSel();
      const cov = coverage();
      const id = activeId();
      root.setAttribute("data-fontlab-active", id);
      ($("aa") as HTMLElement).style.fontFamily = stackOf("display", state.sel) || "";
      const pres = $("presence");
      pres.dataset.conn = state.conn;
      $("presLabel").textContent = state.conn === "agent" ? "AGENT LISTENING" : state.conn === "ready" ? "ENDPOINT READY" : "OFFLINE · NPX FONT-LAB";
      pres.title = state.conn === "agent"
        ? "An agent is blocked on your pick — it ships the moment you choose."
        : state.conn === "ready"
          ? "Pick endpoint on :7777. Your pick saves the moment you make it."
          : "No pick endpoint on :7777 — run `npx font-lab` in your project.";
      $("inspectBtn").setAttribute("aria-pressed", String(state.inspect));
      const gd0 = matchedDir(state.sel);
      const gFol = onCurrent(state.sel) ? "00 Current" : gd0 ? `${String(dirs.indexOf(gd0) + 1).padStart(2, "0")} ${gd0.name}` : "mix — set by hand";
      const unsaved = !onCurrent(state.sel) && state.savedId !== pickIdOf(state.sel);
      $("collapsedInfo").innerHTML = `<span class="ciname">· ${esc(gFol)}</span>${unsaved ? '<span class="ciunsaved">● unsaved</span>' : ""}<span class="ciopen">· \` opens</span>`;

      const shownDirM = matchedDir(eff);
      const idx = onCurrent(eff) ? 0 : shownDirM ? dirs.indexOf(shownDirM) + 1 : -1;
      $("counter").innerHTML = (idx < 0 ? `<b>MIX</b>` : `<b>${String(idx).padStart(2, "0")}</b>`) + ` / ${String(dirs.length).padStart(2, "0")}`;
      shadow.querySelectorAll(".toc-row").forEach((r, i) => r.setAttribute("aria-current", String(i === idx)));
      updateTocCue();

      const sf = $("standfirst");
      if (state.beforeView) sf.textContent = `Before — ${trio(BEFORE_SEL)}. What ships today.`;
      else if (shownDirM) sf.textContent = shownDirM.rationale;
      else if (onCurrent(eff)) sf.textContent = "Flip to a direction (→) — every change is shown on your real page.";
      // save-mix's control IS this sentence — present exactly when there is a mix to save
      // (clicks are delegated on the container; this line is rewritten every render)
      else sf.innerHTML = `Set by hand — ${esc(trio(eff))}. <button class="savelink" data-fl-action="pin" title="S also saves it">save this mix as a direction</button>.`;

      for (const role of ROLES) {
        const row = shadow.querySelector(`.row[data-role="${role}"]`) as HTMLElement;
        const cand = candOf(role, eff);
        // Paint previews every role; "unwired" survives only as SHIP scope (badge, never a gate).
        const agentShips = !shipWired(role);
        row.dataset.focus = String(state.focus === role);
        const famEl = row.querySelector(".fam") as HTMLElement;
        famEl.textContent = famOf(role, eff);
        famEl.style.fontFamily = stackOf(role, eff) || "";
        const parityEl = row.querySelector(".parity") as HTMLElement;
        parityEl.hidden = !(cand && cand.parity !== "guaranteed");
        parityEl.title = "best-effort — may render slightly differently once shipped";
        parityEl.setAttribute("aria-label", "best-effort — may render slightly differently once shipped"); // title alone is invisible to keyboard/SR
        (row.querySelector(".wtag") as HTMLElement).hidden = !agentShips;
        if (!verdictActive) {
          const covEl = row.querySelector(".cov") as HTMLElement;
          covEl.dataset.verdict = "";
          const pct = cov.total ? Math.round((cov.chars.body / cov.total) * 100) : 0;
          covEl.textContent = role === "body" ? `${pct}% of page text`
            : `${cov.count[role]} spot${cov.count[role] === 1 ? "" : "s"} on page`;
          // a zero is pinned always-visible — an invisible pick is exactly what must never hide
          covEl.dataset.pin = String(role === "body" ? pct === 0 : cov.count[role] === 0);
        }
        (row.querySelector(".tagline") as HTMLElement).textContent =
          cand?.tag ? cand.tag + "." : agentShips ? "previews live · no auto-ship seam — your agent wires it." : "";
        const n = CANDS[role].length;
        (row.querySelector(".pos") as HTMLElement).textContent =
          "font " + (eff[role] < 0 ? `—/${String(n).padStart(2, "0")}` : `${String(eff[role] + 1).padStart(2, "0")}/${String(n).padStart(2, "0")}`);
        row.querySelectorAll(".step").forEach((b) => ((b as HTMLButtonElement).disabled = state.beforeView));
      }

      // ≈ honesty: no separate band (it restated the chip, then auto-faded — a caution that
      // times out is a caution that can be missed). The chip on the row is permanent; the full
      // sentence lands in the status line once per face, at first encounter.
      if (workingParity(eff) === "best-effort" && !onCurrent(eff) && !state.beforeView) {
        const fresh = ROLES.map((r) => candOf(r, eff))
          .filter((c): c is Cand => !!c && c.parity !== "guaranteed")
          .map((c) => c.family).filter((f) => !fidSaid.has(f));
        if (fresh.length) {
          fresh.forEach((f) => fidSaid.add(f));
          setStatus(`≈ close preview — ${fresh.join(", ")} may differ slightly once shipped.`, "warn");
        }
      }

      const pick = $<HTMLButtonElement>("pick"), pl = $("pickLabel");
      const pickable = !state.beforeView && !onCurrent(eff);
      const savedIsShown = state.savedId !== null && state.savedId === pickIdOf(eff);
      if (savedIsShown && state.shipped?.current) {
        pick.dataset.state = "shipped"; pl.textContent = "SHIPPED"; pick.disabled = true;
      } else if (state.saving) {
        pick.dataset.state = "idle"; pl.textContent = "SAVING…"; pick.disabled = true;
      } else if (savedIsShown) {
        pick.dataset.state = "picked"; pl.textContent = "PICKED"; pick.disabled = false; // re-pick is a harmless no-op save
      } else {
        pick.dataset.state = "idle"; pick.dataset.just = "false"; pl.textContent = "PICK";
        pick.disabled = !pickable;
        if (!pickable && !state.saving && !editingEl)
          guardStatus(state.beforeView ? "Viewing before — flip back to pick." : "On current — nothing to pick.");
      }
      $("beforeTog").setAttribute("aria-pressed", String(state.beforeView));
      refreshChip();
      persist();
    }
    const pickIdOf = (sel: Record<Role, number>) => (onCurrent(sel) ? "current" : matchedDir(sel)?.id ?? "mixed");

    function persist() {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({
          cursorId: state.cursor === 0 ? "current" : dirs[state.cursor - 1]?.id,
          roles: { display: candOf("display")?.family ?? null, body: candOf("body")?.family ?? null, mono: candOf("mono")?.family ?? null },
        }));
      } catch {}
    }

    // ---- interactions --------------------------------------------------------------------
    function rememberView() { state.lastView = { sel: { ...state.sel }, cursor: state.cursor }; }
    function selectEntry(i: number, opts: { keepStatus?: boolean } = {}) {
      const prev = { ...effSel() };
      const target2 = Math.max(0, Math.min(i, dirs.length));
      if (target2 !== state.cursor || matchedDir(state.sel) === null) rememberView();
      state.beforeView = false;
      if (target2 <= 0) state.sel = { display: -1, body: -1, mono: -1 };
      else {
        const d = dirs[target2 - 1];
        for (const role of ROLES) state.sel[role] = Math.max(0, CANDS[role].findIndex((c) => c.family === d.roles[role].family));
      }
      state.cursor = target2;
      if (!opts.keepStatus) setStatus("");
      applyToPage(prev, state.sel);
      render();
      const active = shadow.querySelector(`.toc-row[data-idx="${target2}"]`);
      if (active) active.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
    }
    function cycleRole(role: Role, d: number) {
      if (state.beforeView) state.beforeView = false;
      state.focus = role;
      if (onCurrent(state.sel)) { selectEntry(1); return; }
      const prev = { ...state.sel };
      const n = CANDS[role].length;
      state.sel[role] = ((state.sel[role] < 0 ? 0 : state.sel[role]) + d + n) % n;
      setStatus("");
      applyToPage(prev, state.sel);
      render();
    }
    function moveFocus(d: number) {
      state.focus = ROLES[(ROLES.indexOf(state.focus) + d + 3) % 3];
      pulseXray(state.focus);
      render();
    }
    function snapBack() {
      if (!state.lastView) { setStatus("Nothing to snap back to yet — view another direction first."); return; }
      const prevEff = { ...effSel() };
      const to = state.lastView;
      state.lastView = { sel: { ...state.sel }, cursor: state.cursor };
      state.sel = { ...to.sel };
      state.cursor = to.cursor;
      state.beforeView = false;
      applyToPage(prevEff, state.sel);
      const d = matchedDir(state.sel);
      setStatus(`Snapped back to ${d ? d.name : onCurrent(state.sel) ? "Current" : "your mix"} — space returns.`);
      render();
    }
    function toggleBefore() {
      const prevEff = { ...effSel() };
      state.beforeView = !state.beforeView;
      applyToPage(prevEff, effSel());
      if (state.beforeView) {
        setStatus(`Before — ${trio(BEFORE_SEL)}. B returns.`);
        const r0 = shadow.querySelector('.toc-row[data-idx="0"]');
        if (r0) r0.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
      } else setStatus("");
      render();
    }
    function saveMix() {
      if (state.beforeView || onCurrent(state.sel) || matchedDir(state.sel)) {
        setStatus("Nothing to save — mix a set by hand first ([ ] flips a font).");
        return;
      }
      state.mixCount++;
      const name = `Mix ${String(state.mixCount).padStart(2, "0")}`;
      const roles = {} as Record<Role, Cand>;
      for (const role of ROLES) roles[role] = { ...CANDS[role][Math.max(0, state.sel[role])] };
      dirs = dirs.concat([{ id: `mix-${state.mixCount}`, name, vibe: "your mix", rationale: `Set by hand — ${trio()}.`, roles }]);
      buildToc();
      state.cursor = dirs.length;
      setStatus(`Saved as direction ${String(dirs.length).padStart(2, "0")} — it's in the list now.`, "good");
      render();
      const newRow = shadow.querySelector(`.toc-row[data-idx="${dirs.length}"]`);
      if (newRow) newRow.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
    }
    let bDownAt = 0, bHeld = false;
    const bDown = () => { if (bHeld) return; bHeld = true; bDownAt = performance.now(); toggleBefore(); };
    const bUp = () => { if (!bHeld) return; bHeld = false; if (performance.now() - bDownAt > 400) toggleBefore(); };

    async function doPick() {
      const eff = effSel();
      if (state.beforeView || onCurrent(eff)) { guardStatus(state.beforeView ? "Viewing before — flip back to pick." : "Flip to a direction first."); return; }
      const roleObj = (role: Role) => {
        const c = candOf(role, eff);
        return c
          ? { family: c.family, source: c.source, parity: c.parity, weights: c.weights }
          : { family: replaces?.[role] ?? null, source: "current", weights: [] as number[] };
      };
      const md = matchedDir(eff);
      const fams = ROLES.map((r) => roleObj(r).family);
      const direction = md
        ? { id: md.id, name: md.name, vibe: md.vibe, rationale: md.rationale }
        : { id: "mixed", name: "Mixed", vibe: "mixed", rationale: `Custom pairing — ${fams.filter(Boolean).join(" / ")}.` };
      // Ship scope, declared AT PICK TIME (never a surprise in a receipt): the census names every
      // cluster this direction touches — with provenance — and which roles have an auto-ship seam
      // vs. need the agent. The shipping agent reads this instead of re-deriving the site.
      const fc = flc();
      const census = fc && censusDone ? fc.report() : [];
      const scope = ROLES.map((r) => {
        const clusters = census.filter((c: { voice: string }) => c.voice === VOICE[r]);
        return {
          role: r,
          voice: VOICE[r],
          target: roleObj(r).family,
          rendersToday: renderedCurrent[r]?.family ?? null,
          declaredInSource: replaces?.[r] ?? null,
          autoShipSeam: shipWired(r) ? wir[r] : null, // null → the agent wires this role into source
          clusters,
          // islands: text this direction should reach that global wiring can't (inline styles /
          // route-scoped fonts) — each needs either an agent edit or an explicit "keep it" call.
          islands: clusters.filter((c: { prov: string }) => c.prov !== "css@global"),
        };
      });
      const selection = {
        version: 1,
        pickedAt: new Date().toISOString(),
        direction,
        roles: { display: roleObj("display"), body: roleObj("body"), mono: roleObj("mono") },
        replaces,
        target,
        preview: { mechanism: "cluster-paint", route: location.pathname, census, scope },
      };
      state.saving = true;
      render();
      try {
        const res = await fetch(ENDPOINT + "/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection) });
        state.saving = false;
        if (!res.ok) { setStatus(`Endpoint error ${res.status} — try again.`, "warn"); render(); return; }
        let ack: { agentWaiting?: boolean; autoApply?: boolean } = {};
        try { ack = await res.json(); } catch {}
        state.savedId = md ? md.id : "mixed";
        state.shipped = null;
        root.setAttribute("data-fontlab-picked", direction.id);
        $("pick").dataset.just = "true"; // one checkmark draw, then settle
        if (ack.autoApply) setStatus(`Saved — shipping “${direction.name}” now…`, "good");
        else if (ack.agentWaiting) setStatus(`Sent to your agent ✓ — “${direction.name}” ships from here.`, "good");
        else {
          // Unarmed is the NORMAL case, not a failure: the pick is durable and piggybacks on the
          // agent's next Font Lab call — say so, and hand the human the exact words that trigger it.
          setStatusHTML(
            `Saved ✓ — your agent will see “${esc(direction.name)}” on its next Font Lab call, or just say <button class="linkish" id="pickCopy">“apply my font pick”</button>`,
            "good",
          );
          shadow.getElementById("pickCopy")?.addEventListener("click", async () => {
            const btn = shadow.getElementById("pickCopy");
            if (!btn) return;
            try { await navigator.clipboard.writeText("apply my font pick"); btn.textContent = "Copied ✓"; }
            catch { btn.textContent = "“apply my font pick”"; }
          });
        }
        render();
      } catch {
        state.saving = false;
        setStatus("Endpoint offline — run `npx font-lab`, then Pick again.", "warn");
        render();
      }
    }

    // ---- "more options" — the in-panel demand channel ------------------------------------
    // The human didn't like what's on the menu (or they're on the seeded STARTER menu and want
    // ones tailored to them). They tell Font Lab what they're after; we hand that mini-brief to a
    // listening agent (which composes fresh directions and appends them live). If NO agent is
    // listening, we say so honestly and give a ready-to-paste prompt as the off-ramp — the ask is
    // saved either way, so an agent that connects later still fulfills it.
    function setupMore() {
      const sheet = $("moreSheet"), trigger = $("moreTrigger"), ack = $("moreAck");
      const openSheet = (open: boolean) => {
        sheet.hidden = !open;
        trigger.textContent = open ? "Never mind — hide this" : "None of these? Tell Font Lab what you want →";
        if (open) sheet.scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" });
      };
      trigger.addEventListener("click", () => openSheet(sheet.hidden));
      $("moreCancel").addEventListener("click", () => { openSheet(false); ack.hidden = true; });
      // Chip toggle. A question marked data-multi keeps every pressed chip — the human can want
      // "technical AND minimal" — while the rest stay single-select (a new press clears the group).
      shadow.querySelectorAll<HTMLElement>(".more-q[data-q] .more-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const on = chip.getAttribute("aria-pressed") === "true";
          const group = chip.closest(".more-q") as HTMLElement;
          if (group.dataset.multi !== "true")
            group.querySelectorAll(".more-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
          chip.setAttribute("aria-pressed", String(!on));
        });
      });
      // A chip's value is its rich data-v phrase ("technical & precise") — the vocabulary the design
      // brief speaks — falling back to its short label. Multi-select questions yield every pressed value.
      const chipValue = (c: Element) => (c as HTMLElement).dataset.v?.trim() || (c as HTMLElement).textContent?.trim() || "";
      const chosenAll = (q: string): string[] =>
        [...shadow.querySelectorAll(`.more-q[data-q="${q}"] .more-chip[aria-pressed="true"]`)].map(chipValue).filter(Boolean);
      const chosenOne = (q: string): string => chosenAll(q)[0] || "";
      const gatherBrief = () => ({
        feeling: chosenAll("feeling"),      // multi-select — one or more vibes to combine
        departure: chosenOne("departure"),  // single-select
        brand: ($("moreBrand") as HTMLTextAreaElement).value.trim(),
        note: ($("moreNote") as HTMLTextAreaElement).value.trim(),
      });
      const excludeFamilies = () => [...new Set(dirs.flatMap((d) => ROLES.map((r) => d.roles[r].family)))];

      // The paste-to-your-agent off-ramp: a self-contained instruction with the brief filled in.
      // feeling arrives as an array (multi-select) — join it, and treat an empty array as "unset".
      const agentPrompt = (brief: Record<string, string | string[]>, exclude: string[]) => {
        const has = (v: string | string[]) => (Array.isArray(v) ? v.length > 0 : !!v);
        const fmt = (v: string | string[]) => (Array.isArray(v) ? v.join(", ") : v);
        const lines = Object.entries(brief).filter(([, v]) => has(v)).map(([k, v]) => `  ${k}: ${fmt(v)}`);
        return [
          "In this project (the one running the Font Lab dev panel), the human wants MORE font options —",
          "they didn't pick from the current menu. What they're going for:",
          lines.length ? lines.join("\n") : "  (no specifics given — surprise them, but keep it tasteful and distinctive)",
          "",
          `Compose fresh directions that AVOID these already-shown families: ${exclude.join(", ") || "(none)"}.`,
          "Reach past the overexposed defaults (Inter, Geist, Space Grotesk, …). Then append them to the live",
          "panel: call font_lab_compose_directions, then font_lab_more_directions. The human still makes the final pick.",
        ].join("\n");
      };

      const setAck = (html: string, tone: "" | "good" | "warn" = "") => { ack.hidden = false; ack.dataset.tone = tone; ack.innerHTML = html; };
      const wireCopy = (brief: Record<string, string | string[]>, exclude: string[]) => {
        shadow.getElementById("moreCopy")?.addEventListener("click", async () => {
          const text = agentPrompt(brief, exclude);
          const btn = shadow.getElementById("moreCopy")!;
          try { await navigator.clipboard.writeText(text); btn.textContent = "Copied ✓ — paste it to your agent"; }
          catch { btn.textContent = "Copy blocked — it's in the console"; console.log("[Font Lab] ask your agent:\n" + text); }
        });
      };
      // Same delivery semantics as a pick: the ask is durable and rides the agent's next Font Lab
      // call — the copy must read as a designed handoff, not a failure. The header varies because
      // only one path (endpoint down) actually failed to save.
      const showOfframp = (
        brief: Record<string, string | string[]>,
        exclude: string[],
        head = `<b>Saved for your agent ✓</b> — none is connected right now, so nothing composes these instantly; your agent sees the request on its next Font Lab call. Faster paths:`,
      ) => {
        setAck(
          head +
            `<span class="offramp">1 · <button class="linkish" id="moreCopy">Copy a prompt for your agent →</button> then paste it into Cursor / Claude Code / your agent.</span>` +
            `<span class="offramp">2 · Have your agent listen live: <code>npx font-lab serve --once</code> in the background (or <code>font_lab_wait</code>), then click Get more again.</span>`,
          "warn",
        );
        wireCopy(brief, exclude);
      };
      const showSelfServe = (brief: Record<string, string | string[]>, exclude: string[]) => {
        setAck(
          `<b>No agent connected</b> — Font Lab is adding options from its own catalog, tuned to your answers. They'll appear here shortly. Your agent will also see this request on its next Font Lab call.` +
            `<span class="offramp">These aren't agent-composed — for options tailored to your full brief: <button class="linkish" id="moreCopy">Copy a prompt for your agent →</button></span>`,
          "good",
        );
        wireCopy(brief, exclude);
      };

      $("moreSend").addEventListener("click", async () => {
        const brief = gatherBrief();
        const exclude = excludeFamilies();
        setAck("Sending…");
        try {
          const res = await fetch(ENDPOINT + "/request", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ brief, exclude }),
          });
          const j = await res.json().catch(() => ({}) as any);
          if (!res.ok || !j.ok) { setAck(`Couldn't send — ${esc(j.error || res.status)}.`, "warn"); return; }
          if (j.agentWaiting) setAck("<b>Sent to your agent ✓</b> — new options will appear here in a moment.", "good");
          else if (j.selfServe) showSelfServe(brief, exclude);
          else showOfframp(brief, exclude);
        } catch {
          // endpoint down entirely — the ask was NOT saved; say so, and still give the off-ramp
          showOfframp(brief, excludeFamilies(),
            `<b>Endpoint offline</b> — this request was NOT saved. Run <code>npx font-lab</code> in your site's folder, then send again. Meanwhile:`);
        }
      });
    }

    // ---- live handoff state (SSE) --------------------------------------------------------
    const setConn = (next: Conn) => { if (state.conn === next) return; state.conn = next; render(); };
    const ver = (v: string) => String(v || "").replace(/[^0-9A-Za-z.\-]/g, "");
    const checkVersion = (running: string, installed?: string) => {
      // Two distinct drifts, same notice slot: the endpoint outran this panel (re-init), or the
      // package on disk outran the running endpoint (npm install doesn't restart :7777).
      const stalePanel = isRealVersion(PANEL_VERSION) && isRealVersion(running) && cmpVersions(running, PANEL_VERSION) > 0;
      const staleEndpoint = isRealVersion(running) && isRealVersion(installed || "") && cmpVersions(installed!, running) > 0;
      $("notice").dataset.show = String(stalePanel || staleEndpoint);
      if (staleEndpoint) {
        $("noticeHead").innerHTML = `ENDPOINT OUTDATED — <code>${ver(running)}</code> RUNNING · <code>${ver(installed!)}</code> INSTALLED`;
        $("noticeBody").innerHTML = `The :7777 endpoint predates the installed package. Restart it: <code>npx font-lab</code>.`;
      } else if (stalePanel) {
        $("noticeHead").innerHTML = `STALE PANEL — <code>${ver(PANEL_VERSION)}</code> SET · <code>${ver(running)}</code> RUNNING`;
        $("noticeBody").innerHTML = `This panel was set by an older version. Re-run <code>font_lab_init</code> to refresh it.`;
      }
    };
    let es: EventSource | null = null;
    const handleStatus = (s: any) => {
      if (s.version) checkVersion(s.version, s.installed);
      setConn(s.agentWaiting ? "agent" : "ready");
      if (s.selection?.direction?.id && !state.savedId) state.savedId = s.selection.direction.id; // survive reloads
      state.shipped = s.applied ? { current: !!s.applied.current } : null;
      if (state.shipped?.current && state.savedId) {
        setStatus(
          workingParity(state.sel) === "guaranteed"
            ? "Shipped ✓ — what you previewed is exactly what shipped. Undo: npx font-lab-undo"
            : "Shipped ✓ — best-effort fonts may differ slightly. Undo: npx font-lab-undo",
          "good",
        );
      }
      render();
    };
    try {
      // The origin identifies the dev server this panel is served from — the endpoint records it
      // so font_lab_status can health-check the dev server (and verify can default its baseUrl).
      es = new EventSource(ENDPOINT + "/events?origin=" + encodeURIComponent(location.origin));
      es.addEventListener("status", (ev) => { try { handleStatus(JSON.parse((ev as MessageEvent).data)); } catch {} });
      es.addEventListener("applied", () => { handleStatus({ agentWaiting: state.conn === "agent", applied: { current: true }, selection: null }); });
      es.onerror = () => setConn("offline"); // EventSource auto-reconnects; we just narrate
    } catch { setConn("offline"); }

    // ---- keyboard — captured only while expanded; suspended while retyping ---------------
    // The panel lives in a shadow root, so a document-level listener sees e.target RETARGETED to the
    // host element — never the <input>/<textarea> the human is actually typing in (the brand/note
    // fields). composedPath()[0] is the true innermost target across the shadow boundary; without it
    // our single-key shortcuts (space = snap back, s = save, b = before, …) eat characters mid-typing.
    const typingInField = (e: Event) => {
      const t = (e.composedPath()[0] as HTMLElement | null) ?? (e.target as HTMLElement | null);
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e)) return;
      if (!state.expanded) { if (e.key === "`") { toggleCollapsed(); e.preventDefault(); } return; }
      const k = e.key;
      // while the back page is up, the first key just flips it back — nothing else. It appeared
      // on its own (first run), so dismiss-first is safest: no accidental pick, no accidental
      // direction jump from a key the reader pressed only to get rid of the reference.
      if (state.keysOpen) { e.preventDefault(); setKeys(false); return; }
      if (k === "ArrowRight") { e.preventDefault(); selectEntry(Math.min(state.cursor + 1, dirs.length)); }
      else if (k === "ArrowLeft") { e.preventDefault(); selectEntry(Math.max(state.cursor - 1, 0)); }
      else if (k === "ArrowDown") { e.preventDefault(); moveFocus(1); }
      else if (k === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
      else if (k === "]") { e.preventDefault(); cycleRole(hoverHit ? hoverHit.role : state.focus, 1); }
      else if (k === "[") { e.preventDefault(); cycleRole(hoverHit ? hoverHit.role : state.focus, -1); }
      else if (k === "b" || k === "B") { e.preventDefault(); if (!e.repeat) bDown(); }
      else if (k === " ") { e.preventDefault(); snapBack(); }
      else if (k === "s" || k === "S") { e.preventDefault(); saveMix(); }
      else if (k === "X" && e.shiftKey) { e.preventDefault(); xrayAll ? setXray(null, false) : setXray(state.focus, true); }
      else if (k === "x") { e.preventDefault(); toggleInspect(); }
      else if (k === "j" || k === "J") { e.preventDefault(); jumpNearest(state.focus); }
      else if (k === "?") { e.preventDefault(); setKeys(true); } // (keysOpen handled above)
      else if (k === "Escape" && xrayAll) { e.preventDefault(); setXray(null, false); }
      else if (k === "Enter") { e.preventDefault(); void doPick(); }
      else if (k === "`") { e.preventDefault(); toggleCollapsed(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (typingInField(e)) return; if (e.key === "b" || e.key === "B") bUp(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);

    function toggleInspect() {
      state.inspect = !state.inspect;
      if (!state.inspect) inspectClear();
      setStatus(state.inspect ? "Inspect on — hover the page to identify text." : "Inspect off — X turns it back on.");
      render();
    }
    // the back page — full key reference; open/closed is plain visible state
    function setKeys(open: boolean) {
      state.keysOpen = open;
      $("keys").dataset.open = String(open);
      $("keysDoor").setAttribute("aria-expanded", String(open));
    }
    function toggleCollapsed() {
      state.expanded = !state.expanded;
      slip.dataset.collapsed = String(!state.expanded);
      if (!state.expanded) { inspectClear(); setXray(null, false); setKeys(false); }
      render();
    }
    $("dogear").addEventListener("click", toggleCollapsed);
    (shadow.querySelector(".mast") as HTMLElement).addEventListener("click", (e) => {
      if (!state.expanded && !(e.target as Element).closest(".inspect-btn")) toggleCollapsed();
    });
    $("inspectBtn").addEventListener("click", toggleInspect);
    $("pick").addEventListener("click", () => void doPick());
    $("beforeTog").addEventListener("click", toggleBefore);
    $("keysDoor").addEventListener("click", () => setKeys(!state.keysOpen));
    // the back page is reference, not controls — a click anywhere on it flips it back over,
    // so a first-run reader is never stuck hunting for the keyboard. "Got it" is the same act,
    // made visible; both routes (and esc / ?) land in setKeys(false).
    $("keys").addEventListener("click", () => setKeys(false));
    // the save-mix link lives inside the standfirst, which render() rewrites — delegate the
    // click to the container so the handler survives every rewrite
    $("standfirst").addEventListener("click", (e) => {
      if ((e.target as Element).closest('[data-fl-action="pin"]')) saveMix();
    });
    $("toc").addEventListener("scroll", updateTocCue);
    $("tocCue").addEventListener("click", () => { $("toc").scrollBy({ top: 74, behavior: REDUCED ? "auto" : "smooth" }); });
    setupMore();
    const onResize = () => invalidateScan();
    addEventListener("resize", onResize);

    // ---- boot -------------------------------------------------------------------------
    buildToc();
    buildSpread();
    let restored = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.roles && ROLES.some((role) => saved.roles[role])) {
        for (const role of ROLES) {
          const idx = saved.roles[role] ? CANDS[role].findIndex((c) => c.family === saved.roles[role]) : -1;
          state.sel[role] = idx;
        }
        const ci = saved.cursorId === "current" ? 0 : dirs.findIndex((d) => d.id === saved.cursorId) + 1;
        state.cursor = Math.max(0, ci);
        restored = true;
      }
    } catch {}
    if (restored) { applyToPage(null, state.sel, { silent: true }); render(); }
    else { applyToPage(null, state.sel, { silent: true }); render(); } // land on Current; ← → flips
    setStatus("");
    // First run only: show the back page once, so every key is seen before it rests folded.
    // Skipped under automation (webdriver) so headless captures stay clean.
    try {
      if (!localStorage.getItem("fontlab.keysSeen.v1") && !navigator.webdriver) {
        localStorage.setItem("fontlab.keysSeen.v1", "1");
        setKeys(true);
      }
    } catch {}

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", inspectMove, true);
      document.removeEventListener("dblclick", onDblClick, true);
      document.removeEventListener("click", onGuardedClick, true);
      document.removeEventListener("auxclick", onGuardedClick, true);
      document.removeEventListener("mousedown", onGuardedDown, true);
      const inFlight = endEdit(); // if we unmount mid-edit, restore the DOM to exactly as found
      if (inFlight) unwrapEdit(inFlight.wrap);
      removeEventListener("resize", onResize);
      mo.disconnect();
      es?.close();
      // leave the page exactly as found: clear the paint stylesheet and strip census stamps
      flc()?.clearPaint();
      document.getElementById("__fl_paint")?.remove();
      document.querySelectorAll("[data-flc],[data-flv]").forEach((el) => {
        el.removeAttribute("data-flc");
        el.removeAttribute("data-flv");
      });
      for (const { el } of scanCache ?? []) el.classList.remove("__fl_hit", "__fl_other", "__fl_hover", "__fl_flash", "__fl_flash_soft", "__fl_spot");
      overlay.remove();
      host.remove();
    };
  }, []);

  return null;
}
