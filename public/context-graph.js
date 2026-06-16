/* Depthfinder dashboard — Context page graph, WIRED TO REAL SCAN DATA.
 *
 * Ported from the design prototype (simplicity-graph.js) but the hardcoded
 * surface list is replaced by a live fetch of /api/map (the same generator the
 * old Cytoscape Context tab used) + /api/summary (the health scores). The
 * design's force-layout + SVG render + select/fan/inspect/filter/pan/zoom engine
 * is preserved; only the data source changed. Node/edge TYPES already match the
 * design's legend (the design was built from this data model), so the adapter is
 * a thin type→key map.
 */
(function () {
  // design type-key → {color var, label, default load}
  var TYPE = {
    ai:   { c: "var(--nt-agent)",   label: "Agent instruction", load: "always" },
    doc:  { c: "var(--nt-doc)",     label: "Doc",               load: "on-demand" },
    code: { c: "var(--nt-doc)",     label: "Code module",       load: "code" },
    card: { c: "var(--nt-card)",    label: "Card",              load: "runtime" },
    pp:   { c: "var(--nt-product)", label: "Product prompt",    load: "runtime" },
    da:   { c: "var(--nt-devagent)",label: "Dev-agent prompt",  load: "on-demand" },
    ms:   { c: "var(--nt-memory)",  label: "Memory store",      load: "runtime" },
    df:   { c: "var(--nt-flag)",    label: "Derived flag",      load: "runtime" },
    rt:   { c: "var(--nt-router)",  label: "Router tier",       load: "on-demand" },
    ci:   { c: "var(--nt-devagent)",label: "CI job",            load: "ci" },
    eval: { c: "var(--nt-agent)",   label: "Eval",              load: "ci/eval" },
  };
  // real /api/map node.type → design type-key
  var TYPEMAP = {
    agent_instruction: "ai", doc: "doc", code_module: "code", card: "card",
    product_prompt: "pp", dev_agent_prompt: "da", memory_store: "ms",
    derived_flag: "df", rule: "df", router_tier: "rt", ci_job: "ci", eval: "eval",
  };
  // a coarse cluster from type, only used to seed the force layout nicely
  var CLUSTER = {
    ai: "core", doc: "core", card: "core", pp: "design", da: "design",
    code: "code", df: "flags", rt: "code", ms: "mem", ci: "ci", eval: "ci",
  };
  var EKIND = {
    read_before:  { c: "var(--nt-agent)",   d: "none", w: 1.3, o: 0.8 },
    decides:      { c: "var(--ink-2)",      d: "none", w: 1.3, o: 0.85 },
    enhances:     { c: "var(--nt-product)", d: "5 4",  w: 1.2, o: 0.7 },
    protected_by: { c: "var(--nt-devagent)",d: "none", w: 1.4, o: 0.85 },
    gated_in_ci:  { c: "var(--nt-doc)",     d: "1 5",  w: 1.4, o: 0.8 },
    references:   { c: "var(--line-3)",     d: "none", w: 1,   o: 0.5 },
    duplicates:   { c: "var(--nt-flag)",    d: "5 4",  w: 1.3, o: 0.8 },
  };

  var NS = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("sxSvg");
  function el(t, a) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function tnum(n) { return (n || 0).toLocaleString(); }

  // closure-scoped graph state, filled once the map loads
  var nodes = [], L = [], byId = {}, nodeEls = [], edgeEls = [];
  var W = 1000, H = 720;
  var selectedId = null, curPos = {}, curVB = { x: 0, y: 0, w: 1000, h: 720 }, animRAF = null;

  function api(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }

  // ── boot ──
  Promise.all([api("/api/map"), api("/api/summary").catch(function () { return null; })])
    .then(function (res) { build(res[0]); if (res[1]) fillSummary(res[1]); })
    .catch(function (e) {
      var box = document.getElementById("sxInspect");
      if (box) box.innerHTML = '<div class="ins-note">Could not load the context map: ' + (e && e.message || e) + ". Is the dashboard server running?</div>";
      console.error("[context] map load failed", e);
    });

  function build(map) {
    var rawNodes = (map && map.nodes) || [], rawEdges = (map && map.edges) || [];
    // radius from token weight (sqrt, clamped to the design's 8–30 range)
    nodes = rawNodes.map(function (n) {
      var key = TYPEMAP[n.type] || "doc";
      var r = Math.max(8, Math.min(30, 8 + Math.sqrt(n.tokens || 0) / 3));
      return {
        id: n.id, label: n.label || n.id, type: key, raw: n,
        r: r, cluster: CLUSTER[key] || "core",
        readFirst: n.load === "read-first" || n.load === "read_first",
        load: n.load, tok: n.tokens || 0,
      };
    });
    byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    L = rawEdges.map(function (e) { return { s: e.source, t: e.target, k: EKIND[e.type] ? e.type : "references" }; })
      .filter(function (l) { return byId[l.s] && byId[l.t]; });

    layout();
    render();
    wireInteractions();
    fillRail(map);
  }

  // ── force layout (design parameters) ──
  function layout() {
    var seeds = { core: [470, 360], design: [770, 150], code: [660, 560], flags: [250, 560], bottom: [470, 665], mem: [810, 640], ci: [760, 470] };
    var seed = 20251; // deterministic jitter so the layout is stable across reloads
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    nodes.forEach(function (n) { var s = seeds[n.cluster] || [500, 360]; n.x = s[0] + (rnd() - 0.5) * 130; n.y = s[1] + (rnd() - 0.5) * 130; n.vx = 0; n.vy = 0; });
    for (var it = 0; it < 460; it++) {
      for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        var a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        var f = 2700 / d2, fx = f * dx / d, fy = f * dy / d; a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      L.forEach(function (l) { var a = byId[l.s], b = byId[l.t]; var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01; var f = (d - 95) * 0.02, fx = f * dx / d, fy = f * dy / d; a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy; });
      nodes.forEach(function (n) {
        n.vx += (500 - n.x) * 0.0022; n.vy += (380 - n.y) * 0.0022;
        n.x += Math.max(-7, Math.min(7, n.vx)); n.y += Math.max(-7, Math.min(7, n.vy));
        n.vx *= 0.86; n.vy *= 0.86; n.x = Math.max(42, Math.min(W - 42, n.x)); n.y = Math.max(42, Math.min(H - 42, n.y));
      });
    }
  }

  // ── render ──
  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    edgeEls = []; nodeEls = [];
    L.forEach(function (l) {
      var a = byId[l.s], b = byId[l.t], m = EKIND[l.k] || EKIND.references;
      var ln = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: m.c, "stroke-width": m.w, "stroke-dasharray": m.d, "stroke-opacity": m.o, class: "gedge" });
      ln.dataset.from = l.s; ln.dataset.to = l.t; svg.appendChild(ln); edgeEls.push(ln);
    });
    var deg = {}; L.forEach(function (l) { deg[l.s] = (deg[l.s] || 0) + 1; deg[l.t] = (deg[l.t] || 0) + 1; });
    nodes.forEach(function (n) {
      var g = el("g", { class: "gnode" }); g.dataset.id = n.id;
      var single = (deg[n.id] || 0) <= 1, rr = single ? 3 : n.r;
      var c = el("circle", { cx: n.x, cy: n.y, r: rr, fill: single ? TYPE[n.type].c : "#000", "fill-opacity": 1, stroke: TYPE[n.type].c, "stroke-width": 1.5 });
      c.style.setProperty("--nc", TYPE[n.type].c);
      if (!single) {
        var fs = Math.max(8.5, Math.min(12, n.r * 0.62));
        var t = el("text", { x: n.x, y: n.y + n.r + 11, "text-anchor": "middle", "font-size": fs }); t.textContent = n.label;
        g.appendChild(c); g.appendChild(t);
      } else {
        var td = el("text", { x: n.x, y: n.y + rr + 9, "text-anchor": "middle", "font-size": 8.5 }); td.style.fill = "#333a45"; td.textContent = n.label;
        g.appendChild(c); g.appendChild(td);
      }
      g.addEventListener("click", function (e) { e.stopPropagation(); if (selectedId === n.id) deselect(); else select(n.id); });
      svg.appendChild(g); nodeEls.push(g);
    });
    svg.addEventListener("click", function () { deselect(); });
    curPos = {}; nodes.forEach(function (n) { curPos[n.id] = { x: n.x, y: n.y }; });
  }

  function neighbours(id) { var s = {}; s[id] = 1; L.forEach(function (l) { if (l.s === id) s[l.t] = 1; if (l.t === id) s[l.s] = 1; }); return s; }

  function animate(targetPos, vbT, dur) {
    if (animRAF) cancelAnimationFrame(animRAF);
    var start = {}; nodeEls.forEach(function (g) { var id = g.dataset.id; start[id] = { x: curPos[id].x, y: curPos[id].y }; });
    var vb0 = { x: curVB.x, y: curVB.y, w: curVB.w, h: curVB.h }, t0 = performance.now();
    function step(now) {
      var p = Math.min(1, (now - t0) / (dur || 460)), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      nodeEls.forEach(function (g) { var id = g.dataset.id, o = byId[id]; var tg = targetPos[id] || { x: o.x, y: o.y }; var x = start[id].x + (tg.x - start[id].x) * e, y = start[id].y + (tg.y - start[id].y) * e; curPos[id] = { x: x, y: y }; g.style.transform = "translate(" + (x - o.x) + "px," + (y - o.y) + "px)"; });
      edgeEls.forEach(function (l) { var a = curPos[l.dataset.from], b = curPos[l.dataset.to]; if (a) { l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); } if (b) { l.setAttribute("x2", b.x); l.setAttribute("y2", b.y); } });
      curVB = { x: vb0.x + (vbT.x - vb0.x) * e, y: vb0.y + (vbT.y - vb0.y) * e, w: vb0.w + (vbT.w - vb0.w) * e, h: vb0.h + (vbT.h - vb0.h) * e };
      svg.setAttribute("viewBox", curVB.x + " " + curVB.y + " " + curVB.w + " " + curVB.h);
      if (p < 1) animRAF = requestAnimationFrame(step);
    }
    animRAF = requestAnimationFrame(step);
  }
  function fitVB(pos) {
    var xs = [], ys = []; for (var k in pos) { xs.push(pos[k].x); ys.push(pos[k].y); }
    if (!xs.length) return { x: 0, y: 0, w: 1000, h: 720 };
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, pad = 130, ar = 1000 / 720;
    var w = Math.max(maxX - minX, 160) + pad * 2, h = Math.max(maxY - minY, 160) + pad * 2;
    if (w / h < ar) w = h * ar; else h = w / ar;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function deselect() {
    selectedId = null;
    nodeEls.forEach(function (g) { g.classList.remove("sel", "dim"); });
    edgeEls.forEach(function (l) { l.classList.remove("dim"); });
    var insp = document.getElementById("sxInspect"); if (insp) insp.innerHTML = "";
    var orig = {}; nodes.forEach(function (n) { orig[n.id] = { x: n.x, y: n.y }; });
    animate(orig, { x: 0, y: 0, w: 1000, h: 720 }, 460);
  }
  function select(id) {
    selectedId = id; var n = byId[id], nb = neighbours(id);
    nodeEls.forEach(function (g) { g.classList.toggle("sel", g.dataset.id === id); g.classList.toggle("dim", !nb[g.dataset.id]); });
    edgeEls.forEach(function (l) { l.classList.toggle("dim", !(l.dataset.from === id || l.dataset.to === id)); });
    var pos = {}; Object.keys(nb).forEach(function (k) { if (byId[k]) pos[k] = { x: byId[k].x, y: byId[k].y }; });
    animate({}, fitVB(pos), 480);
    var d = 0; L.forEach(function (l) { if (l.s === id || l.t === id) d++; });
    var box = document.getElementById("sxInspect"); if (!box) return; var tp = TYPE[n.type];
    box.innerHTML =
      '<div class="ins-type" style="color:' + tp.c + '">' + tp.label + "</div>" +
      '<div class="ins-name">' + n.label + "</div>" +
      '<div class="ins-row"><span class="k">Load</span><span class="v"><b>' + (n.readFirst ? "read-first" : (n.load || tp.load)) + "</b></span></div>" +
      '<div class="ins-row"><span class="k">Est. tokens</span><span class="v"><b>' + tnum(n.tok) + "</b></span></div>" +
      '<div class="ins-row"><span class="k">Connections</span><span class="v"><b>' + d + "</b> edges</span></div>" +
      (n.raw && n.raw.path ? '<div class="ins-note">' + n.raw.path + "</div>" : "");
  }

  function wireInteractions() {
    function matches(n, v) {
      if (v === "all") return true;
      if (v === "boundary") { var nb = neighbours("CLAUDE.md"); return n.id === "CLAUDE.md" || nb[n.id] || n.cluster === "core"; }
      if (v === "loaded") return n.readFirst || n.type === "ai" || n.load === "always";
      if (v === "docs") return ["doc", "da", "pp", "ai", "card"].indexOf(n.type) >= 0;
      return true;
    }
    var filt = document.getElementById("sxFilter");
    if (filt) filt.addEventListener("change", function (e) {
      var v = e.target.value, vis = {}; nodes.forEach(function (n) { vis[n.id] = matches(n, v); });
      nodeEls.forEach(function (g) { g.classList.remove("sel"); g.classList.toggle("dim", !vis[g.dataset.id]); });
      edgeEls.forEach(function (l) { l.classList.toggle("dim", !(vis[l.dataset.from] && vis[l.dataset.to])); });
      selectedId = null; var insp = document.getElementById("sxInspect"); if (insp) insp.innerHTML = ""; resetViewBox();
    });
    var refr = document.getElementById("sxRefresh");
    if (refr) refr.addEventListener("click", function () {
      if (filt) filt.value = "all"; selectedId = null;
      nodeEls.forEach(function (g) { g.classList.remove("dim", "sel"); });
      edgeEls.forEach(function (l) { l.classList.remove("dim"); });
      var insp = document.getElementById("sxInspect"); if (insp) insp.innerHTML = ""; resetViewBox();
    });
    panZoom();
  }
  function resetViewBox() { if (animRAF) cancelAnimationFrame(animRAF); curVB = { x: 0, y: 0, w: 1000, h: 720 }; svg.setAttribute("viewBox", "0 0 1000 720"); }

  // ── pan + cmd/ctrl-wheel zoom + zoom buttons (design behavior) ──
  function panZoom() {
    var gEl = document.querySelector(".sx-graph"); if (!gEl) return;
    function setVB() { svg.setAttribute("viewBox", curVB.x + " " + curVB.y + " " + curVB.w + " " + curVB.h); }
    function clampW(w) { return Math.max(170, Math.min(2400, w)); }
    var dragging = false, moved = false, sx = 0, sy = 0, vb0 = null; svg.style.cursor = "grab";
    svg.addEventListener("mousedown", function (e) { if (e.target.closest(".gnode")) return; dragging = true; moved = false; sx = e.clientX; sy = e.clientY; vb0 = { x: curVB.x, y: curVB.y, w: curVB.w, h: curVB.h }; if (animRAF) cancelAnimationFrame(animRAF); svg.style.cursor = "grabbing"; e.preventDefault(); });
    window.addEventListener("mousemove", function (e) { if (!dragging) return; var rect = svg.getBoundingClientRect(); if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true; curVB.x = vb0.x - (e.clientX - sx) * (vb0.w / rect.width); curVB.y = vb0.y - (e.clientY - sy) * (vb0.h / rect.height); setVB(); });
    window.addEventListener("mouseup", function () { if (dragging) { dragging = false; svg.style.cursor = "grab"; } });
    svg.addEventListener("click", function (e) { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);
    svg.addEventListener("wheel", function (e) {
      if (!(e.metaKey || e.ctrlKey)) return; e.preventDefault(); if (animRAF) cancelAnimationFrame(animRAF);
      var rect = svg.getBoundingClientRect(); var mx = curVB.x + (e.clientX - rect.left) / rect.width * curVB.w, my = curVB.y + (e.clientY - rect.top) / rect.height * curVB.h;
      var nw = clampW(curVB.w * (e.deltaY > 0 ? 1.022 : 0.979)), nh = nw * (curVB.h / curVB.w);
      curVB.x = mx - (mx - curVB.x) * (nw / curVB.w); curVB.y = my - (my - curVB.y) * (nh / curVB.h); curVB.w = nw; curVB.h = nh; setVB();
    }, { passive: false });
    function zoomCenter(f) { if (animRAF) cancelAnimationFrame(animRAF); var cx = curVB.x + curVB.w / 2, cy = curVB.y + curVB.h / 2; var nw = clampW(curVB.w * f), nh = nw * (curVB.h / curVB.w); curVB.x = cx - nw / 2; curVB.y = cy - nh / 2; curVB.w = nw; curVB.h = nh; setVB(); }
    var zc = document.createElement("div"); zc.className = "map-zoom";
    zc.innerHTML = '<button type="button" class="mz" data-z="in" aria-label="Zoom in">+</button><button type="button" class="mz" data-z="out" aria-label="Zoom out">−</button><button type="button" class="mz mz-fit" data-z="fit" aria-label="Reset view">⤢</button>';
    gEl.appendChild(zc);
    zc.addEventListener("click", function (e) { var b = e.target.closest(".mz"); if (!b) return; if (b.dataset.z === "in") zoomCenter(0.8); else if (b.dataset.z === "out") zoomCenter(1.25); else resetViewBox(); });
  }

  // ── fill the Health hero + Dimensions + sticky subnav from /api/summary ──
  var C = 97.39; // circumference the design's small radials use (r=15.5)
  function sevClass(s) { return s < 35 ? "sev-hi" : s < 70 ? "sev-md" : "sev-ok"; }
  function ratingWord(s) { return s < 35 ? "Critical" : s < 70 ? "Caution" : "Healthy"; }
  function ratingCls(s) { return s < 35 ? "crit" : s < 70 ? "cau" : "good"; }
  function fillSummary(s) {
    var H2 = Math.round(s.healthScore != null ? s.healthScore : 0);
    var hs = document.querySelector(".health .score"); if (hs) hs.innerHTML = H2 + '<span class="den">/ 100</span>';
    var rt = document.querySelector(".health .rating"); if (rt) { rt.textContent = ratingWord(H2); rt.className = "rating " + ratingCls(H2); }
    var fill = document.querySelector(".health .rg-fill"); if (fill) { var c = 2 * Math.PI * 52; fill.style.strokeDasharray = (H2 / 100 * c).toFixed(1) + " " + c.toFixed(1); }
    var dims = s.dimensions || {};
    var cards = document.querySelectorAll(".loadgrid .lcard");
    [["honesty", 0], ["weight", 1], ["coverage", 2]].forEach(function (p) {
      var d = dims[p[0]], card = cards[p[1]]; if (!d || !card) return;
      var val = card.querySelector(".lc-val"); if (val) val.textContent = Math.round(d.score);
      card.classList.remove("sev-hi", "sev-md", "sev-ok"); card.classList.add(sevClass(d.score));
    });
    var navItem = document.querySelector("#subnav > .wrap.row .snav-item");
    if (navItem) {
      var nv = navItem.querySelector(".snav-v"); if (nv) nv.textContent = H2;
      navItem.classList.remove("sev-hi", "sev-md", "sev-ok"); navItem.classList.add(sevClass(H2));
      var nf = navItem.querySelector(".snav-radial .f"); if (nf) nf.setAttribute("stroke-dasharray", (H2 / 100 * C).toFixed(2) + " " + C);
    }
    var navRating = document.querySelector("#subnav .snav-rating"); if (navRating) { navRating.textContent = ratingWord(H2); navRating.className = "snav-rating " + (H2 < 35 ? "sev-red" : H2 < 70 ? "sev-amber" : "sev-ok"); }
    var extras = document.querySelectorAll("#snavExtra .snav-item");
    [["honesty", 0], ["weight", 1], ["coverage", 2]].forEach(function (p) {
      var d = dims[p[0]], it = extras[p[1]]; if (!d || !it) return;
      var v = it.querySelector(".snav-v"); if (v) v.textContent = Math.round(d.score);
      it.classList.remove("sev-hi", "sev-md", "sev-ok"); it.classList.add(sevClass(d.score));
      var f = it.querySelector(".snav-radial .f"); if (f) f.setAttribute("stroke-dasharray", (Math.min(100, d.score) / 100 * C).toFixed(2) + " " + C);
    });
  }

  // ── fill the left-rail stats / type-legend counts from /api/map ──
  function fillRail(map) {
    var nodeN = nodes.length, edgeN = L.length, tok = nodes.reduce(function (a, n) { return a + (n.tok || 0); }, 0);
    var dangling = (map && (map.danglingRefs || (map.findings && map.findings.dangling))) || [];
    var stats = document.querySelectorAll(".sx-stats .sx-stat .st-v");
    if (stats[0]) stats[0].textContent = tnum(nodeN);
    if (stats[1]) stats[1].textContent = tnum(edgeN);
    if (stats[2]) stats[2].textContent = tnum(tok);
    if (stats[3]) stats[3].textContent = tnum(dangling.length);
    var byType = {}; nodes.forEach(function (n) { byType[n.type] = (byType[n.type] || 0) + 1; });
    var LEGLABEL = { ai: "agent instruction", doc: "doc", pp: "product prompt", da: "dev-agent prompt", ms: "memory store", df: "derived flag", card: "card", eval: "eval", rt: "router tier", code: "code module", ci: "CI job" };
    var legTypes = document.getElementById("legTypes");
    if (legTypes) {
      legTypes.innerHTML = Object.keys(LEGLABEL).filter(function (k) { return byType[k]; }).map(function (k) {
        return '<span class="lg"><span class="sw" style="background:' + TYPE[k].c + '"></span>' + LEGLABEL[k] + ' <span class="n">' + byType[k] + "</span></span>";
      }).join("");
    }
  }
})();
