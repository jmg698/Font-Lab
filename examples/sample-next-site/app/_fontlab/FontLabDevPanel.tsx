"use client";

// The Font Lab dev panel — the M0 "injection" spike.
//
// Three things to prove here:
//   1. It swaps fonts by setting --fl-* on :root via an INLINE style on <html>, which
//      reflows the whole page (Tailwind font-* utilities + base CSS both resolve through
//      these vars).
//   2. That override lives OUTSIDE React's tree, so Next.js Fast Refresh never wipes it.
//   3. The panel's own UI is isolated in a Shadow DOM, so the font swap it performs on the
//      page does not restyle the panel.
//
// No proxy, no iframe. Mounted only in development (see layout.tsx guard).

import { useEffect } from "react";
import { CANDIDATE_FAMILY, candidateFontFaceCss } from "./generated-fonts";

const CANDIDATES = [
  { key: "current", label: "Current — Inter", family: null },
  { key: "fraunces", label: "Fraunces", family: CANDIDATE_FAMILY },
] as const;

export function FontLabDevPanel() {
  useEffect(() => {
    const root = document.documentElement;

    // Make the candidate font available on the page.
    const FACE_ID = "fontlab-candidate-face";
    if (!document.getElementById(FACE_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = FACE_ID;
      styleEl.textContent = candidateFontFaceCss;
      document.head.appendChild(styleEl);
    }

    // Shadow-isolated overlay so the panel UI is immune to the swap.
    const host = document.createElement("div");
    host.id = "fontlab-panel-host";
    host.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const buttons = CANDIDATES.map(
      (c) =>
        `<button data-fl="${c.key}" aria-pressed="${c.key === "current"}">${c.label}</button>`,
    ).join("");
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { font-family: ui-sans-serif, system-ui, sans-serif; background:#111114; color:#fff;
                 border-radius:12px; padding:12px; width:230px; box-shadow:0 10px 34px rgba(0,0,0,.4); }
        .title { font-size:11px; letter-spacing:.1em; text-transform:uppercase; opacity:.55; margin-bottom:8px; }
        button { display:block; width:100%; text-align:left; margin:4px 0; padding:8px 10px; border:0;
                 border-radius:8px; background:#27272a; color:#fff; font-size:13px; cursor:pointer; }
        button[aria-pressed="true"] { background:#2563eb; }
        .hint { font-size:10px; opacity:.45; margin-top:8px; }
      </style>
      <div class="panel" role="group" aria-label="Font Lab">
        <div class="title">Font Lab · body + display</div>
        ${buttons}
        <div class="hint">click to flip · survives HMR</div>
      </div>`;

    const apply = (key: string) => {
      const choice = CANDIDATES.find((c) => c.key === key) ?? CANDIDATES[0];
      shadow
        .querySelectorAll("button")
        .forEach((b) =>
          b.setAttribute(
            "aria-pressed",
            String((b as HTMLElement).dataset.fl === key),
          ),
        );
      // Expose the active state for the HMR test to read.
      root.setAttribute("data-fontlab-active", key);
      if (choice.family) {
        root.style.setProperty("--fl-sans", choice.family);
        root.style.setProperty("--fl-display", choice.family);
      } else {
        root.style.removeProperty("--fl-sans");
        root.style.removeProperty("--fl-display");
      }
    };

    const onClick = (e: Event) => {
      const t = e.currentTarget as HTMLElement;
      apply(t.dataset.fl ?? "current");
    };
    const btnEls = Array.from(shadow.querySelectorAll("button"));
    btnEls.forEach((b) => b.addEventListener("click", onClick));

    return () => {
      btnEls.forEach((b) => b.removeEventListener("click", onClick));
      host.remove();
    };
  }, []);

  return null;
}
