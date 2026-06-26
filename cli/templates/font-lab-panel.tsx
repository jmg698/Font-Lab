"use client";

// Font Lab dev panel — portable build, installed by `font-lab init` into a real project.
// Identical UX to the fixture panel (presets, mixed picks, before/after, pin, multi-route),
// but it applies the swap through the analyzer's `wiring`: for each role it overrides the
// project's OWN leaf next/font variable (e.g. --font-bricolage) on the element next/font uses
// (<html> or <body>). That's what makes the live preview honest on any site — it moves the
// exact variable that ship rewrites. A role with no wiring (a font the site doesn't route
// through a variable) is shown as not-previewable rather than faked.
//
// Dev-only (mounted behind a NODE_ENV guard in layout). Shadow-DOM isolated.

import { useEffect } from "react";
import { catalogFontFaceCss, directions, replaces, target, wiring, type Direction } from "./catalog.generated";

const ENDPOINT = "http://localhost:7777";
const STORE_KEY = "fontlab.working.v1";
const ROLES = ["display", "body", "mono"] as const;
type Role = (typeof ROLES)[number];
const LABEL: Record<Role, string> = { display: "Display", body: "Body", mono: "Mono" };

type Cand = { family: string; stack: string; weights: number[] };
const wir = (wiring || {}) as Partial<Record<Role, { var: string; el: string } | null>>;

function candidatesFor(role: Role): Cand[] {
  const seen = new Set<string>();
  const out: Cand[] = [];
  for (const d of directions) {
    const r = d.roles[role];
    if (!seen.has(r.family)) {
      seen.add(r.family);
      out.push({ family: r.family, stack: r.stack, weights: r.weights });
    }
  }
  return out;
}
function currentLabel(): string {
  const fams = [replaces?.display, replaces?.body].filter(Boolean) as string[];
  const uniq = [...new Set(fams)];
  return uniq.length ? `Current — ${uniq.join(" / ")}` : "Current";
}

export function FontLabDevPanel() {
  useEffect(() => {
    const root = document.documentElement;
    const CANDS: Record<Role, Cand[]> = { display: candidatesFor("display"), body: candidatesFor("body"), mono: candidatesFor("mono") };
    const elFor = (role: Role) => (wir[role]?.el === "body" ? document.body : document.documentElement);
    const canSwap = (role: Role) => !!wir[role];

    const FACE_ID = "fontlab-catalog-faces";
    if (!document.getElementById(FACE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = FACE_ID;
      styleEl.textContent = catalogFontFaceCss;
      document.head.appendChild(styleEl);
    }

    const entries = [{ id: "current", dir: null as Direction | null }, ...directions.map((d) => ({ id: d.id, dir: d }))];
    const roleSel: Record<Role, number> = { display: -1, body: -1, mono: -1 };
    let cursor = 0;
    let focus: Role = "display";
    let comparing = false;
    const pins: (Record<Role, number> | null)[] = [null, null];
    let showingPin: 0 | 1 | null = null;

    const setRolesFromEntry = (i: number) => {
      const e = entries[i];
      for (const role of ROLES) {
        if (!e.dir) roleSel[role] = -1;
        else roleSel[role] = Math.max(0, CANDS[role].findIndex((c) => c.family === e.dir!.roles[role].family));
      }
    };

    let restored = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.roles && ROLES.some((role) => saved.roles[role])) {
        for (const role of ROLES) {
          const idx = saved.roles[role] ? CANDS[role].findIndex((c) => c.family === saved.roles[role]) : -1;
          roleSel[role] = idx;
        }
        cursor = Math.max(0, entries.findIndex((e) => e.id === saved.cursorId));
        restored = true;
      }
    } catch {}

    const host = document.createElement("div");
    host.id = "fontlab-panel-host";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { font-family: ui-sans-serif, system-ui, sans-serif; background:#111114; color:#fff; border-radius:14px; padding:14px; width:288px; box-shadow:0 12px 40px rgba(0,0,0,.45); }
        .title { font-size:11px; letter-spacing:.12em; text-transform:uppercase; opacity:.55; margin-bottom:9px; }
        .chips { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:10px; }
        .chip { padding:5px 8px; border:0; border-radius:7px; background:#27272a; color:#fff; font-size:11.5px; cursor:pointer; }
        .chip[aria-pressed="true"] { background:#2563eb; }
        .chip.cur[aria-pressed="true"] { background:#3f3f46; }
        .roles { display:flex; flex-direction:column; gap:4px; margin-bottom:9px; }
        .role { display:flex; align-items:center; gap:6px; background:#1c1c20; border-radius:8px; padding:4px 6px; }
        .role[data-focus="true"] { outline:2px solid #2563eb; }
        .role[data-off="true"] { opacity:.45; }
        .role .lab { font-size:10px; text-transform:uppercase; letter-spacing:.08em; opacity:.5; width:48px; }
        .role .fam { flex:1; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .role button { border:0; background:#3f3f46; color:#fff; border-radius:6px; width:22px; height:22px; cursor:pointer; font-size:13px; line-height:1; }
        .role button:disabled { opacity:.3; cursor:not-allowed; }
        .rationale { font-size:11px; line-height:1.4; opacity:.7; min-height:30px; margin:2px 2px 9px; }
        .row { display:flex; gap:6px; align-items:center; }
        .pick { flex:1; padding:9px 11px; border:0; border-radius:9px; background:#16a34a; color:#fff; font-size:13px; font-weight:600; cursor:pointer; }
        .pick[disabled] { background:#3f3f46; color:#a1a1aa; cursor:not-allowed; }
        .mini { padding:9px 9px; border:0; border-radius:9px; background:#27272a; color:#fff; font-size:12px; cursor:pointer; white-space:nowrap; }
        .mini[aria-pressed="true"] { background:#a16207; }
        .status { font-size:11px; opacity:.75; margin-top:8px; min-height:14px; }
        .hint { font-size:9.5px; opacity:.4; margin-top:6px; line-height:1.5; }
        kbd { background:#27272a; border-radius:3px; padding:0 3px; font-size:9px; }
      </style>
      <div class="panel" role="group" aria-label="Font Lab">
        <div class="title">Font Lab · build your type</div>
        <div class="chips" id="chips"></div>
        <div class="roles" id="roles"></div>
        <div class="rationale" id="rationale"></div>
        <div class="row">
          <button class="pick" data-fl-action="pick">Pick</button>
          <button class="mini" data-fl-action="compare" title="Before / after (B)">⇄</button>
          <button class="mini" data-fl-action="pin" title="Pin to compare (P)">📌</button>
        </div>
        <div class="status" id="status"></div>
        <div class="hint"><kbd>← →</kbd> direction · <kbd>↑↓</kbd> role · <kbd>[ ]</kbd> swap · <kbd>B</kbd> before/after · <kbd>P</kbd>/<kbd>Space</kbd> pin · <kbd>↵</kbd> pick</div>
      </div>`;

    const chipsEl = shadow.getElementById("chips")!;
    const rolesEl = shadow.getElementById("roles")!;
    const rationaleEl = shadow.getElementById("rationale")!;
    const statusEl = shadow.getElementById("status")!;
    const pickBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="pick"]')!;
    const cmpBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="compare"]')!;
    const pinBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="pin"]')!;

    entries.forEach((e, i) => {
      const b = document.createElement("button");
      b.className = "chip" + (e.dir ? "" : " cur");
      b.dataset.flId = e.id;
      b.textContent = e.dir ? e.dir.name : "Current";
      b.addEventListener("click", () => selectPreset(i));
      chipsEl.appendChild(b);
    });

    const roleFamEls: Record<Role, HTMLElement> = {} as any;
    const roleRowEls: Record<Role, HTMLElement> = {} as any;
    for (const role of ROLES) {
      const row = document.createElement("div");
      row.className = "role";
      row.dataset.role = role;
      row.dataset.off = String(!canSwap(role));
      row.innerHTML = `<span class="lab">${LABEL[role]}</span><span class="fam" data-fl-fam="${role}"></span>
        <button data-fl-dec="${role}">‹</button><button data-fl-inc="${role}">›</button>`;
      row.addEventListener("click", () => { focus = role; render(); });
      row.querySelector(`[data-fl-dec="${role}"]`)!.addEventListener("click", (ev) => { ev.stopPropagation(); cycleRole(role, -1); });
      row.querySelector(`[data-fl-inc="${role}"]`)!.addEventListener("click", (ev) => { ev.stopPropagation(); cycleRole(role, +1); });
      rolesEl.appendChild(row);
      roleFamEls[role] = row.querySelector(`[data-fl-fam="${role}"]`)!;
      roleRowEls[role] = row;
    }

    const effRoles = (): Record<Role, number> => (showingPin !== null && pins[showingPin] ? pins[showingPin]! : roleSel);

    function applyToPage() {
      const er = effRoles();
      for (const role of ROLES) {
        if (!canSwap(role)) continue;
        const idx = comparing ? -1 : er[role];
        if (idx < 0) elFor(role).style.removeProperty(wir[role]!.var);
        else elFor(role).style.setProperty(wir[role]!.var, CANDS[role][idx].stack);
      }
    }
    const trioFamilies = (er = roleSel) => ROLES.map((role) => (er[role] < 0 ? null : CANDS[role][er[role]].family));
    function matchedDirection(er = roleSel): Direction | null {
      const fams = trioFamilies(er);
      if (fams.some((f) => f === null)) return null;
      return directions.find((d) => ROLES.every((role, i) => d.roles[role].family === fams[i])) || null;
    }
    function activeId(): string {
      if (comparing) return "current";
      const er = effRoles();
      if (ROLES.every((role) => er[role] < 0)) return "current";
      return matchedDirection(er)?.id ?? "mixed";
    }
    function persist() {
      try {
        const fams = trioFamilies(roleSel);
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ cursorId: entries[cursor]?.id, roles: { display: fams[0], body: fams[1], mono: fams[2] } }));
      } catch {}
    }

    function render() {
      applyToPage();
      const id = activeId();
      root.setAttribute("data-fontlab-active", id);
      const onCurrent = ROLES.every((role) => roleSel[role] < 0);
      chipsEl.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String((c as HTMLElement).dataset.flId === id)));
      for (const role of ROLES) {
        const idx = roleSel[role];
        roleFamEls[role].textContent = !canSwap(role) ? "— not wired —" : idx < 0 ? "— current —" : CANDS[role][idx].family;
        roleRowEls[role].dataset.focus = String(role === focus);
        roleRowEls[role].querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = onCurrent || !canSwap(role)));
      }
      const md = matchedDirection();
      rationaleEl.textContent = comparing
        ? `Before: ${currentLabel().replace(/^Current — /, "")}. Press B to flip back.`
        : onCurrent
          ? "Flip to a direction (→), then cycle any role to mix. Renders on your real site."
          : md
            ? md.rationale
            : `Mixed — ${trioFamilies().filter(Boolean).join(" / ")}.`;
      cmpBtn.setAttribute("aria-pressed", String(comparing));
      const pinned = pins.filter(Boolean).length;
      pinBtn.textContent = pinned ? `📌${pinned}` : "📌";
      pinBtn.setAttribute("aria-pressed", String(showingPin !== null));
      pickBtn.disabled = onCurrent && showingPin === null;
      persist();
    }

    function selectPreset(i: number) { cursor = Math.max(0, Math.min(entries.length - 1, i)); comparing = false; showingPin = null; setRolesFromEntry(cursor); statusEl.textContent = ""; render(); }
    function cycleRole(role: Role, dir: number) {
      if (!canSwap(role) || ROLES.every((r) => roleSel[r] < 0)) return;
      focus = role; comparing = false; showingPin = null;
      const n = CANDS[role].length;
      roleSel[role] = ((roleSel[role] < 0 ? 0 : roleSel[role]) + dir + n) % n;
      statusEl.textContent = ""; render();
    }
    function moveFocus(dir: number) { focus = ROLES[(ROLES.indexOf(focus) + dir + ROLES.length) % ROLES.length]; render(); }
    function toggleCompare() { if (ROLES.every((r) => roleSel[r] < 0)) return; comparing = !comparing; render(); }
    function pin() {
      if (ROLES.every((r) => roleSel[r] < 0)) return;
      const slot = pins[0] === null ? 0 : pins[1] === null ? 1 : 0;
      pins[slot] = { ...roleSel };
      statusEl.textContent = `Pinned ${slot === 0 ? "A" : "B"}${pins[0] && pins[1] ? " — Space to compare" : ""}`; render();
    }
    function togglePins() { if (!(pins[0] && pins[1])) return; showingPin = showingPin === 0 ? 1 : 0; comparing = false; statusEl.textContent = `Showing ${showingPin === 0 ? "A" : "B"}`; render(); }

    async function pick() {
      const er = effRoles();
      if (ROLES.every((role) => er[role] < 0)) { statusEl.textContent = "Flip to a direction first."; return; }
      const roleObj = (role: Role) => {
        const idx = er[role];
        const c = idx < 0 ? null : CANDS[role][idx];
        return c ? { family: c.family, source: "google", weights: c.weights } : { family: replaces?.[role] ?? null, source: "current", weights: [] };
      };
      const md = matchedDirection(er);
      const fams = ROLES.map((r) => roleObj(r).family);
      const direction = md
        ? { id: md.id, name: md.name, vibe: md.vibe, rationale: md.rationale }
        : { id: "mixed", name: "Mixed", vibe: "mixed", rationale: `Custom pairing — ${fams.filter(Boolean).join(" / ")}.` };
      const selection = { version: 1, pickedAt: new Date().toISOString(), direction, roles: { display: roleObj("display"), body: roleObj("body"), mono: roleObj("mono") }, replaces, target };
      statusEl.textContent = "Saving…";
      try {
        const res = await fetch(ENDPOINT + "/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection) });
        statusEl.textContent = res.ok ? `Picked ✓ ${direction.name}` : `Error ${res.status}`;
        root.setAttribute("data-fontlab-picked", direction.id);
      } catch {
        statusEl.textContent = "No endpoint on :7777 — run `font-lab`";
      }
    }

    pickBtn.addEventListener("click", pick);
    cmpBtn.addEventListener("click", toggleCompare);
    pinBtn.addEventListener("click", pin);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key;
      if (k === "ArrowRight") { e.preventDefault(); selectPreset(cursor + 1); }
      else if (k === "ArrowLeft") { e.preventDefault(); selectPreset(cursor - 1); }
      else if (k === "ArrowDown") { e.preventDefault(); moveFocus(1); }
      else if (k === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
      else if (k === "]") { e.preventDefault(); cycleRole(focus, 1); }
      else if (k === "[") { e.preventDefault(); cycleRole(focus, -1); }
      else if (k === "b" || k === "B") { e.preventDefault(); toggleCompare(); }
      else if (k === "p" || k === "P") { e.preventDefault(); pin(); }
      else if (k === " ") { e.preventDefault(); togglePins(); }
      else if (k === "Enter") { e.preventDefault(); void pick(); }
    };
    document.addEventListener("keydown", onKey);

    if (restored) render();
    else selectPreset(0);
    return () => { document.removeEventListener("keydown", onKey); host.remove(); };
  }, []);

  return null;
}
