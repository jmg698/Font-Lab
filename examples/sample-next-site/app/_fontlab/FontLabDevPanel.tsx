"use client";

// Font Lab dev panel — M1 loop, M3 before/after.
//
// The whole loop, end to end:
//   • shows the REAL current state (from the analyzer, baked into the catalog) + the
//     curated directions,
//   • flips the active direction with ← → (or click), swapping display/body/mono live by
//     setting --fl-* on :root (M0-proven: instant reflow, survives Fast Refresh),
//   • B (or the ⇄ button) toggles a before/after comparison: hold the picked direction but
//     flip the screen back to the current fonts, so the choice is judged against what's
//     actually shipping right now,
//   • "Pick" (button or Enter) POSTs a selection.json to the CLI endpoint, which writes it
//     into the project — the seam the agent reads to ship the real code.
//
// Shadow-DOM isolated so the swap never restyles the panel. Dev-only (see layout.tsx).

import { useEffect } from "react";
import {
  catalogFontFaceCss,
  directions,
  replaces,
  target,
  type Direction,
} from "./catalog.generated";

const ENDPOINT = "http://localhost:7777";

type Entry = { id: string; name: string; direction: Direction | null };

// The real current state, named by the analyzer — what before/after compares against.
function currentLabel(): string {
  const fams = [replaces.display, replaces.body].filter(Boolean) as string[];
  const uniq = [...new Set(fams)];
  return uniq.length ? `Current — ${uniq.join(" / ")}` : "Current";
}

export function FontLabDevPanel() {
  useEffect(() => {
    const root = document.documentElement;

    // Make every candidate font available (parity bundles).
    const FACE_ID = "fontlab-catalog-faces";
    if (!document.getElementById(FACE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = FACE_ID;
      styleEl.textContent = catalogFontFaceCss;
      document.head.appendChild(styleEl);
    }

    const entries: Entry[] = [
      { id: "current", name: currentLabel(), direction: null },
      ...directions.map((d) => ({ id: d.id, name: d.name, direction: d })),
    ];
    let active = 0;
    let comparing = false; // when true + a direction is active: show current ("before")

    const host = document.createElement("div");
    host.id = "fontlab-panel-host";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { font-family: ui-sans-serif, system-ui, sans-serif; background:#111114; color:#fff;
                 border-radius:14px; padding:14px; width:268px; box-shadow:0 12px 40px rgba(0,0,0,.45); }
        .title { font-size:11px; letter-spacing:.12em; text-transform:uppercase; opacity:.55; margin-bottom:10px; }
        button.dir { display:block; width:100%; text-align:left; margin:5px 0; padding:9px 11px; border:0;
                 border-radius:9px; background:#27272a; color:#fff; font-size:13px; cursor:pointer; line-height:1.2; }
        button.dir[aria-pressed="true"] { background:#2563eb; }
        button.dir small { display:block; opacity:.6; font-size:11px; margin-top:2px; }
        .rationale { font-size:11.5px; line-height:1.45; opacity:.7; min-height:32px; margin:8px 2px 10px; }
        .row { display:flex; gap:8px; align-items:center; }
        .pick { flex:1; padding:9px 11px; border:0; border-radius:9px; background:#16a34a; color:#fff;
                font-size:13px; font-weight:600; cursor:pointer; }
        .pick[disabled] { background:#3f3f46; color:#a1a1aa; cursor:not-allowed; }
        .cmp { padding:9px 11px; border:0; border-radius:9px; background:#27272a; color:#fff;
               font-size:13px; cursor:pointer; white-space:nowrap; }
        .cmp[disabled] { opacity:.4; cursor:not-allowed; }
        .cmp[aria-pressed="true"] { background:#a16207; }
        .status { font-size:11px; opacity:.7; margin-top:8px; min-height:14px; }
        .hint { font-size:10px; opacity:.4; margin-top:6px; }
      </style>
      <div class="panel" role="group" aria-label="Font Lab">
        <div class="title">Font Lab · choose a direction</div>
        <div id="dirs"></div>
        <div class="rationale" id="rationale"></div>
        <div class="row">
          <button class="pick" data-fl-action="pick">Pick</button>
          <button class="cmp" data-fl-action="compare" aria-pressed="false" title="Before / after (B)">⇄ before</button>
        </div>
        <div class="status" id="status"></div>
        <div class="hint">← → flip · B before/after · Enter pick</div>
      </div>`;

    const dirsEl = shadow.getElementById("dirs")!;
    const rationaleEl = shadow.getElementById("rationale")!;
    const statusEl = shadow.getElementById("status")!;
    const pickBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="pick"]')!;
    const cmpBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="compare"]')!;

    entries.forEach((e, i) => {
      const b = document.createElement("button");
      b.className = "dir";
      b.dataset.flId = e.id;
      b.dataset.flIndex = String(i);
      b.setAttribute("aria-pressed", String(i === 0));
      b.innerHTML = e.direction
        ? `${e.name}<small>${e.direction.vibe} · ${e.direction.roles.display.family} / ${e.direction.roles.body.family}</small>`
        : `${e.name}<small>what ships right now</small>`;
      b.addEventListener("click", () => setActive(i));
      dirsEl.appendChild(b);
    });

    function applyDirection(d: Direction) {
      root.style.setProperty("--fl-display", d.roles.display.stack);
      root.style.setProperty("--fl-sans", d.roles.body.stack);
      root.style.setProperty("--fl-mono", d.roles.mono.stack);
    }
    function applyCurrent() {
      root.style.removeProperty("--fl-display");
      root.style.removeProperty("--fl-sans");
      root.style.removeProperty("--fl-mono");
    }

    // Render the screen from (active, comparing). A direction shows "after"; comparing
    // flips it to the current state ("before") without dropping which direction is picked.
    function render() {
      const entry = entries[active];
      const showCurrent = !entry.direction || comparing;
      if (showCurrent) applyCurrent();
      else applyDirection(entry.direction!);

      root.setAttribute("data-fontlab-active", showCurrent ? "current" : entry.id);
      cmpBtn.disabled = !entry.direction;
      cmpBtn.setAttribute("aria-pressed", String(comparing && !!entry.direction));
      cmpBtn.textContent = showCurrent && entry.direction ? "⇄ after" : "⇄ before";
      pickBtn.disabled = !entry.direction;

      if (!entry.direction) {
        rationaleEl.textContent = "Flip to a direction to preview it on your real site.";
      } else if (comparing) {
        rationaleEl.textContent = `Before: ${currentLabel().replace(/^Current — /, "")}. Press B to flip back.`;
      } else {
        rationaleEl.textContent = entry.direction.rationale;
      }
    }

    function setActive(i: number) {
      active = Math.max(0, Math.min(entries.length - 1, i));
      comparing = false;
      dirsEl.querySelectorAll("button.dir").forEach((b) =>
        b.setAttribute("aria-pressed", String(Number((b as HTMLElement).dataset.flIndex) === active)),
      );
      statusEl.textContent = "";
      render();
    }

    function toggleCompare() {
      if (!entries[active].direction) return;
      comparing = !comparing;
      render();
    }

    async function pick() {
      const entry = entries[active];
      if (!entry.direction) {
        statusEl.textContent = "Pick a direction first.";
        return;
      }
      const d = entry.direction;
      const role = (r: Direction["roles"]["display"]) => ({
        family: r.family,
        source: r.source,
        weights: r.weights,
      });
      const selection = {
        version: 1,
        pickedAt: new Date().toISOString(),
        direction: { id: d.id, name: d.name, vibe: d.vibe, rationale: d.rationale },
        roles: { display: role(d.roles.display), body: role(d.roles.body), mono: role(d.roles.mono) },
        replaces,
        target,
      };
      statusEl.textContent = "Saving…";
      try {
        const res = await fetch(ENDPOINT + "/select", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(selection),
        });
        statusEl.textContent = res.ok ? "Picked ✓ — wrote .font-lab/selection.json" : `Error ${res.status}`;
        root.setAttribute("data-fontlab-picked", d.id);
      } catch {
        statusEl.textContent = `No endpoint on :7777 — run \`font-lab\``;
      }
    }

    pickBtn.addEventListener("click", pick);
    cmpBtn.addEventListener("click", toggleCompare);

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        toggleCompare();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void pick();
      }
    };
    document.addEventListener("keydown", onKey);

    setActive(0);
    return () => {
      document.removeEventListener("keydown", onKey);
      host.remove();
    };
  }, []);

  return null;
}
