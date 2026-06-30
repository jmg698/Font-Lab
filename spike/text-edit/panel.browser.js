// The intuitive half: turn any rendered text into something a human can just click and retype.
// Framework-agnostic, dev-only. Mounts a tiny toggle; in edit mode, hovering a text element
// highlights it, clicking makes it contentEditable, Enter/blur saves, Esc cancels. On save it
// reads the element's React fiber `_debugStack`, extracts the JSX call-site frame, and POSTs it
// to the local endpoint, which resolves it to source and rewrites the words. Reversible (Undo).
//
// Exposed as window.initTextEditPanel({ endpoint }) so it works both injected (spike demo) and
// from a thin React wrapper (TextEditPanel.tsx) in a real project.
(function () {
  function fiberOf(el) {
    const k = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return k ? el[k] : null;
  }
  // React 19: the JSX call site is the first app frame in the fiber's captured _debugStack.
  function callSite(el) {
    const f = fiberOf(el);
    const stack = f && f._debugStack && (f._debugStack.stack || "" + f._debugStack);
    if (!stack) return null;
    for (const line of stack.split("\n")) {
      if (/react-stack-top-frame|jsxDEV/.test(line)) continue;
      const m = line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
      if (m) return { url: m[1], line: +m[2], column: +m[3] };
    }
    return null;
  }
  // The clean, unambiguous case: an element whose children are all text (no nested elements).
  // Rich text with inline markup is intentionally out of scope for this first pass.
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest("#fl-text-host")) return false;
    if (!el.childNodes.length) return false;
    for (const n of el.childNodes) if (n.nodeType !== 3) return false; // only text nodes
    return el.textContent.trim().length > 0 && !!callSite(el);
  }

  window.initTextEditPanel = function ({ endpoint = "http://localhost:7788" } = {}) {
    if (document.getElementById("fl-text-host")) return;
    const host = document.createElement("div");
    host.id = "fl-text-host";
    host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;";
    document.body.appendChild(host);
    const sh = host.attachShadow({ mode: "open" });
    sh.innerHTML = `
      <style>
        .bar{font-family:ui-sans-serif,system-ui,sans-serif;background:#111114;color:#fff;border-radius:12px;padding:8px 10px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;gap:8px;align-items:center}
        button{border:0;border-radius:8px;padding:7px 11px;font-size:12.5px;cursor:pointer;background:#27272a;color:#fff}
        button.on{background:#16a34a}
        .st{font-size:11px;opacity:.7;min-width:120px}
      </style>
      <div class="bar">
        <button id="toggle">✎ Edit text</button>
        <button id="undo" title="Undo last edit">↩</button>
        <span class="st" id="st">click ✎ then click any words</span>
      </div>`;
    const toggle = sh.getElementById("toggle");
    const undoBtn = sh.getElementById("undo");
    const st = sh.getElementById("st");
    const status = (m) => (st.textContent = m);

    let on = false;
    let editing = null; // { el, original }
    const OUTLINE = "outline:2px dashed #16a34a;outline-offset:2px;cursor:text;border-radius:2px";

    let hovered = null;
    const onMove = (e) => {
      if (!on || editing) return;
      const el = e.target;
      if (hovered && hovered !== el) { hovered.style.cssText = hovered.dataset._fl || ""; hovered = null; }
      if (isEditable(el) && el !== hovered) {
        el.dataset._fl = el.getAttribute("style") || "";
        el.style.cssText = (el.dataset._fl ? el.dataset._fl + ";" : "") + OUTLINE;
        hovered = el;
      }
    };

    async function commit(el, original) {
      if (!editing) return; // re-entry guard: contentEditable=false below fires a sync blur
      editing = null;
      const newText = el.textContent.replace(/\s+/g, " ").trim();
      el.contentEditable = "false";
      el.style.cssText = el.dataset._fl || "";
      if (newText === original.replace(/\s+/g, " ").trim()) { status("no change"); return; }
      status("saving…");
      const frame = callSite(el);
      try {
        const res = await fetch(endpoint + "/edit", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ frame, oldText: original, newText }),
        });
        const j = await res.json();
        if (j.ok) status(`saved ✓ ${j.file.split("/").pop()}:${j.line}`);
        else { el.textContent = original; status(`can't edit: ${j.error}`); }
      } catch { el.textContent = original; status(`no endpoint on :7788`); }
    }

    const onClick = (e) => {
      if (!on) return;
      const el = e.target;
      if (el.closest("#fl-text-host")) return;
      if (editing) return;
      if (!isEditable(el)) { status("that text comes from data — not directly editable"); return; }
      e.preventDefault(); e.stopPropagation();
      if (hovered) { hovered.style.cssText = hovered.dataset._fl || ""; hovered = null; }
      const original = el.textContent;
      editing = { el, original };
      el.contentEditable = "true";
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      status("type, then Enter to save · Esc to cancel");
      const key = (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); el.removeEventListener("keydown", key); commit(el, original); }
        else if (ev.key === "Escape") { ev.preventDefault(); el.textContent = original; el.contentEditable = "false"; el.style.cssText = el.dataset._fl || ""; editing = null; el.removeEventListener("keydown", key); status("cancelled"); }
      };
      el.addEventListener("keydown", key);
      el.addEventListener("blur", () => { el.removeEventListener("keydown", key); if (editing) commit(el, original); }, { once: true });
    };

    toggle.addEventListener("click", () => {
      on = !on;
      toggle.classList.toggle("on", on);
      toggle.textContent = on ? "✎ Editing — click words" : "✎ Edit text";
      status(on ? "click any words to edit them" : "off");
      document.body.style.cursor = on ? "default" : "";
    });
    undoBtn.addEventListener("click", async () => {
      status("undoing…");
      try { const r = await (await fetch(endpoint + "/undo", { method: "POST" })).json(); status(r.ok ? "undone ✓ (reload to see)" : r.error); }
      catch { status("no endpoint on :7788"); }
    });
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
  };
})();
