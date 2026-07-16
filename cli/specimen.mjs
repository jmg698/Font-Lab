// Font Lab — the portable "choosing moment".
//
// A self-contained HTML specimen sheet: one card per direction, rendered on the project's own
// palette, with the parity fonts embedded (self-hosted url or base64). It needs no dev server,
// no Next panel, no framework — an agent hands the human a single file they open. This is the
// framework-agnostic surface the live in-app panel can't be (the panel is a React component in
// Next's dev server; this is just HTML).
//
// It also carries the honest render check the Happenings dogfood proved we need: `document.fonts
// .check()` returns true for FALLBACK fonts, so a face that silently failed to load reads as
// "loaded". Instead we measure a probe string's width in the primary face vs. the generic
// baselines — if it matches every generic, the face fell back, and the card is badged ⚠. That
// same check turns a headless screenshot into a verified capture (never a Times-in-disguise shot).
//
// Pure + dependency-free (string building only), so it's unit-tested directly (m8-test.mjs).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const flFace = (family) => `FL ${family}`;

// The width-diff verifier, embedded in the page. Marks each face loaded/fallback and rolls the
// result up into per-card badges + a global summary. Kept as a string so the HTML is standalone.
export const RENDER_CHECK_JS = `
(function () {
  function widthOf(text, fam) {
    var s = document.createElement("span");
    s.style.cssText = "position:absolute;left:-9999px;top:-9999px;white-space:nowrap;font-size:100px;font-weight:400;font-family:" + fam + ";";
    s.textContent = text;
    document.body.appendChild(s);
    var w = s.offsetWidth;
    document.body.removeChild(s);
    return w;
  }
  // "Really rendering" = the primary face measurably changes the probe width vs. every generic
  // baseline. We deliberately test the PRIMARY only (not the metric-matched fallback), so a
  // silent fallback is caught rather than masked. (This is FontFaceObserver's technique.)
  var PROBE = "WgqQ mmiiWW 0123 — the quick brown fox";
  var GENERICS = ["serif", "sans-serif", "monospace"];
  function rendering(face) {
    for (var i = 0; i < GENERICS.length; i++) {
      var base = widthOf(PROBE, GENERICS[i]);
      var withFace = widthOf(PROBE, "'" + face + "'," + GENERICS[i]);
      if (Math.abs(withFace - base) > 1.5) return true;
    }
    return false;
  }
  function run() {
    var faces = window.__FL_FACES || [];
    var ok = 0;
    faces.forEach(function (f) {
      var good = rendering(f);
      if (good) ok++;
      var nodes = document.querySelectorAll('[data-fl-face="' + f + '"]');
      for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute("data-fl-loaded", good ? "1" : "0");
    });
    var cards = document.querySelectorAll("[data-fl-card]");
    for (var c = 0; c < cards.length; c++) {
      var faceEls = cards[c].querySelectorAll("[data-fl-face]");
      var bad = 0;
      for (var j = 0; j < faceEls.length; j++) if (faceEls[j].getAttribute("data-fl-loaded") === "0") bad++;
      var badge = cards[c].querySelector(".fl-check");
      if (badge) {
        badge.textContent = bad ? "⚠ " + bad + " font" + (bad > 1 ? "s" : "") + " not loaded" : "✓ fonts rendering";
        badge.className = "fl-check " + (bad ? "fl-bad" : "fl-good");
      }
    }
    var sum = document.getElementById("fl-render-summary");
    if (sum) {
      sum.textContent = ok + " / " + faces.length + " faces rendering";
      sum.setAttribute("data-fl-all", ok === faces.length ? "1" : "0");
    }
    document.documentElement.setAttribute("data-fl-verified", "1");
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(run, 60); });
  else window.addEventListener("load", run);
})();
`;

const DEFAULT_PALETTE = { bg: "#f7f6f2", fg: "#141414", muted: "#6b6b6b", rule: "#e2e0da", accent: "#d6482f" };
const DEFAULT_COPY = {
  eyebrow: "The personal event wall",
  headline: "Type is the fastest way a product shows its taste.",
  paragraph:
    "A flyer someone screenshotted off Instagram. A link a friend dropped in the group chat. The same face has to carry a loud headline and stay calm under a paragraph of body copy — so you read it here, at the real size, before it ships.",
  mono: "const preview = ship; // 0123456789",
};

// Build the standalone HTML. All inputs are plain data; nothing is fetched here.
//   directions: [{ id, name, vibe, rationale, parity?, kind?, roles:{display,body,mono:{family,stack}} }]
//   faceCss:    string of @font-face rules (self-hosted url or base64) for every family used
//   palette:    { bg, fg, muted, rule, accent }   (any subset; falls back to defaults)
//   copy:       { eyebrow, headline, paragraph, mono }
//   title:      document title / masthead
export function buildSpecimenHtml({ directions = [], faceCss = "", palette = {}, copy = {}, title = "Font Lab" } = {}) {
  const p = { ...DEFAULT_PALETTE, ...palette };
  const c = { ...DEFAULT_COPY, ...copy };
  // No project copy found → the cards render Font Lab's stock specimen text. Say so ON THE SHEET:
  // silently passing stock copy off as "your site" is the bait-and-switch the honesty contract
  // forbids, and the real-site alternative (screenshot_directions) deserves a signpost.
  const stockCopy = !copy || !copy.headline;
  // buildParityBundles returns faceCss as an ARRAY of @font-face rules — join with newlines, NOT
  // the comma a bare `${array}` would produce (a comma between @font-face rules is invalid CSS and
  // silently drops every rule after the first).
  const faces_css = Array.isArray(faceCss) ? faceCss.join("\n") : faceCss;

  // Every primary face the render check should verify.
  const faces = [...new Set(directions.flatMap((d) => ["display", "body", "mono"].map((r) => d.roles?.[r]?.family).filter(Boolean)))].map(flFace);

  const stackFor = (d, role) => d.roles?.[role]?.stack || d.roles?.[role]?.family || "inherit";
  const famFor = (d, role) => d.roles?.[role]?.family || "—";
  // For the render-check hook, tag an element with its PRIMARY face name (checked separately).
  const faceAttr = (d, role) => (d.roles?.[role]?.family ? ` data-fl-face="${esc(flFace(d.roles[role].family))}"` : "");

  const card = (d, i) => {
    const kind = d.kind || (i === 0 ? "candidate" : "candidate");
    const parityBadge = d.parity ? `<span class="fl-tag fl-parity-${esc(d.parity)}">${esc(d.parity)}</span>` : "";
    return `
    <section class="card" data-fl-card="${esc(d.id || i)}"${kind === "current" ? ' data-fl-current="1"' : ""}>
      <header class="card-head">
        <div class="idx">${String(i).padStart(2, "0")}</div>
        <div class="meta">
          <div class="name">${esc(d.name || d.id || "Direction")}${kind === "current" ? ' <span class="fl-tag fl-cur">current</span>' : ""}</div>
          <div class="fonts">${esc(famFor(d, "display"))} · ${esc(famFor(d, "body"))} · ${esc(famFor(d, "mono"))}</div>
        </div>
        <div class="badges">${parityBadge}<span class="fl-check"></span></div>
      </header>
      <div class="specimen">
        <div class="eyebrow" style="font-family:${(stackFor(d,"body"))}"${faceAttr(d, "body")}>${esc(c.eyebrow)}</div>
        <h2 class="headline" style="font-family:${(stackFor(d,"display"))}"${faceAttr(d, "display")}>${esc(c.headline)}</h2>
        <p class="body" style="font-family:${(stackFor(d,"body"))}"${faceAttr(d, "body")}>${esc(c.paragraph)}</p>
        <code class="mono" style="font-family:${(stackFor(d,"mono"))}"${faceAttr(d, "mono")}>${esc(c.mono)}</code>
        ${d.rationale ? `<div class="rationale" style="font-family:${(stackFor(d,"body"))}">${esc(d.rationale)}</div>` : ""}
      </div>
    </section>`;
  };

  return `<!doctype html>
<html lang="en" data-fl-verified="0">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — choosing sheet</title>
<style>
${faces_css}
:root { --bg:${esc(p.bg)}; --fg:${esc(p.fg)}; --muted:${esc(p.muted)}; --rule:${esc(p.rule)}; --accent:${esc(p.accent)}; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); -webkit-font-smoothing:antialiased; font-family: system-ui, sans-serif; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 40px 28px 80px; }
.masthead { display:flex; align-items:baseline; justify-content:space-between; gap:16px; border-bottom:2px solid var(--fg); padding-bottom:12px; margin-bottom:8px; }
.masthead .brand { font-weight:700; letter-spacing:-0.01em; }
.masthead .sub { color:var(--muted); font-size:13px; }
#fl-render-summary { font-size:12px; color:var(--muted); }
#fl-render-summary[data-fl-all="1"]::before { content:"● "; color:#1a9d55; }
#fl-render-summary[data-fl-all="0"]::before { content:"● "; color:var(--accent); }
.hint { color:var(--muted); font-size:13px; margin:14px 0 28px; }
.card { border:1px solid var(--rule); border-radius:14px; background:color-mix(in srgb, var(--bg) 92%, #fff); margin:0 0 22px; overflow:hidden; }
.card-head { display:flex; align-items:center; gap:14px; padding:12px 18px; border-bottom:1px solid var(--rule); }
.card-head .idx { font-variant-numeric:tabular-nums; font-weight:700; color:var(--accent); font-size:13px; }
.card-head .meta { flex:1; min-width:0; }
.card-head .name { font-weight:650; font-size:14px; }
.card-head .fonts { color:var(--muted); font-size:12px; margin-top:2px; }
.badges { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.fl-tag { font-size:11px; padding:2px 7px; border-radius:999px; border:1px solid var(--rule); color:var(--muted); text-transform:lowercase; }
.fl-cur { border-color:var(--fg); color:var(--fg); }
.fl-parity-guaranteed { color:#1a7d47; border-color:#bfe3cd; }
.fl-parity-best-effort { color:#9a6a00; border-color:#ecdaa8; }
.fl-check { font-size:11px; padding:2px 7px; border-radius:999px; }
.fl-check.fl-good { color:#1a7d47; }
.fl-check.fl-bad { color:var(--accent); font-weight:600; }
.specimen { padding: 22px 26px 28px; }
.specimen .eyebrow { text-transform:uppercase; letter-spacing:0.14em; font-size:11px; color:var(--accent); margin-bottom:10px; }
.specimen .headline { font-size: clamp(30px, 5vw, 52px); line-height:1.03; letter-spacing:-0.02em; margin:0 0 16px; font-weight:700; }
.specimen .body { font-size:17px; line-height:1.5; max-width:60ch; margin:0 0 16px; color:color-mix(in srgb, var(--fg) 88%, var(--bg)); }
.specimen .mono { display:inline-block; font-size:13px; background:color-mix(in srgb, var(--fg) 8%, transparent); padding:4px 8px; border-radius:6px; }
.specimen .rationale { margin-top:16px; font-size:13px; color:var(--muted); font-style:italic; }
</style>
</head>
<body>
<div class="wrap">
  <div class="masthead">
    <div><span class="brand">${esc(title)}</span> <span class="sub">choosing sheet · fonts embedded, opens offline</span></div>
    <div id="fl-render-summary">verifying…</div>
  </div>
  <div class="hint">Each card renders the same copy in one direction — Display · Body · Mono. Scroll to compare, then tell the agent which id to ship. The badge on each card is a live render check (not a fonts.check false-positive).${stockCopy ? " ⚠ These cards use Font Lab's SPECIMEN COPY (no project copy was found) — they show the faces, not your pages. For previews on your real running site, have the agent run font_lab_screenshot_directions against your dev server (works on any framework)." : ""}</div>
  ${directions.map((d, i) => card(d, i)).join("\n")}
</div>
<script>window.__FL_FACES = ${JSON.stringify(faces)};</script>
<script>${RENDER_CHECK_JS}</script>
</body>
</html>
`;
}
