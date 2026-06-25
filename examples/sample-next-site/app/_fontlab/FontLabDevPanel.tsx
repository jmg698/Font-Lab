"use client";

// Font Lab dev panel — M1 walking skeleton.
//
// The whole loop, end to end:
//   • shows the current state + the curated directions,
//   • flips the active direction with ← → (or click), swapping display/body/mono live by
//     setting --fl-* on :root (M0-proven: instant reflow, survives Fast Refresh),
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
      { id: "current", name: "Current — Inter", direction: null },
      ...directions.map((d) => ({ id: d.id, name: d.name, direction: d })),
    ];
    let active = 0;

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
        .status { font-size:11px; opacity:.7; margin-top:8px; min-height:14px; }
        .hint { font-size:10px; opacity:.4; margin-top:6px; }
      </style>
      <div class="panel" role="group" aria-label="Font Lab">
        <div class="title">Font Lab · choose a direction</div>
        <div id="dirs"></div>
        <div class="rationale" id="rationale"></div>
        <div class="row"><button class="pick" data-fl-action="pick">Pick</button></div>
        <div class="status" id="status"></div>
        <div class="hint">← → to flip · Enter to pick</div>
      </div>`;

    const dirsEl = shadow.getElementById("dirs")!;
    const rationaleEl = shadow.getElementById("rationale")!;
    const statusEl = shadow.getElementById("status")!;
    const pickBtn = shadow.querySelector<HTMLButtonElement>('[data-fl-action="pick"]')!;

    entries.forEach((e, i) => {
      const b = document.createElement("button");
      b.className = "dir";
      b.dataset.flId = e.id;
      b.dataset.flIndex = String(i);
      b.setAttribute("aria-pressed", String(i === 0));
      b.innerHTML = e.direction
        ? `${e.name}<small>${e.direction.vibe} · ${e.direction.roles.display.family} / ${e.direction.roles.body.family}</small>`
        : `${e.name}<small>the current state</small>`;
      b.addEventListener("click", () => setActive(i));
      dirsEl.appendChild(b);
    });

    function setActive(i: number) {
      active = Math.max(0, Math.min(entries.length - 1, i));
      const entry = entries[active];
      dirsEl.querySelectorAll("button.dir").forEach((b) =>
        b.setAttribute("aria-pressed", String(Number((b as HTMLElement).dataset.flIndex) === active)),
      );
      root.setAttribute("data-fontlab-active", entry.id);

      if (entry.direction) {
        root.style.setProperty("--fl-display", entry.direction.roles.display.stack);
        root.style.setProperty("--fl-sans", entry.direction.roles.body.stack);
        root.style.setProperty("--fl-mono", entry.direction.roles.mono.stack);
        rationaleEl.textContent = entry.direction.rationale;
        pickBtn.disabled = false;
      } else {
        root.style.removeProperty("--fl-display");
        root.style.removeProperty("--fl-sans");
        root.style.removeProperty("--fl-mono");
        rationaleEl.textContent = "Flip to a direction to preview it on your real site.";
        pickBtn.disabled = true;
      }
      statusEl.textContent = "";
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

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active - 1);
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
