/* ============================================================
   DEPTHFINDER — Tokens page ("Token Currents")
   Ports the design's Sankey flow + hotspots, wired to REAL scan data:
     /api/tokens   → sources, destinations (conserved flows)
     /api/summary  → health, dimensions, hotspots (issues)
   Nothing is fabricated; the flow mapping mirrors how the backend
   (scripts/token-budget.mjs · generateCurrents) derives each sink.
   ============================================================ */
(function () {
  "use strict";

  // ── icon paths (keyed by the icon strings /api/tokens emits) ──
  var ICONS = {
    doc: '<path d="M7 3h7l4 4v14H7z"></path><path d="M14 3v4h4"></path>',
    book: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"></path><path d="M9 4v14"></path>',
    chat: '<path d="M4 5h16v10H9l-5 4z"></path>',
    grid: '<rect x="6" y="6" width="12" height="12" rx="2"></rect><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"></path>',
    ci: '<path d="M5 7l4 4-4 4M12 17h7"></path>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"></path>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"></ellipse><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"></path><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"></path>',
    flow: '<circle cx="6" cy="6" r="2.5"></circle><circle cx="18" cy="9" r="2.5"></circle><circle cx="9" cy="18" r="2.5"></circle><path d="M8 7l8 1M8 8l1 8"></path>',
    shield: '<path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z"></path>',
    spark: '<path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z"></path>',
  };
  // stable per-position keys (the backend emits sources/destinations in a fixed order)
  var SRC_KEYS = ["claude", "readfirst", "product", "memory", "evals", "code"];
  var SINK_KEYS = ["always", "runtime", "protection", "output"];
  // true plain-language descriptors (shown as the .fmeta subtitle)
  var META = {
    claude: "agent instructions",
    readfirst: "loaded every turn",
    product: "persona & product prompts",
    memory: "household state",
    evals: "checks & CI guards",
    code: "app source modules",
    always: "persistent context",
    runtime: "computed per turn",
    protection: "evals & guards",
    output: "generated tokens",
  };
  // conserved currents — each mirrors a generateCurrents() destination formula:
  //   Always = CLAUDE.md + Read-first · Runtime = Product + Memory
  //   Protection = Evals/CI · Output = Code modules
  var FLOWS = [
    ["claude", "always"], ["readfirst", "always"],
    ["product", "runtime"], ["memory", "runtime"],
    ["evals", "protection"], ["code", "output"],
  ];
  // generic, category-level plain-language lead per dimension tab (ELI10 on).
  // True for ANY hotspot in that tab — no fabricated specifics.
  var ELI_BY_TAB = {
    1: "The docs and the code disagree here, so a reader (or the agent) could be misled.",
    2: "This loads into the agent every turn, so it costs time and money on every call.",
    3: "A rule or check meant to run automatically isn't wired into CI yet.",
    4: "What the notes say has drifted from what the code actually does.",
  };
  var ELI_DEFAULT = "Cleaning this up makes the agent's context more honest, lighter and cheaper.";
  var DIMLABEL = { 1: "Honesty", 2: "Weight", 3: "Coverage", 4: "Drift" };
  var C = 97.39; // circumference of the small r=15.5 radials

  // ── tiny helpers ──
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ktok(n) { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n); }
  function svg(inner) { return '<svg viewBox="0 0 24 24">' + inner + "</svg>"; }
  function sevClass(s) { return s < 35 ? "sev-hi" : s < 70 ? "sev-md" : "sev-ok"; }
  function ratingWord(s) { return s < 35 ? "Critical" : s < 70 ? "Caution" : "Healthy"; }
  function ratingCls(s) { return s < 35 ? "crit" : s < 70 ? "cau" : "good"; }

  var eli = true; // ELI10 state (synced to the global df_eli10 toggle below)

  // ── Health hero + Dimensions, from /api/summary ──
  function fillSummary(s) {
    var H = Math.round(s.healthScore != null ? s.healthScore : 0);
    var hs = document.querySelector(".health .score");
    if (hs) hs.innerHTML = H + '<span class="den">/ 100</span>';
    var rt = document.querySelector(".health .rating");
    if (rt) { rt.textContent = ratingWord(H); rt.className = "rating " + ratingCls(H); }
    var fill = document.querySelector(".health .rg-fill");
    if (fill) { var c = 2 * Math.PI * 52; fill.style.strokeDasharray = (H / 100 * c).toFixed(1) + " " + c.toFixed(1); }
    var radial = document.querySelector(".health .radial");
    if (radial) radial.setAttribute("aria-label", "Overall health " + H + " of 100");
    var dims = s.dimensions || {};
    var cards = document.querySelectorAll(".loadgrid .lcard");
    [["honesty", 0], ["weight", 1], ["coverage", 2]].forEach(function (p) {
      // tolerate the pre-rename "coherence" key from a stale cache
      var d = dims[p[0]] || (p[0] === "honesty" ? dims.coherence : null), card = cards[p[1]];
      if (!d || !card) return;
      var val = card.querySelector(".lc-val"); if (val) val.textContent = Math.round(d.score);
      card.classList.remove("sev-hi", "sev-md", "sev-ok"); card.classList.add(sevClass(d.score));
    });
  }

  // ── build the source / sink flow columns from /api/tokens ──
  var srcTok = {}, maxSrc = 1;
  function flowNode(key, item, withPct) {
    var meta = META[key] || "";
    var val = withPct && item.pct != null ? ktok(item.tokens) + " · " + (item.pct * 100).toFixed(1) + "%" : ktok(item.tokens);
    var n = document.createElement("div");
    n.className = "flow-node"; n.dataset.k = key;
    n.innerHTML =
      '<span class="fi">' + svg(ICONS[item.icon] || ICONS.doc) + "</span>" +
      '<span class="fn"><span class="fnm">' + esc(item.name) + "</span>" +
      (meta ? '<span class="fmeta">' + esc(meta) + "</span>" : "") + "</span>" +
      '<span class="fv">' + val + "</span>";
    return n;
  }
  function buildFlow(t) {
    var src = $("flowSrc"), sink = $("flowSink");
    if (src) { src.innerHTML = ""; (t.sources || []).forEach(function (s, i) { var k = SRC_KEYS[i] || s.name; srcTok[k] = s.tokens || 0; src.appendChild(flowNode(k, s, false)); }); }
    if (sink) { sink.innerHTML = ""; (t.destinations || []).forEach(function (d, i) { sink.appendChild(flowNode(SINK_KEYS[i] || d.name, d, true)); }); }
    maxSrc = Math.max.apply(null, SRC_KEYS.map(function (k) { return srcTok[k] || 0; }).concat([1]));
    wireNodes();
  }

  // ── ribbons (conserved source → sink currents), widths ∝ source tokens ──
  function drawRibbons() {
    var s = $("ribbons"); if (!s) return;
    var gb = s.getBoundingClientRect(); if (!gb.width) return;
    var pos = {};
    document.querySelectorAll("#flowSrc .flow-node").forEach(function (n) {
      var r = n.getBoundingClientRect();
      pos[n.dataset.k] = { x: (r.right - gb.left) / gb.width * 1000, y: (r.top + r.height / 2 - gb.top) / gb.height * 460 };
    });
    document.querySelectorAll("#flowSink .flow-node").forEach(function (n) {
      var r = n.getBoundingClientRect();
      pos[n.dataset.k] = { x: (r.left - gb.left) / gb.width * 1000, y: (r.top + r.height / 2 - gb.top) / gb.height * 460 };
    });
    var aff = window.__affCur, dimAll = !!aff, html = "";
    FLOWS.forEach(function (f) {
      var a = pos[f[0]], b = pos[f[1]]; if (!a || !b) return;
      var frac = (srcTok[f[0]] || 0) / maxSrc, w = 2 + frac * 16, mx = (a.x + b.x) / 2;
      var on = aff && aff[f[0]] && aff[f[1]];
      var stroke = on ? "rgba(255,255,255," + (0.5 + frac * 0.4).toFixed(2) + ")"
        : "rgba(150,160,175," + ((dimAll ? 0.04 : 0.1) + frac * (dimAll ? 0.04 : 0.18)).toFixed(2) + ")";
      html += '<path d="M' + a.x + " " + a.y + " C " + mx + " " + a.y + " " + mx + " " + b.y + " " + b.x + " " + b.y +
        '" stroke="' + stroke + '" stroke-width="' + w.toFixed(1) + '" fill="none" />';
    });
    s.innerHTML = html;
  }
  function redrawSoon() { drawRibbons(); requestAnimationFrame(drawRibbons); setTimeout(drawRibbons, 40); }

  // ── node highlight (click a current → show what it connects to) ──
  var allNodes = [];
  function clearCurrents() { window.__affCur = null; allNodes.forEach(function (n) { n.classList.remove("aff", "dim", "sel"); }); redrawSoon(); }
  function showCurrents(cur) {
    var set = {}; cur.forEach(function (k) { set[k] = 1; }); window.__affCur = set;
    allNodes.forEach(function (n) { var on = !!set[n.dataset.k]; n.classList.toggle("aff", on); n.classList.toggle("dim", !on); n.classList.remove("sel"); });
    redrawSoon();
  }
  function connectNode(k) {
    var set = {}; set[k] = 1;
    FLOWS.forEach(function (f) { if (f[0] === k) set[f[1]] = 1; if (f[1] === k) set[f[0]] = 1; });
    window.__affCur = set;
    allNodes.forEach(function (n) { var on = !!set[n.dataset.k]; n.classList.toggle("aff", on); n.classList.toggle("dim", !on); n.classList.toggle("sel", n.dataset.k === k); });
    hideDetail();
    var hs = $("tkHs"); if (hs) hs.querySelectorAll(".map-hs-item.on").forEach(function (x) { x.classList.remove("on"); });
    redrawSoon();
  }
  function wireNodes() {
    allNodes = [].slice.call(document.querySelectorAll(".flow-node"));
    allNodes.forEach(function (n) {
      n.addEventListener("click", function (e) {
        e.stopPropagation();
        if (n.classList.contains("sel")) clearCurrents(); else connectNode(n.dataset.k);
      });
    });
  }

  // ── hotspot → which currents it touches (derived from real title/detail/tab) ──
  function hotspotCurrents(h) {
    var s = ((h.title || "") + " " + (h.detail || "")).toLowerCase(), cur = {};
    function add() { for (var i = 0; i < arguments.length; i++) cur[arguments[i]] = 1; }
    if (/claude\.md/.test(s)) add("claude", "always");
    if (/read[- ]first|decisions log|always[- ]loaded|bundle/.test(s)) add("readfirst", "always");
    if (/gate|eval|\bci\b|workflow|enforce|coverage|taxonomy/.test(s)) add("evals", "protection");
    if (/duplicat|boundary|copies|copy-paste|near-dup/.test(s)) add("readfirst", "code");
    if (/stale|outdated|dangling|shim|aging|\bref\b/.test(s)) add("code", "readfirst");
    if (/memory|unused|unconnected|orphan|dead weight|no incoming/.test(s)) add("memory", "product");
    if (/prompt|persona|agent.*prompt/.test(s)) add("product", "runtime");
    if (/code module/.test(s)) add("code", "output");
    var keys = Object.keys(cur);
    if (keys.length) return keys;
    return ({ 1: ["readfirst", "code"], 2: ["claude", "always"], 3: ["evals", "protection"], 4: ["code", "readfirst"] })[h.tab] || ["claude", "always"];
  }

  // ── hotspot detail panel (mirrors the Context inspector) ──
  var lastDetail = null;
  function hideDetail() { var d = $("tkDetail"); if (d) { d.classList.remove("show"); d.innerHTML = ""; } var f = document.querySelector(".tk-flow"); if (f) f.classList.remove("compact"); setTimeout(drawRibbons, 30); }
  function showDetail(it) {
    var box = $("tkDetail"); if (!box) return;
    lastDetail = it;
    var hv = it.healthGain || 0, dash = (Math.min(100, hv) / 100 * C).toFixed(2);
    var desc = eli ? (ELI_BY_TAB[it.tab] || ELI_DEFAULT) : (it.detail || "");
    var acts = it.action ? '<div class="ins-acts"><div class="ins-acts-h">Suggested action</div><div class="ins-act"><span class="ia-n">1</span><span>' + esc(it.action) + "</span></div></div>" : "";
    var dim = it.dim ? '<div class="ins-row"><span class="k">Improves</span><span class="v"><b>' + esc(it.dim) + "</b></span></div>" : "";
    box.innerHTML =
      '<div class="ins-name">' + esc(it.name) + "</div>" +
      '<div class="ins-sevhealth"><span class="sev-badge ' + (it.sev === "high" ? "high" : "med") + '">' + (it.sev === "high" ? "High" : "Medium") + "</span>" +
      (hv ? '<span class="nm-health"><span class="nmh-radial"><svg viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="15.5"></circle><circle class="f" cx="18" cy="18" r="15.5" stroke-dasharray="' + dash + ' 97.39"></circle></svg></span>+' + hv + ' <span class="nmh-lab">health</span></span>' : "") +
      "</div>" +
      (desc ? '<div class="ins-note" style="border-top:none;padding-top:4px;margin-top:8px;">' + esc(desc) + "</div>" : "") +
      dim + acts;
    box.classList.add("show");
    var f = document.querySelector(".tk-flow"); if (f) f.classList.add("compact");
    setTimeout(drawRibbons, 30);
  }

  // ── hotspots sidebar, from /api/summary issues ──
  function buildHotspots(s) {
    var hs = $("tkHs"); if (!hs) return;
    var raw = (s && (s.hotspots || s.issues)) || [];
    var items = raw.map(function (h, i) {
      return {
        o: i + 1, name: h.title || "Hotspot " + (i + 1),
        sev: h.severity === "high" ? "high" : "med",
        detail: h.detail || "", action: h.action || "",
        healthGain: h.healthGain || 0, tab: h.tab, dim: DIMLABEL[h.tab] || "",
        cur: hotspotCurrents(h),
      };
    });
    hs.innerHTML = "";
    var hi = items.filter(function (x) { return x.sev === "high"; }).length, md = items.length - hi;
    var head = document.createElement("button"); head.type = "button"; head.className = "map-hs-head";
    head.innerHTML = '<span class="mh-t">Hotspots <span class="mh-n high">' + hi + " high</span>" + (md ? '<span class="mh-n med">' + md + " medium</span>" : "") + '</span><span class="mh-x">‹</span>';
    var list = document.createElement("div"); list.className = "map-hs-list";
    var first = null;
    items.forEach(function (it) {
      var b = document.createElement("button"); b.type = "button"; b.className = "map-hs-item";
      b.innerHTML = '<span class="mh-ord">' + it.o + '</span><span class="mh-name">' + esc(it.name) + '</span><span class="mh-dot ' + it.sev + '"></span>';
      b.addEventListener("click", function () {
        var wasOn = b.classList.contains("on");
        list.querySelectorAll(".map-hs-item.on").forEach(function (x) { x.classList.remove("on"); });
        if (wasOn) { clearCurrents(); hideDetail(); } else { b.classList.add("on"); showCurrents(it.cur); showDetail(it); }
      });
      list.appendChild(b);
      if (!first) { first = b; window.__tkFirst = function () { b.click(); }; }
    });
    head.addEventListener("click", function () { var o = hs.classList.toggle("open"); head.querySelector(".mh-x").textContent = o ? "‹" : "›"; });
    hs.appendChild(head); hs.appendChild(list);
    if (window.__tkFirst) setTimeout(window.__tkFirst, 60);
    // click empty flow space → dismiss
    var flow = document.querySelector(".tk-flow");
    if (flow) flow.addEventListener("click", function (e) {
      if (e.target.closest(".flow-node") || e.target.closest(".map-hs") || e.target.closest(".tk-detail")) return;
      list.querySelectorAll(".map-hs-item.on").forEach(function (x) { x.classList.remove("on"); });
      clearCurrents(); hideDetail();
    });
  }

  // ── ELI10: toggle node descriptors + re-render the open detail ──
  function applyEli() {
    document.querySelectorAll("#flowSrc .flow-node .fmeta").forEach(function (m) { m.style.display = eli ? "" : "none"; });
    if (lastDetail && document.querySelector("#tkHs .map-hs-item.on")) showDetail(lastDetail);
  }

  // ── boot ──
  function boot() {
    Promise.all([
      fetch("/api/tokens").then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch("/api/summary").then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (res) {
      var tokens = res[0], summary = res[1];
      if (summary) fillSummary(summary);
      if (tokens) buildFlow(tokens);
      if (summary) buildHotspots(summary);
      redrawSoon(); setTimeout(drawRibbons, 120); setTimeout(drawRibbons, 320);
      window.addEventListener("resize", drawRibbons);
      var curEli = $("curEli10");
      if (curEli) { eli = curEli.checked; curEli.addEventListener("change", function () { eli = curEli.checked; applyEli(); }); }
      applyEli();
    });
    // mobile burger (design parity)
    var burger = document.querySelector(".burger"), navTabs = document.querySelector(".nav-tabs");
    if (burger && navTabs) burger.addEventListener("click", function () { var o = navTabs.classList.toggle("open"); burger.classList.toggle("is-open", o); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // ── global ELI10 sync (df_eli10) — shared across all dashboard tabs ──
  (function () {
    var KEY = "df_eli10";
    function boxes() { return [].slice.call(document.querySelectorAll(".eli10-toggle input")); }
    function get() { try { var v = localStorage.getItem(KEY); return v === null ? true : v === "1"; } catch (e) { return true; } }
    function set(v) { try { if (localStorage.getItem(KEY) !== (v ? "1" : "0")) localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }
    var on = get();
    boxes().forEach(function (c) { c.checked = on; c.dispatchEvent(new Event("change")); });
    document.addEventListener("change", function (e) {
      var t = e.target; if (!t || !t.matches || !t.matches(".eli10-toggle input")) return;
      set(t.checked);
      boxes().forEach(function (c) { if (c !== t && c.checked !== t.checked) { c.checked = t.checked; c.dispatchEvent(new Event("change")); } });
    });
    window.addEventListener("storage", function (e) { if (e.key !== KEY) return; var v = get(); boxes().forEach(function (c) { if (c.checked !== v) { c.checked = v; c.dispatchEvent(new Event("change")); } }); });
  })();
})();
