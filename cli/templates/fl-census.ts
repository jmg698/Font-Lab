// @ts-nocheck
/* eslint-disable */
// Font Lab census — the render-first classifier (RFC-ROLES-AND-COVERAGE rev 2.1, validated by
// spike/cluster-paint). ONE source of truth for "what are this page's typographic voices,"
// consumed two ways:
//   1. the dev panel imports it (side-effect module) and drives it live — flips PAINT clusters
//      instead of overriding CSS variables, so preview works on dead chains and islands alike;
//   2. the ship receipt (engine.verifyShip) injects this same file into a headless page as a
//      classic script and measures per-voice convergence after apply.
// The file is intentionally plain JavaScript in a .ts wrapper: valid to import from the panel,
// valid to inject verbatim into a browser. No imports, no exports, no TS syntax.
//
// STYLE-ONLY CONTRACT (the copy-edit compatibility guarantee): this code sets attributes on
// EXISTING elements and maintains ONE injected stylesheet. It never creates, moves, wraps, or
// removes page nodes and never touches text — the JsxText runs and debug-stack call-sites the
// copy-edit feature depends on stay byte-identical. (Proven: spike criterion 4.)
(function () {
  var W = typeof window !== "undefined" ? window : null;
  if (!W || W.__flCensus) return;

  var ATTR = "data-flc"; // cluster id — ship identity (provenance, receipt, work orders)
  var VATTR = "data-flv"; // voice — paint targeting (rules survive re-census untouched)
  var STYLE_ID = "__fl_paint";
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, SVG: 1, CANVAS: 1 };
  var VOICES = ["heading", "body", "label"];

  // Panel chrome, overlays, and the copy-edit wrap span are never census subjects.
  function ours(el) {
    if (!el || !el.closest) return false;
    return !!el.closest("#fontlab-panel-host,#fontlab-overlay-host,[data-fl-ours],[data-fl-edit-wrap],[contenteditable]");
  }
  function firstFamily(ff) {
    return String(ff || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  }
  // Human-readable family for labels: next/font ships hashed names ("__Hanken_Grotesk_a1b2c3");
  // strip the wrapper so cluster labels read "Hanken Grotesk", and the parity preview faces
  // ("FL Fraunces") read "Fraunces". Cluster KEYS keep the raw name — identity never lossy.
  function pretty(family) {
    var f = String(family || "");
    if (/^__/.test(f)) {
      var parts = f.replace(/^__/, "").split("_").filter(Boolean);
      if (parts.length > 1 && /^[a-zA-Z0-9]{6,}$/.test(parts[parts.length - 1]) && /\d|[a-z].*[A-Z]|^[a-z0-9]+$/.test(parts[parts.length - 1]))
        parts.pop(); // drop the trailing hash segment
      f = parts.join(" ");
    }
    return f.replace(/^FL /, "").replace(/\s+Fallback$/, "");
  }
  // Family matching across face aliases: the panel's parity faces render as "FL <family>",
  // next/font ships "__Family_Name_<hash>" — normalize to bare letters and test containment.
  function normFam(s) {
    return String(s || "").toLowerCase().replace(/^fl /, "").replace(/[^a-z0-9]+/g, "");
  }
  function familyMatches(computed, target) {
    var c = normFam(firstFamily(computed));
    var t = normFam(target);
    return !!t && (c === t || c.indexOf(t) === 0 || c.indexOf(t) !== -1);
  }

  // ---- element walk: every visible element that owns a direct non-empty text node ----------
  function collect() {
    var out = [];
    function walk(el) {
      if (!el || el.nodeType !== 1) return;
      var tag = String(el.tagName || "").toUpperCase();
      if (SKIP_TAGS[tag] || ours(el)) return;
      var cs = W.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      var chars = 0;
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3) chars += n.textContent.trim().length;
      }
      if (chars > 0) {
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({ el: el, cs: cs, chars: chars });
      }
      for (var j = 0; j < el.children.length; j++) walk(el.children[j]);
    }
    walk(W.document.body);
    return out;
  }

  // ---- provenance: React 19 call-site (the same fiber spine copy-edit rides) ----------------
  function fiberOf(el) {
    var ks = Object.keys(el);
    for (var i = 0; i < ks.length; i++) if (ks[i].indexOf("__reactFiber$") === 0) return el[ks[i]];
    return null;
  }
  function callSite(el) {
    var f = fiberOf(el);
    while (f) {
      var stack = f._debugStack && (f._debugStack.stack || "" + f._debugStack);
      if (stack) {
        var lines = String(stack).split("\n");
        for (var i = 0; i < lines.length; i++) {
          var ln = lines[i];
          if (/react-stack-top-frame|jsxDEV|node_modules/.test(ln)) continue;
          // Frames come in two shapes: client chunks (http://…/chunk.js:1:2) and server-component
          // stacks (webpack-internal:///(app-pages-browser)/./app/page.tsx:12:9 — parens inside!).
          var trimmed = ln.trimEnd();
          var paren = trimmed.charAt(trimmed.length - 1) === ")"
            ? ln.slice(ln.indexOf("(") + 1, ln.lastIndexOf(")"))
            : ln.trim().replace(/^at\s+/, "");
          var m = paren.match(/^(.+):(\d+):(\d+)$/);
          if (m && /^(https?:\/\/|webpack-internal:|file:|rsc:|turbopack:|\/)/.test(m[1]))
            return { url: m[1], line: +m[2], column: +m[3] };
        }
      }
      f = f.return;
    }
    return null;
  }
  // Route bucket from the dev chunk URL (webpack `chunks/app/fontlab/page.js` or turbopack
  // `app_fontlab_page_…`). Coarse on purpose — exact file provenance goes through the
  // source-map path the copy-edit round-trip proves. Falls back to "global".
  function routeBucket(site) {
    if (!site) return "global";
    var p = site.url.replace(/^https?:\/\/[^/]+/, "");
    var m = p.match(/app\/([a-z0-9-]+)\/(?:page|layout)/i) || p.match(/app_([a-z0-9-]+)_page/i);
    return m ? "route:" + m[1] : "global";
  }
  // Inline-style provenance: nearest self-or-ancestor whose STYLE ATTRIBUTE sets font-family
  // (the brand-island idiom: style={{fontFamily:"var(--fl-serif)"}}).
  function inlineFont(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      if (n.style && n.style.fontFamily) return n.style.fontFamily;
      n = n.parentElement;
    }
    return null;
  }

  // ---- classification: (rendered family, structural voice, provenance) ---------------------
  function classify() {
    var els = collect();
    // Char-weighted median body-ish font size — the baseline "heading-like" is judged against.
    var sizes = [];
    var totalC = 0;
    for (var i = 0; i < els.length; i++) {
      if (!/^H[1-6]$/.test(els[i].el.tagName)) {
        sizes.push([parseFloat(els[i].cs.fontSize), els[i].chars]);
        totalC += els[i].chars;
      }
    }
    sizes.sort(function (a, b) { return a[0] - b[0]; });
    var acc = 0, median = 16;
    for (var s = 0; s < sizes.length; s++) {
      acc += sizes[s][1];
      if (acc >= (totalC || 1) / 2) { median = sizes[s][0]; break; }
    }
    return els.map(function (e) {
      var family = firstFamily(e.cs.fontFamily);
      var size = parseFloat(e.cs.fontSize);
      var weight = parseInt(e.cs.fontWeight, 10) || 400;
      var mono = /mono|menlo|consolas|courier/i.test(e.cs.fontFamily);
      var tag = e.el.tagName;
      var voice;
      if (/^H[1-4]$/.test(tag) || size >= median * 1.35 || (weight >= 600 && size >= median * 1.2)) voice = "heading";
      else if (mono || size <= median * 0.82 || (e.cs.textTransform === "uppercase" && parseFloat(e.cs.letterSpacing) > 0)) voice = "label";
      else voice = "body";
      var inline = inlineFont(e.el);
      var prov = (inline ? "inline" : "css") + "@" + routeBucket(callSite(e.el));
      return { el: e.el, chars: e.chars, family: family, voice: voice, prov: prov, key: family + "|" + voice + "|" + prov };
    });
  }

  // ---- census: build clusters, stamp members ------------------------------------------------
  var CLUSTERS = null;
  function runCensus() {
    var recs = classify();
    var map = {};
    var order = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var c = map[r.key];
      if (!c) {
        c = map[r.key] = { key: r.key, family: r.family, voice: r.voice, prov: r.prov, els: [], chars: 0, sample: (r.el.textContent || "").trim().slice(0, 64) };
        order.push(c);
      }
      c.els.push(r.el);
      c.chars += r.chars;
    }
    // Fold sub-1% clusters into the largest same-voice cluster: granularity is a P0, and one-off
    // strays (a lone <strong>, a footer credit) must not become their own row.
    var total = 0;
    for (var t = 0; t < order.length; t++) total += order[t].chars;
    total = total || 1;
    var big = order.filter(function (c2) { return c2.chars >= total * 0.01; });
    var small = order.filter(function (c2) { return c2.chars < total * 0.01; });
    for (var s2 = 0; s2 < small.length; s2++) {
      var host = null;
      for (var b = 0; b < big.length; b++) {
        if (big[b].voice === small[s2].voice && (!host || big[b].chars > host.chars)) host = big[b];
      }
      if (host) {
        host.els = host.els.concat(small[s2].els);
        host.chars += small[s2].chars;
        host.folded = (host.folded || 0) + 1;
      } else big.push(small[s2]);
    }
    big.sort(function (a, b) { return b.chars - a.chars; });
    for (var k = 0; k < big.length; k++) {
      var cl = big[k];
      cl.id = "c" + k;
      var where = cl.prov.indexOf("route:") !== -1
        ? " (/" + cl.prov.split("route:")[1] + (cl.prov.indexOf("inline") === 0 ? ", inline" : "") + ")"
        : cl.prov.indexOf("inline") === 0 ? " (inline)" : "";
      cl.label = cl.voice.charAt(0).toUpperCase() + cl.voice.slice(1) + "s — " + pretty(cl.family) + where;
      for (var e2 = 0; e2 < cl.els.length; e2++) {
        cl.els[e2].setAttribute(ATTR, cl.id);
        cl.els[e2].setAttribute(VATTR, cl.voice);
      }
    }
    CLUSTERS = big;
    return report();
  }
  function report() {
    if (!CLUSTERS) return [];
    var total = 0;
    for (var i = 0; i < CLUSTERS.length; i++) total += CLUSTERS[i].chars;
    total = total || 1;
    return CLUSTERS.map(function (c) {
      return {
        id: c.id, label: c.label, family: c.family, voice: c.voice, prov: c.prov,
        elements: c.els.length, chars: c.chars, share: Math.round((1000 * c.chars) / total) / 10,
        sample: c.sample, folded: c.folded || 0,
      };
    });
  }
  // Dominant RENDERED family per voice — the truthful "Current" label (what eyes actually see,
  // vs `replaces`, which reports what source declares — the dogfood gap).
  function renderedFamilies() {
    var out = {};
    if (!CLUSTERS) return out;
    for (var i = 0; i < CLUSTERS.length; i++) {
      var c = CLUSTERS[i];
      if (!out[c.voice] || c.chars > out[c.voice].chars) out[c.voice] = { family: c.family, chars: c.chars };
    }
    var res = {};
    for (var v in out) res[v] = pretty(out[v].family);
    return res;
  }

  // ---- paint: one stylesheet, voice-keyed attribute selectors -------------------------------
  // !important beats brand-island inline styles; VATTR keying means rules survive a re-census
  // (ids may shuffle; voices don't).
  var painted = {}; // voice -> stack
  function styleEl() {
    var s = W.document.getElementById(STYLE_ID);
    if (!s) {
      s = W.document.createElement("style");
      s.id = STYLE_ID;
      s.setAttribute("data-fl-ours", "");
      W.document.head.appendChild(s);
    }
    return s;
  }
  function renderRules() {
    var css = "";
    for (var v in painted) {
      if (painted[v]) css += '[' + VATTR + '="' + v + '"]{font-family:' + painted[v] + " !important}\n";
    }
    styleEl().textContent = css;
  }
  function paintVoice(voice, stack) {
    painted[voice] = stack || null;
    renderRules();
  }
  function clearPaint() {
    painted = {};
    renderRules();
  }
  function paintedVoices() {
    var out = {};
    for (var v in painted) if (painted[v]) out[v] = painted[v];
    return out;
  }

  // ---- restamp: fold new nodes (hydration, HMR, lazy content) into existing clusters --------
  // Unstamped elements render the SITE's family (paint targets stamped attrs only), so their
  // census key matches the original clusters. Returns how much text stayed unmatched — the
  // panel triggers a full re-census when that grows (e.g. a client-side route change).
  function restamp() {
    if (!CLUSTERS) return { stamped: 0, unmatchedChars: 0, totalChars: 0 };
    var byKey = {};
    for (var i = 0; i < CLUSTERS.length; i++) byKey[CLUSTERS[i].key] = CLUSTERS[i];
    var recs = classify();
    var stamped = 0, unmatched = 0, totalChars = 0;
    for (var r = 0; r < recs.length; r++) {
      var rec = recs[r];
      totalChars += rec.chars;
      if (rec.el.hasAttribute(ATTR)) continue;
      var c = byKey[rec.key];
      if (c) {
        c.els.push(rec.el);
        rec.el.setAttribute(ATTR, c.id);
        rec.el.setAttribute(VATTR, c.voice);
        stamped++;
      } else unmatched += rec.chars;
    }
    return { stamped: stamped, unmatchedChars: unmatched, totalChars: totalChars };
  }
  // Full re-census with paint suspended, so clusters key on the site's true families — then the
  // voice-keyed rules re-attach to the fresh stamps automatically.
  function recensus() {
    var keep = painted;
    painted = {};
    renderRules();
    var rep = runCensus();
    painted = keep;
    renderRules();
    return rep;
  }

  // ---- measurement -------------------------------------------------------------------------
  // % of a voice's chars whose COMPUTED first family matches — reclassifies fresh, so it counts
  // what is actually on screen right now (the receipt's ground truth).
  function voiceCoverage(voice, family) {
    var recs = classify();
    var total = 0, hit = 0;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].voice !== voice) continue;
      total += recs[i].chars;
      if (familyMatches(recs[i].el ? W.getComputedStyle(recs[i].el).fontFamily : recs[i].family, family)) hit += recs[i].chars;
    }
    return { voice: voice, family: family, totalChars: total, hitChars: hit, pct: total ? Math.round((1000 * hit) / total) / 10 : 0 };
  }
  // Clusters of a voice that do NOT render `family` — the receipt's residue, with provenance,
  // ready to become an agent work order.
  function residueFor(voice, family) {
    var out = [];
    if (!CLUSTERS) return out;
    for (var i = 0; i < CLUSTERS.length; i++) {
      var c = CLUSTERS[i];
      if (c.voice !== voice) continue;
      var live = c.els.filter(function (el) { return el.isConnected; });
      if (!live.length) continue;
      var hits = 0;
      for (var e = 0; e < live.length; e++) {
        if (familyMatches(W.getComputedStyle(live[e]).fontFamily, family)) hits++;
      }
      if (hits < live.length)
        out.push({ id: c.id, label: c.label, family: c.family, voice: c.voice, prov: c.prov, elements: live.length, unconverged: live.length - hits, sample: c.sample });
    }
    return out;
  }
  // Glyph-metrics sanity: total rendered TEXT width (Range, not element — block elements report
  // container width, which never moves). A real font change moves this number.
  function voiceWidths(voice) {
    var w = 0;
    var range = W.document.createRange();
    var recs = classify();
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].voice !== voice) continue;
      var nodes = recs[i].el.childNodes;
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n].nodeType === 3 && nodes[n].textContent.trim()) {
          range.selectNodeContents(nodes[n]);
          w += range.getBoundingClientRect().width;
        }
      }
    }
    if (range.detach) range.detach();
    return Math.round(w * 10) / 10;
  }

  W.__flCensus = {
    census: runCensus,
    recensus: recensus,
    report: report,
    classify: classify,
    restamp: restamp,
    paintVoice: paintVoice,
    clearPaint: clearPaint,
    paintedVoices: paintedVoices,
    renderedFamilies: renderedFamilies,
    voiceCoverage: voiceCoverage,
    residueFor: residueFor,
    voiceWidths: voiceWidths,
    familyMatches: familyMatches,
    pretty: pretty,
    callSite: callSite,
    VOICES: VOICES,
    ATTR: ATTR,
    VATTR: VATTR,
  };
})();
