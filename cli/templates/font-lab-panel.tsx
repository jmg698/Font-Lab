"use client";

// Font Lab dev panel — portable build, installed by `font-lab init` into a real project.
//
// The swap applies through the analyzer's `wiring`: for each role it overrides the project's
// OWN leaf next/font variable (e.g. --font-bricolage) on the element next/font uses (<html>
// or <body>). That's what makes the live preview honest on any site — it moves the exact
// variable that ship rewrites. A role with no wiring is shown as not-previewable (its pick
// still records; apply wires it).
//
// The panel is also the handoff's face. It keeps a live SSE line to the pick endpoint
// (GET /events on :7777) so the human can SEE the loop: endpoint offline / ready / agent
// listening → Pick → saved → shipped (with undo). Pick = save; the agent ships separately.
//
// Dev-only (mounted behind a NODE_ENV guard in layout). Shadow-DOM isolated. Zero deps.

import { useEffect } from "react";
import { catalogFontFaceCss, directions, replaces, target, wiring, type Direction } from "./catalog.generated";

const ENDPOINT = "http://localhost:7777";
const STORE_KEY = "fontlab.working.v1";
const ROLES = ["display", "body", "mono"] as const;
type Role = (typeof ROLES)[number];
const LABEL: Record<Role, string> = { display: "Display", body: "Body", mono: "Mono" };

type Cand = { family: string; stack: string; weights: number[]; source: string; parity: string };
type Conn = "offline" | "ready" | "agent";
const wir = (wiring || {}) as Partial<Record<Role, { var: string; el: string } | null>>;

function candidatesFor(role: Role): Cand[] {
  const seen = new Set<string>();
  const out: Cand[] = [];
  for (const d of directions) {
    const r = d.roles[role] as Cand & { parity?: string; source?: string };
    if (!seen.has(r.family)) {
      seen.add(r.family);
      out.push({ family: r.family, stack: r.stack, weights: r.weights, source: r.source ?? "google", parity: r.parity ?? "guaranteed" });
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

    // Handoff state, fed by the endpoint's SSE stream (and the Pick ack).
    let conn: Conn = "offline";
    let savedId: string | null = null; // direction id (or "mixed") the last pick saved
    let shipped: { current: boolean } | null = null;

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
        * { box-sizing: border-box; }
        .panel {
          font-family: ui-sans-serif, system-ui, sans-serif;
          background: #101014; color: #f4f4f5;
          border: 1px solid rgba(244,244,245,.08);
          border-radius: 14px; padding: 14px; width: 308px;
          box-shadow: 0 16px 48px rgba(0,0,0,.5);
        }
        button { transition: background .15s ease-out, border-color .15s ease-out, transform .15s ease-out; }
        button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }

        .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .title { font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: rgba(244,244,245,.82); }
        .conn { display: flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(244,244,245,.72); }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #52525b; }
        .conn[data-state="ready"] .dot { background: #f59e0b; }
        .conn[data-state="agent"] .dot { background: #4ade80; animation: fl-pulse 2s ease-out infinite; }

        .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
        .chip {
          min-height: 26px; padding: 4px 9px; border: 1px solid transparent; border-radius: 8px;
          background: #26262e; color: #f4f4f5; font-size: 12px; cursor: pointer;
        }
        .chip:hover { background: #32323c; }
        .chip[aria-pressed="true"] { background: #2563eb; }
        .chip.cur { background: transparent; border-color: rgba(244,244,245,.22); }
        .chip.cur:hover { border-color: rgba(244,244,245,.4); }
        .chip.cur[aria-pressed="true"] { background: #3f3f46; border-color: transparent; }

        .roles { display: flex; flex-direction: column; gap: 5px; margin-bottom: 9px; }
        .role { display: flex; align-items: center; gap: 7px; background: #1b1b21; border-radius: 9px; padding: 5px 7px; min-height: 34px; }
        .role[data-focus="true"] { box-shadow: inset 0 0 0 2px #2563eb; }
        .role .lab { font-size: 10px; text-transform: uppercase; letter-spacing: .09em; color: rgba(244,244,245,.66); width: 46px; }
        .role .fam { flex: 1; font-size: 13.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .role[data-off="true"] .fam { color: rgba(244,244,245,.72); font-weight: 400; }
        .role .tag { font-size: 9.5px; padding: 2px 5px; border-radius: 5px; background: #26262e; color: rgba(244,244,245,.78); white-space: nowrap; }
        .role button {
          border: 0; background: #26262e; color: #f4f4f5; border-radius: 7px;
          width: 26px; height: 26px; cursor: pointer; font-size: 14px; line-height: 1;
        }
        .role button:hover { background: #3a3a45; }
        .role button:active { transform: translateY(1px); }
        .role button:disabled { opacity: .3; cursor: not-allowed; background: #26262e; transform: none; }

        .rationale { font-size: 11.5px; line-height: 1.5; color: rgba(244,244,245,.78); min-height: 32px; margin: 2px 2px 4px; }
        .fidelity { font-size: 10.5px; line-height: 1.45; color: rgba(244,244,245,.66); margin: 0 2px 8px; min-height: 13px; }

        .row { display: flex; gap: 6px; align-items: stretch; }
        .pick {
          flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          min-height: 36px; padding: 8px 11px; border: 0; border-radius: 10px;
          background: #15803d; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .pick:hover { background: #166534; }
        .pick:active { transform: translateY(1px); }
        .pick[disabled] { background: #34343e; color: #b5b5bd; cursor: not-allowed; transform: none; }
        .pick[data-done="true"] { background: #14532d; color: #d7f5e2; }
        .pick .tick { width: 14px; height: 14px; display: none; }
        .pick[data-done="true"] .tick { display: block; }
        .pick .tick path {
          fill: none; stroke: #86efac; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 20; stroke-dashoffset: 0;
        }
        .pick[data-just="true"] .tick path { animation: fl-draw .35s cubic-bezier(.25, 1, .5, 1); }
        .mini { min-height: 36px; padding: 8px 10px; border: 0; border-radius: 10px; background: #26262e; color: #f4f4f5; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .mini:hover { background: #32323c; }
        .mini[aria-pressed="true"] { background: #a16207; }

        .status { font-size: 12px; line-height: 1.5; color: rgba(244,244,245,.82); margin-top: 9px; min-height: 17px; }
        .status[data-tone="good"] { color: #86efac; }
        .status[data-tone="warn"] { color: #fcd34d; }
        .hint { font-size: 11px; color: rgba(244,244,245,.62); margin-top: 7px; line-height: 1.7; }
        kbd { background: #26262e; border-radius: 4px; padding: 0 4px; font-size: 10px; font-family: ui-monospace, monospace; }

        @keyframes fl-pulse { 0% { opacity: 1; } 50% { opacity: .35; } 100% { opacity: 1; } }
        @keyframes fl-draw { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          * { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
        }
      </style>
      <div class="panel" role="group" aria-label="Font Lab">
        <div class="head">
          <div class="title">Font Lab</div>
          <div class="conn" id="conn" data-state="offline"><span class="dot"></span><span id="connLabel">connecting…</span></div>
        </div>
        <div class="chips" id="chips"></div>
        <div class="roles" id="roles"></div>
        <div class="rationale" id="rationale"></div>
        <div class="fidelity" id="fidelity"></div>
        <div class="row">
          <button class="pick" data-fl-action="pick">
            <svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 8.6 6.2 12l7-8"/></svg>
            <span id="pickLabel">Pick</span>
          </button>
          <button class="mini" data-fl-action="compare" title="Before / after (B)">⇄</button>
          <button class="mini" data-fl-action="pin" title="Pin to compare (P)">📌</button>
        </div>
        <div class="status" id="status"></div>
        <div class="hint"><kbd>← →</kbd> direction · <kbd>↑↓</kbd> role · <kbd>[ ]</kbd> swap · <kbd>B</kbd> before/after · <kbd>P</kbd>/<kbd>Space</kbd> pin · <kbd>↵</kbd> pick</div>
      </div>`;

    const chipsEl = shadow.getElementById("chips")!;
    const rolesEl = shadow.getElementById("roles")!;
    const rationaleEl = shadow.getElementById("rationale")!;
    const fidelityEl = shadow.getElementById("fidelity")!;
    const statusEl = shadow.getElementById("status")!;
    const connEl = shadow.getElementById("conn")!;
    const connLabelEl = shadow.getElementById("connLabel")!;
    const pickBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="pick"]')!;
    const pickLabelEl = shadow.getElementById("pickLabel")!;
    const cmpBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="compare"]')!;
    const pinBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="pin"]')!;

    const setStatus = (text: string, tone: "" | "good" | "warn" = "") => {
      statusEl.textContent = text;
      statusEl.setAttribute("data-tone", tone);
    };

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
    const roleTagEls: Record<Role, HTMLElement> = {} as any;
    for (const role of ROLES) {
      const row = document.createElement("div");
      row.className = "role";
      row.dataset.role = role;
      row.dataset.off = String(!canSwap(role));
      row.innerHTML = `<span class="lab">${LABEL[role]}</span><span class="fam" data-fl-fam="${role}"></span><span class="tag" data-fl-tag="${role}" hidden></span>
        <button data-fl-dec="${role}" aria-label="previous ${role} font">‹</button><button data-fl-inc="${role}" aria-label="next ${role} font">›</button>`;
      row.addEventListener("click", () => { focus = role; render(); });
      row.querySelector(`[data-fl-dec="${role}"]`)!.addEventListener("click", (ev) => { ev.stopPropagation(); cycleRole(role, -1); });
      row.querySelector(`[data-fl-inc="${role}"]`)!.addEventListener("click", (ev) => { ev.stopPropagation(); cycleRole(role, +1); });
      rolesEl.appendChild(row);
      roleFamEls[role] = row.querySelector(`[data-fl-fam="${role}"]`)!;
      roleTagEls[role] = row.querySelector(`[data-fl-tag="${role}"]`)!;
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

    // Working-set parity: "exact" only when every chosen role is a guaranteed face.
    const workingParity = (er = effRoles()): "guaranteed" | "best-effort" => {
      for (const role of ROLES) {
        const idx = er[role];
        if (idx >= 0 && CANDS[role][idx].parity !== "guaranteed") return "best-effort";
      }
      return "guaranteed";
    };

    function render() {
      applyToPage();
      const id = activeId();
      root.setAttribute("data-fontlab-active", id);
      const onCurrent = ROLES.every((role) => roleSel[role] < 0);
      chipsEl.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String((c as HTMLElement).dataset.flId === id)));
      const er = effRoles();
      for (const role of ROLES) {
        const idx = roleSel[role];
        const cand = idx < 0 ? null : CANDS[role][idx];
        const famEl = roleFamEls[role];
        const tagEl = roleTagEls[role];
        if (!canSwap(role)) {
          // Not previewable here — but the choice still records, and apply wires it.
          famEl.textContent = cand ? cand.family : "— not wired —";
          famEl.style.fontFamily = "";
          tagEl.hidden = !cand;
          tagEl.textContent = "wired on ship";
        } else {
          famEl.textContent = cand ? cand.family : "— current —";
          // The living-specimen touch: the family name set in its own face (already loaded
          // for the preview, so this costs nothing).
          famEl.style.fontFamily = cand ? cand.stack : "";
          const be = !!cand && cand.parity !== "guaranteed";
          tagEl.hidden = !be;
          tagEl.textContent = "≈";
          tagEl.title = "best-effort: may render slightly differently once shipped";
        }
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
      fidelityEl.textContent = !onCurrent && !comparing && workingParity() === "best-effort"
        ? "≈ close preview — this mix includes a face that may differ slightly when shipped"
        : "";
      cmpBtn.setAttribute("aria-pressed", String(comparing));
      const pinned = pins.filter(Boolean).length;
      pinBtn.textContent = pinned ? `📌${pinned}` : "📌";
      pinBtn.setAttribute("aria-pressed", String(showingPin !== null));

      // Pick button narrates the handoff: Pick → Picked ✓ (saved) → Shipped ✓.
      const workingId = comparing ? "current" : ROLES.every((r) => er[r] < 0) ? "current" : (matchedDirection(er)?.id ?? "mixed");
      const savedIsWorking = savedId !== null && savedId === workingId;
      if (savedIsWorking && shipped?.current) {
        pickBtn.dataset.done = "true";
        pickLabelEl.textContent = "Shipped";
        pickBtn.disabled = true;
      } else if (savedIsWorking) {
        pickBtn.dataset.done = "true";
        pickLabelEl.textContent = "Picked";
        pickBtn.disabled = false; // picking again is a harmless no-op save
      } else {
        pickBtn.dataset.done = "false";
        pickBtn.dataset.just = "false";
        pickLabelEl.textContent = "Pick";
        pickBtn.disabled = onCurrent && showingPin === null;
      }
      persist();
    }

    function selectPreset(i: number) { cursor = Math.max(0, Math.min(entries.length - 1, i)); comparing = false; showingPin = null; setRolesFromEntry(cursor); setStatus(""); render(); }
    function cycleRole(role: Role, dir: number) {
      if (!canSwap(role) || ROLES.every((r) => roleSel[r] < 0)) return;
      focus = role; comparing = false; showingPin = null;
      const n = CANDS[role].length;
      roleSel[role] = ((roleSel[role] < 0 ? 0 : roleSel[role]) + dir + n) % n;
      setStatus(""); render();
    }
    function moveFocus(dir: number) { focus = ROLES[(ROLES.indexOf(focus) + dir + ROLES.length) % ROLES.length]; render(); }
    function toggleCompare() { if (ROLES.every((r) => roleSel[r] < 0)) return; comparing = !comparing; render(); }
    function pin() {
      if (ROLES.every((r) => roleSel[r] < 0)) return;
      const slot = pins[0] === null ? 0 : pins[1] === null ? 1 : 0;
      pins[slot] = { ...roleSel };
      setStatus(`Pinned ${slot === 0 ? "A" : "B"}${pins[0] && pins[1] ? " — Space to compare" : ""}`); render();
    }
    function togglePins() { if (!(pins[0] && pins[1])) return; showingPin = showingPin === 0 ? 1 : 0; comparing = false; setStatus(`Showing ${showingPin === 0 ? "A" : "B"}`); render(); }

    async function pick() {
      const er = effRoles();
      if (ROLES.every((role) => er[role] < 0)) { setStatus("Flip to a direction first."); return; }
      const roleObj = (role: Role) => {
        const idx = er[role];
        const c = idx < 0 ? null : CANDS[role][idx];
        return c
          ? { family: c.family, source: c.source, parity: c.parity, weights: c.weights }
          : { family: replaces?.[role] ?? null, source: "current", weights: [] };
      };
      const md = matchedDirection(er);
      const fams = ROLES.map((r) => roleObj(r).family);
      const direction = md
        ? { id: md.id, name: md.name, vibe: md.vibe, rationale: md.rationale }
        : { id: "mixed", name: "Mixed", vibe: "mixed", rationale: `Custom pairing — ${fams.filter(Boolean).join(" / ")}.` };
      const selection = { version: 1, pickedAt: new Date().toISOString(), direction, roles: { display: roleObj("display"), body: roleObj("body"), mono: roleObj("mono") }, replaces, target };
      pickBtn.disabled = true;
      pickLabelEl.textContent = "Saving…";
      try {
        const res = await fetch(ENDPOINT + "/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection) });
        if (!res.ok) {
          setStatus(`Endpoint error ${res.status} — try again`, "warn");
          render();
          return;
        }
        let ack: { agentWaiting?: boolean; autoApply?: boolean } = {};
        try { ack = await res.json(); } catch {}
        savedId = direction.id;
        shipped = null;
        root.setAttribute("data-fontlab-picked", direction.id);
        pickBtn.dataset.just = "true"; // one checkmark draw, then settle
        setStatus(
          ack.autoApply
            ? `Saved — shipping “${direction.name}” now…`
            : ack.agentWaiting
              ? `Saved — your agent has “${direction.name}” from here.`
              : `Saved “${direction.name}” — tell your agent, or run npx font-lab-apply.`,
          "good",
        );
        render();
      } catch {
        setStatus("Endpoint offline — run `npx font-lab`, then Pick again.", "warn");
        render();
      }
    }

    // ---- live handoff state (SSE) ------------------------------------------------
    const setConn = (next: Conn) => {
      if (conn === next) return;
      conn = next;
      connEl.dataset.state = next;
      connLabelEl.textContent = next === "agent" ? "agent listening" : next === "ready" ? "endpoint ready" : "offline · npx font-lab";
      connEl.title =
        next === "agent"
          ? "An agent is waiting for your pick — it ships the moment you choose."
          : next === "ready"
            ? "Pick endpoint is up on :7777. Picks save; hand them to your agent to ship."
            : "No pick endpoint on :7777 — run `npx font-lab` in your project.";
    };
    let es: EventSource | null = null;
    const handleStatus = (s: any) => {
      setConn(s.agentWaiting ? "agent" : "ready");
      if (s.selection?.direction?.id && !savedId) savedId = s.selection.direction.id; // survive reloads
      shipped = s.applied ? { current: !!s.applied.current } : null;
      if (shipped?.current && savedId) {
        const exact = workingParity(roleSel) === "guaranteed";
        setStatus(
          exact
            ? "Shipped ✓ — what you previewed is exactly what shipped. Undo: npx font-lab-undo"
            : "Shipped ✓ — best-effort faces may differ slightly. Undo: npx font-lab-undo",
          "good",
        );
      }
      render();
    };
    try {
      es = new EventSource(ENDPOINT + "/events");
      es.addEventListener("status", (ev) => { try { handleStatus(JSON.parse((ev as MessageEvent).data)); } catch {} });
      es.addEventListener("applied", () => { shipped = { current: true }; handleStatus({ agentWaiting: conn === "agent", applied: { current: true }, selection: null }); });
      es.onerror = () => setConn("offline"); // EventSource auto-reconnects; we just narrate
    } catch {
      setConn("offline");
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
    return () => { document.removeEventListener("keydown", onKey); es?.close(); host.remove(); };
  }, []);

  return null;
}
