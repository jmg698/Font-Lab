// Cluster + paint spike — browser side. Injected by run.mjs after the page renders.
// Style-only contract: this script sets attributes on EXISTING elements and injects ONE
// stylesheet. It never creates, moves, wraps, or removes nodes and never touches text —
// that is what keeps the copy-edit machinery (JsxText runs + debug-stack call-sites) intact.
(() => {
  if (window.__flSpike) return;
  const ATTR = "data-flc";
  const STYLE_ID = "__fl_spike_style";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "SVG", "CANVAS"]);
  const OURS = (el) => !!(el && el.closest && (el.closest("[data-fl-spike]") || el.id === STYLE_ID));
  const firstFamily = (ff) => (ff || "").split(",")[0].trim().replace(/^["']|["']$/g, "");

  // ---- element walk: every visible element that owns a direct non-empty text node ----
  function collect() {
    const out = [];
    const walk = (el) => {
      if (!el || el.nodeType !== 1 || SKIP_TAGS.has(el.tagName) || OURS(el)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      let chars = 0;
      for (const n of el.childNodes) if (n.nodeType === 3) chars += n.textContent.trim().length;
      if (chars > 0) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({ el, cs, chars });
      }
      for (const c of el.children) walk(c);
    };
    walk(document.body);
    return out;
  }

  // ---- provenance: React 19 call-site (same fiber technique as the panel / copy edit) ----
  function fiberOf(el) {
    const k = Object.keys(el).find((k2) => k2.startsWith("__reactFiber$"));
    return k ? el[k] : null;
  }
  function callSite(el) {
    let f = fiberOf(el);
    while (f) {
      const stack = f._debugStack && (f._debugStack.stack || "" + f._debugStack);
      if (stack) {
        for (const ln of String(stack).split("\n")) {
          if (/react-stack-top-frame|jsxDEV|node_modules/.test(ln)) continue;
          // frames come in two shapes: client chunks (http://…/chunk.js:1:2) and server-component
          // stacks (webpack-internal:///(app-pages-browser)/./app/page.tsx:12:9 — parens inside!).
          // Take the content of the outermost parens (or the whole line) and rsplit on :line:col.
          const paren = ln.lastIndexOf(")") === ln.trimEnd().length - 1 ? ln.slice(ln.indexOf("(") + 1, ln.lastIndexOf(")")) : ln.trim().replace(/^at\s+/, "");
          const m = paren.match(/^(.+):(\d+):(\d+)$/);
          if (m && /^(https?:\/\/|webpack-internal:|file:|rsc:|turbopack:|\/)/.test(m[1])) return { url: m[1], line: +m[2], column: +m[3] };
        }
      }
      f = f.return;
    }
    return null;
  }
  // raw first frames, for driver-side debugging when callSite comes back null
  function stackSample(el) {
    let f = fiberOf(el);
    while (f) {
      const stack = f._debugStack && (f._debugStack.stack || "" + f._debugStack);
      if (stack) return String(stack).split("\n").slice(0, 6);
      f = f.return;
    }
    return null;
  }
  // Route bucket from the dev chunk URL (webpack `chunks/app/fontlab/page.js` or turbopack
  // `app_fontlab_page_…`). Coarse on purpose — exact file provenance goes through the
  // source-map path the copy-edit round-trip proves. Falls back to "global".
  function routeBucket(site) {
    if (!site) return "global";
    const p = site.url.replace(/^https?:\/\/[^/]+/, "");
    const m = p.match(/app\/([a-z0-9-]+)\/(?:page|layout)/i) || p.match(/app_([a-z0-9-]+)_page/i);
    return m ? "route:" + m[1] : "global";
  }
  // Inline-style provenance: nearest self-or-ancestor whose STYLE ATTRIBUTE sets font-family
  // (the /fontlab island idiom: style={{fontFamily:"var(--fl-serif)"}}).
  function inlineFont(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      const v = n.style && n.style.fontFamily;
      if (v) return v;
      n = n.parentElement;
    }
    return null;
  }

  // ---- classification: (family, structural voice, provenance) ----
  function classify() {
    const els = collect();
    // char-weighted median body-ish font size — the baseline "heading-like" is judged against
    const sizes = [];
    for (const e of els) if (!/^H[1-6]$/.test(e.el.tagName)) sizes.push([parseFloat(e.cs.fontSize), e.chars]);
    sizes.sort((a, b) => a[0] - b[0]);
    const totalC = sizes.reduce((s, x) => s + x[1], 0) || 1;
    let acc = 0, median = 16;
    for (const [sz, c] of sizes) { acc += c; if (acc >= totalC / 2) { median = sz; break; } }

    return els.map((e) => {
      const family = firstFamily(e.cs.fontFamily);
      const size = parseFloat(e.cs.fontSize);
      const weight = parseInt(e.cs.fontWeight, 10) || 400;
      const mono = /mono|menlo|consolas|courier/i.test(e.cs.fontFamily);
      const tag = e.el.tagName;
      let voice;
      if (/^H[1-4]$/.test(tag) || size >= median * 1.35 || (weight >= 600 && size >= median * 1.2)) voice = "heading";
      else if (mono || size <= median * 0.82 || (e.cs.textTransform === "uppercase" && parseFloat(e.cs.letterSpacing) > 0)) voice = "label";
      else voice = "body";
      const inline = inlineFont(e.el);
      const prov = (inline ? "inline" : "css") + "@" + routeBucket(callSite(e.el));
      return { el: e.el, chars: e.chars, family, voice, prov, key: family + "|" + voice + "|" + prov };
    });
  }

  // ---- census: build clusters, stamp members ----
  let CLUSTERS = null;
  function census() {
    const recs = classify();
    const map = new Map();
    for (const r of recs) {
      let c = map.get(r.key);
      if (!c) map.set(r.key, (c = { key: r.key, family: r.family, voice: r.voice, prov: r.prov, els: [], chars: 0, sample: (r.el.textContent || "").trim().slice(0, 48) }));
      c.els.push(r.el);
      c.chars += r.chars;
    }
    // fold sub-1% clusters into the largest same-voice cluster: granularity is a P0, and
    // one-off strays (a lone <strong>, a footer credit) must not become their own row
    const all = [...map.values()];
    const total = all.reduce((s, c) => s + c.chars, 0) || 1;
    const big = all.filter((c) => c.chars >= total * 0.01);
    for (const small of all.filter((c) => c.chars < total * 0.01)) {
      const host = big.filter((b) => b.voice === small.voice).sort((a, b) => b.chars - a.chars)[0];
      if (host) { host.els.push(...small.els); host.chars += small.chars; host.folded = (host.folded || 0) + 1; }
      else big.push(small);
    }
    big.sort((a, b) => b.chars - a.chars);
    big.forEach((c, i) => {
      c.id = "c" + i;
      const where = c.prov.includes("route:") ? ` (/${c.prov.split("route:")[1]}${c.prov.startsWith("inline") ? ", inline" : ""})` : c.prov.startsWith("inline") ? " (inline)" : "";
      c.label = `${c.voice[0].toUpperCase() + c.voice.slice(1)}s — ${c.family}${where}`;
      for (const el of c.els) el.setAttribute(ATTR, c.id);
    });
    CLUSTERS = big;
    return report();
  }
  function report() {
    const total = CLUSTERS.reduce((s, c) => s + c.chars, 0) || 1;
    return CLUSTERS.map((c) => ({
      id: c.id, label: c.label, family: c.family, voice: c.voice, prov: c.prov,
      elements: c.els.length, chars: c.chars, share: +((100 * c.chars) / total).toFixed(1), sample: c.sample,
    }));
  }

  // ---- paint: one stylesheet + attribute selectors; !important beats the island's inline styles ----
  const painted = new Map(); // clusterId -> family
  function styleEl() {
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement("style");
      s.id = STYLE_ID;
      s.setAttribute("data-fl-spike", "");
      document.head.appendChild(s);
    }
    return s;
  }
  function renderRules() {
    styleEl().textContent = [...painted.entries()]
      .map(([id, fam]) => `[${ATTR}="${id}"]{font-family:"${fam}",${/mono/i.test(fam) ? "monospace" : "serif"} !important}`)
      .join("\n");
  }
  function paint(clusterId, family) { painted.set(clusterId, family); renderRules(); }
  function flipVoice(voice, family) {
    const ids = CLUSTERS.filter((c) => c.voice === voice).map((c) => c.id);
    for (const id of ids) painted.set(id, family);
    renderRules();
    return ids;
  }
  function clearPaint() { painted.clear(); renderRules(); }

  // ---- measurement ----
  // % of a voice's chars whose COMPUTED first family matches — reclassifies fresh so it
  // counts post-HMR elements only if the restamp loop actually caught them.
  function voiceCoverage(voice, family) {
    let total = 0, hit = 0;
    for (const r of classify()) {
      if (r.voice !== voice) continue;
      total += r.chars;
      if (r.family.toLowerCase().startsWith(family.toLowerCase())) hit += r.chars;
    }
    return { voice, family, totalChars: total, hitChars: hit, pct: total ? +((100 * hit) / total).toFixed(1) : 0 };
  }
  // glyph-metrics sanity: total rendered TEXT width (Range, not element — block elements report
  // container width, which never moves). A real font change moves this number.
  function voiceWidths(voice) {
    let w = 0;
    const range = document.createRange();
    for (const r of classify())
      if (r.voice === voice)
        for (const n of r.el.childNodes)
          if (n.nodeType === 3 && n.textContent.trim()) {
            range.selectNodeContents(n);
            w += range.getBoundingClientRect().width;
          }
    range.detach && range.detach();
    return +w.toFixed(1);
  }
  // ship receipt: no paint involved — what does each voice ACTUALLY render as right now?
  function shipReceipt(targets) {
    clearPaint();
    const out = {};
    for (const [voice, family] of Object.entries(targets)) out[voice] = voiceCoverage(voice, family);
    return out;
  }

  // ---- copy-edit probe: a painted heading's call-site + run text, for the round-trip ----
  function editProbes(voice = "heading", cap = 8) {
    // several candidates, longest text runs first: long phrases are unique in source, which
    // is what the production fallback (findPhrase, no debug frame) needs to resolve. The
    // driver walks the list until one resolves via frame or unique phrase.
    const cands = [];
    for (const c of CLUSTERS.filter((c2) => c2.voice === voice)) {
      for (const el of c.els) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue; // skip sr-only / clipped runs — not heading text perceptually
        const run = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim().length > 3);
        if (!run) continue;
        const site = callSite(el);
        cands.push({ site, debug: site ? null : stackSample(el), runText: run.textContent, flc: el.getAttribute(ATTR), tag: el.tagName, el });
      }
    }
    cands.sort((a, b) => b.runText.trim().length - a.runText.trim().length);
    return cands.slice(0, cap).map((c, i) => {
      c.el.setAttribute("data-fl-probe", String(i)); // attribute-only marker so the driver can re-find it
      const structure = structureOf(`[data-fl-probe="${i}"]`);
      const { el, ...out } = c;
      return { ...out, idx: i, structure };
    });
  }
  function probeText(idx) {
    const el = document.querySelector(`[data-fl-probe="${idx}"]`);
    return el ? el.textContent : null;
  }
  // structural fingerprint — must be identical before/after paint (style-only proof)
  function structureOf(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    return [...el.childNodes].map((n) => (n.nodeType === 3 ? "#text:" + n.textContent : n.nodeName)).join("|");
  }

  // ---- restamp loop: debounced, self-excluding, suspended during an active content edit ----
  const editingActive = () => {
    const a = document.activeElement;
    return !!(a && (a.isContentEditable || (a.closest && a.closest("[contenteditable='true'],[data-fl-edit-wrap]"))));
  };
  let restamps = 0, timer = null;
  function restamp() {
    if (!CLUSTERS) return;
    const byKey = new Map(CLUSTERS.map((c) => [c.key, c]));
    for (const r of classify()) {
      if (r.el.hasAttribute(ATTR)) continue;
      const c = byKey.get(r.key);
      if (c) { c.els.push(r.el); r.el.setAttribute(ATTR, c.id); restamps++; }
    }
  }
  const mo = new MutationObserver((muts) => {
    if (muts.every((m) => OURS(m.target.nodeType === 1 ? m.target : m.target.parentElement))) return;
    if (editingActive()) return; // never fight the caret; focusout below catches up
    if (timer) clearTimeout(timer);
    timer = setTimeout(restamp, 150);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusout", () => setTimeout(restamp, 250), true);

  window.__flSpike = { census, report, flipVoice, paint, clearPaint, voiceCoverage, voiceWidths, shipReceipt, editProbes, probeText, structureOf, restampCount: () => restamps };
})();
