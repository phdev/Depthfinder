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
  var baseVB = { x: 0, y: 0, w: 1000, h: 720 }; // fitted to the laid-out nodes
  // Cancel any in-flight camera tween AND clear the speed-hint class. Routed
  // through here (not a bare cancelAnimationFrame) so an interrupting pan/zoom
  // can never leave `.sx-animating` — and its pointer-events:none — stuck on.
  function stopAnim() { if (animRAF) { cancelAnimationFrame(animRAF); animRAF = null; } if (svg) svg.classList.remove("sx-animating"); }

  function api(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }

  // ── boot ──
  Promise.all([api("/api/map"), api("/api/summary").catch(function () { return null; })])
    .then(function (res) {
      build(res[0]);
      if (res[1]) fillSummary(res[1]);
      buildHotspots(res[1] || {});
      fillFindings(res[0]);
      wireRailToggle();
    })
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
      // smaller radii than the design (its hubs were hand-placed; ours pack into a
      // dense real core) — keeps the high-degree nodes from overlapping
      var r = Math.max(5, Math.min(16, 5 + Math.sqrt(n.tokens || 0) / 4.2));
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
    setDefaultView();
  }

  // Default to a READABLE zoom rather than fitting every node (which made them
  // tiny). If the whole cloud already renders at a legible scale, keep the fit;
  // otherwise zoom to the readable floor centred on the cloud and let the user
  // pan / zoom-out to reach the periphery.
  function setDefaultView() {
    var rect = svg.getBoundingClientRect(), px = rect.width, py = rect.height;
    if (!px || !py) return;
    var fitScale = Math.min(px / baseVB.w, py / baseVB.h), minScale = 0.85;
    if (fitScale >= minScale) return;
    var ccx = baseVB.x + baseVB.w / 2, ccy = baseVB.y + baseVB.h / 2, vbw = px / minScale, vbh = py / minScale;
    baseVB = { x: ccx - vbw / 2, y: ccy - vbh / 2, w: vbw, h: vbh };
    curVB = { x: baseVB.x, y: baseVB.y, w: baseVB.w, h: baseVB.h };
    svg.setAttribute("viewBox", baseVB.x + " " + baseVB.y + " " + baseVB.w + " " + baseVB.h);
  }

  // ── force layout — tuned for REAL data (the design's hand-assigned clusters
  // aren't available, so spacing comes from stronger repulsion + a hard collision
  // pass + free spread, then the viewBox is fitted to the result so nothing is
  // cramped or clipped). Deterministic jitter → stable across reloads.
  var GAP = 22; // minimum clear space between any two node circles (label room)
  function layout() {
    var area = { w: 1180, h: 820 }; W = area.w; H = area.h;
    var cx = area.w / 2, cy = area.h / 2, R = Math.min(area.w, area.h) * 0.32;
    var order = ["core", "design", "code", "ci", "mem", "flags", "bottom"], seeds = {};
    order.forEach(function (c, i) { var a = (i / order.length) * Math.PI * 2; seeds[c] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
    var seed = 20251;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    nodes.forEach(function (n) { var s = seeds[n.cluster] || [cx, cy]; n.x = s[0] + (rnd() - 0.5) * 170; n.y = s[1] + (rnd() - 0.5) * 170; n.vx = 0; n.vy = 0; });
    // main force pass: moderate repulsion + soft collision + links. Kept COMPACT
    // on purpose — the de-overlap pass below guarantees separation, so we don't
    // need to blow the graph up (which made nodes tiny once fitted to view).
    for (var it = 0; it < 600; it++) {
      for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        var a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        var f = 3300 / d2, fx = f * dx / d, fy = f * dy / d; a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        var min = a.r + b.r + GAP;
        if (d < min) { var p = (min - d) * 0.6; a.vx += p * dx / d; a.vy += p * dy / d; b.vx -= p * dx / d; b.vy -= p * dy / d; }
      }
      L.forEach(function (l) { var a = byId[l.s], b = byId[l.t]; var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01; var f = (d - 100) * 0.02, fx = f * dx / d, fy = f * dy / d; a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy; });
      nodes.forEach(function (n) { n.vx += (cx - n.x) * 0.004; n.vy += (cy - n.y) * 0.004; n.x += Math.max(-9, Math.min(9, n.vx)); n.y += Math.max(-9, Math.min(9, n.vy)); n.vx *= 0.85; n.vy *= 0.85; });
    }
    // dedicated de-overlap: pure position push-apart until NO circles overlap
    // (the force pass leaves hubs touching; this guarantees clear separation).
    // pure push-apart until NO circles overlap. No radial clamp (that caused rim
    // whack-a-mole) — the strong centering above already keeps the cloud compact,
    // so this converges to the tightest overlap-free arrangement.
    for (var k = 0; k < 700; k++) {
      var any = false;
      for (var x = 0; x < nodes.length; x++) for (var y = x + 1; y < nodes.length; y++) {
        var a2 = nodes[x], b2 = nodes[y], ddx = a2.x - b2.x, ddy = a2.y - b2.y, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01, mn = a2.r + b2.r + GAP;
        if (dd < mn) { var sh = (mn - dd) / 2, ux = ddx / dd, uy = ddy / dd; a2.x += ux * sh; a2.y += uy * sh; b2.x -= ux * sh; b2.y -= uy * sh; any = true; }
      }
      if (!any) break;
    }
    // Widen the cloud to ~the container's landscape aspect so it FILLS the (now
    // full-width) canvas and the horizontal labels get more room. Stretching X
    // only grows gaps, so it can't introduce new overlaps.
    var sxs = nodes.map(function (n) { return n.x; }), sys = nodes.map(function (n) { return n.y; });
    var bcx = (Math.min.apply(null, sxs) + Math.max.apply(null, sxs)) / 2;
    var curAR = (Math.max.apply(null, sxs) - Math.min.apply(null, sxs)) / ((Math.max.apply(null, sys) - Math.min.apply(null, sys)) || 1);
    var TARGET_AR = 1.7;
    if (curAR < TARGET_AR) { var sxf = TARGET_AR / curAR; nodes.forEach(function (n) { n.x = bcx + (n.x - bcx) * sxf; }); }
    var xs = nodes.map(function (n) { return n.x; }), ys = nodes.map(function (n) { return n.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    // Tight fit (no aspect forcing) — the SVG's preserveAspectRatio="xMidYMid meet"
    // scales this to fill the area, so the node cloud renders as large as it can.
    var pad = 50;
    baseVB = { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
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
        var t = el("text", { x: n.x, y: n.y + n.r + 11, "text-anchor": "middle", "font-size": fs });
        // truncate long filenames so labels don't collide (full name in the
        // inspect panel on click)
        t.textContent = n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label;
        g.appendChild(c); g.appendChild(t);
      } else {
        // deg≤1 dot — show its (truncated) label too, dim so it stays secondary
        // to the hub labels; full name in the inspect panel on click.
        var td = el("text", { x: n.x, y: n.y + rr + 9, "text-anchor": "middle", "font-size": 8 });
        td.style.fill = "#6b7686";
        td.textContent = n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label;
        g.appendChild(c); g.appendChild(td);
      }
      g.addEventListener("click", function (e) { e.stopPropagation(); if (selectedId === n.id) deselect(); else select(n.id); });
      svg.appendChild(g); nodeEls.push(g);
    });
    svg.addEventListener("click", function () { deselect(); });
    curPos = {}; nodes.forEach(function (n) { curPos[n.id] = { x: n.x, y: n.y }; });
    curVB = { x: baseVB.x, y: baseVB.y, w: baseVB.w, h: baseVB.h };
    svg.setAttribute("viewBox", baseVB.x + " " + baseVB.y + " " + baseVB.w + " " + baseVB.h);
  }

  function neighbours(id) { var s = {}; s[id] = 1; L.forEach(function (l) { if (l.s === id) s[l.t] = 1; if (l.t === id) s[l.s] = 1; }); return s; }

  function animate(targetPos, vbT, dur) {
    stopAnim();
    // select()/deselect() only move the CAMERA (viewBox) — the nodes stay put.
    // Detect that here: if no node's target differs from where it already is, we
    // skip the ~113 node-transform + ~390 edge-attribute writes per frame and
    // tween ONLY the viewBox. Those per-frame writes were pure no-ops that still
    // forced the browser to repaint 200+ elements every frame → the zoom jitter.
    var start = {}, moves = false;
    nodeEls.forEach(function (g) {
      var id = g.dataset.id, o = byId[id], s = { x: curPos[id].x, y: curPos[id].y };
      start[id] = s;
      var tg = targetPos[id] || { x: o.x, y: o.y };
      if (Math.abs(tg.x - s.x) > 0.01 || Math.abs(tg.y - s.y) > 0.01) moves = true;
    });
    var vb0 = { x: curVB.x, y: curVB.y, w: curVB.w, h: curVB.h }, t0 = performance.now();
    // While moving, tell the browser it may rasterize for speed (crisp text is
    // restored the instant the tween settles) and skip hit-testing. Big help on
    // mobile Safari, where re-rastering 113 SVG text labels per frame is the cost.
    svg.classList.add("sx-animating");
    function step(now) {
      var p = Math.min(1, (now - t0) / (dur || 460)), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      if (moves) {
        nodeEls.forEach(function (g) { var id = g.dataset.id, o = byId[id]; var tg = targetPos[id] || { x: o.x, y: o.y }; var x = start[id].x + (tg.x - start[id].x) * e, y = start[id].y + (tg.y - start[id].y) * e; curPos[id] = { x: x, y: y }; g.style.transform = "translate(" + (x - o.x) + "px," + (y - o.y) + "px)"; });
        edgeEls.forEach(function (l) { var a = curPos[l.dataset.from], b = curPos[l.dataset.to]; if (a) { l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); } if (b) { l.setAttribute("x2", b.x); l.setAttribute("y2", b.y); } });
      }
      curVB = { x: vb0.x + (vbT.x - vb0.x) * e, y: vb0.y + (vbT.y - vb0.y) * e, w: vb0.w + (vbT.w - vb0.w) * e, h: vb0.h + (vbT.h - vb0.h) * e };
      svg.setAttribute("viewBox", curVB.x + " " + curVB.y + " " + curVB.w + " " + curVB.h);
      if (p < 1) { animRAF = requestAnimationFrame(step); }
      else { animRAF = null; svg.classList.remove("sx-animating"); }
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
    animate(orig, { x: baseVB.x, y: baseVB.y, w: baseVB.w, h: baseVB.h }, 460);
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
  function resetViewBox() { stopAnim(); curVB = { x: baseVB.x, y: baseVB.y, w: baseVB.w, h: baseVB.h }; svg.setAttribute("viewBox", baseVB.x + " " + baseVB.y + " " + baseVB.w + " " + baseVB.h); }

  // ── pan + cmd/ctrl-wheel zoom + zoom buttons (design behavior) ──
  function panZoom() {
    var gEl = document.querySelector(".sx-graph"); if (!gEl) return;
    function setVB() { svg.setAttribute("viewBox", curVB.x + " " + curVB.y + " " + curVB.w + " " + curVB.h); }
    function clampW(w) { return Math.max(170, Math.min(2400, w)); }
    var dragging = false, moved = false, sx = 0, sy = 0, vb0 = null; svg.style.cursor = "grab";
    svg.addEventListener("mousedown", function (e) { if (e.target.closest(".gnode")) return; dragging = true; moved = false; sx = e.clientX; sy = e.clientY; vb0 = { x: curVB.x, y: curVB.y, w: curVB.w, h: curVB.h }; stopAnim(); svg.style.cursor = "grabbing"; e.preventDefault(); });
    window.addEventListener("mousemove", function (e) { if (!dragging) return; var rect = svg.getBoundingClientRect(); if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true; curVB.x = vb0.x - (e.clientX - sx) * (vb0.w / rect.width); curVB.y = vb0.y - (e.clientY - sy) * (vb0.h / rect.height); setVB(); });
    window.addEventListener("mouseup", function () { if (dragging) { dragging = false; svg.style.cursor = "grab"; } });
    svg.addEventListener("click", function (e) { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);
    svg.addEventListener("wheel", function (e) {
      if (!(e.metaKey || e.ctrlKey)) return; e.preventDefault(); stopAnim();
      var rect = svg.getBoundingClientRect(); var mx = curVB.x + (e.clientX - rect.left) / rect.width * curVB.w, my = curVB.y + (e.clientY - rect.top) / rect.height * curVB.h;
      var nw = clampW(curVB.w * (e.deltaY > 0 ? 1.022 : 0.979)), nh = nw * (curVB.h / curVB.w);
      curVB.x = mx - (mx - curVB.x) * (nw / curVB.w); curVB.y = my - (my - curVB.y) * (nh / curVB.h); curVB.w = nw; curVB.h = nh; setVB();
    }, { passive: false });
    function zoomCenter(f) { stopAnim(); var cx = curVB.x + curVB.w / 2, cy = curVB.y + curVB.h / 2; var nw = clampW(curVB.w * f), nh = nw * (curVB.h / curVB.w); curVB.x = cx - nw / 2; curVB.y = cy - nh / 2; curVB.w = nw; curVB.h = nh; setVB(); }
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

  // ── Hotspots, wired to real /api/summary issues ──
  // The design's hidden hotspots table was a data source for an in-map sidebar +
  // per-hotspot highlight. Here that data comes from the REAL scan: each issue
  // already carries severity, title, detail, `tab` (1 Honesty / 2 Weight / 3
  // Coverage / 4 Drift) and `healthGain`. We anchor each to its real graph node
  // by fuzzy-matching the title/detail against node ids, then drive the design's
  // sidebar + node highlight + inspect detail from it. Nothing is fabricated.
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  var DIMLABEL = { 1: "Honesty", 2: "Weight", 3: "Coverage", 4: "Drift" };
  function gainDash(h) { var v = Math.max(0, Math.min(100, parseFloat(String(h).replace(/[^0-9.]/g, "")) || 0)); return (v / 100 * C).toFixed(2); }
  function findAnchor(h) {
    var hay = norm((h.title || "") + " " + (h.detail || "")), best = null, bestLen = 0;
    nodes.forEach(function (n) {
      [n.id, n.label].forEach(function (s) { var k = norm(s); if (k.length >= 5 && hay.indexOf(k) >= 0 && k.length > bestLen) { best = n.id; bestLen = k.length; } });
    });
    return best;
  }

  function wireRailToggle() {
    var rt = document.getElementById("sxRailToggle"), lay = document.querySelector(".sx-layout");
    if (!rt || !lay) return;
    rt.addEventListener("click", function () { var c = lay.classList.toggle("sx-collapsed"); rt.textContent = c ? "Show details" : "Hide details"; });
  }

  function renderHotspotDetail(it) {
    var box = document.getElementById("sxInspect"); if (!box) return;
    var acts = it.action ? '<div class="ins-acts"><div class="ins-acts-h">Suggested action</div><div class="ins-act"><span class="ia-n">1</span><span>' + esc(it.action) + "</span></div></div>" : "";
    var dim = it.dim ? '<div class="ins-row"><span class="k">Improves</span><span class="v"><b>' + esc(it.dim) + "</b></span></div>" : "";
    box.innerHTML =
      '<div class="ins-name">' + esc(it.name) + "</div>" +
      '<div class="ins-sevhealth"><span class="sev-badge ' + (it.sev === "high" ? "high" : "med") + '">' + (it.sev === "high" ? "High" : "Medium") + "</span>" +
      (it.health ? '<span class="nm-health"><span class="nmh-radial"><svg viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="15.5"></circle><circle class="f" cx="18" cy="18" r="15.5" stroke-dasharray="' + gainDash(it.health) + ' 97.39"></circle></svg></span>' + esc(it.health) + ' <span class="nmh-lab">health</span></span>' : "") +
      "</div>" +
      (it.detail ? '<div class="ins-note" style="border-top:none;padding-top:4px;margin-top:8px;">' + esc(it.detail) + "</div>" : "") +
      dim + acts;
  }

  function buildHotspots(summary) {
    var raw = (summary && (summary.hotspots || summary.issues)) || [];
    if (!raw.length) return;
    var items = raw.map(function (h, i) {
      var a = findAnchor(h);
      return {
        order: String(i + 1), name: h.title || ("Hotspot " + (i + 1)),
        sev: h.severity === "high" ? "high" : "med", detail: h.detail || "",
        health: h.healthGain ? ("+" + h.healthGain) : "", dim: DIMLABEL[h.tab] || "",
        action: h.action || "", anchorId: a, ids: a ? Object.keys(neighbours(a)) : [],
      };
    });
    var graphEl = document.querySelector(".sx-graph"); if (!graphEl) return;
    var side = document.createElement("aside"); side.className = "map-hs open";
    var hi = items.filter(function (x) { return x.sev === "high"; }).length, md = items.length - hi;
    var head = document.createElement("button"); head.type = "button"; head.className = "map-hs-head";
    head.innerHTML = '<span class="mh-t">Hotspots <span class="mh-n high">' + hi + " high</span>" + (md ? '<span class="mh-n med">' + md + " medium</span>" : "") + '</span><span class="mh-x">‹</span>';
    var list = document.createElement("div"); list.className = "map-hs-list";
    var firstBtn = null;
    items.forEach(function (it) {
      var b = document.createElement("button"); b.type = "button"; b.className = "map-hs-item";
      b.innerHTML = '<span class="mh-ord">' + it.order + '</span><span class="mh-name">' + esc(it.name) + '</span><span class="mh-dot ' + it.sev + '"></span>';
      b.addEventListener("click", function () {
        list.querySelectorAll(".map-hs-item.on").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        if (it.anchorId && byId[it.anchorId]) select(it.anchorId); else deselect();
        renderHotspotDetail(it);
      });
      list.appendChild(b);
      if (!firstBtn) firstBtn = b;
    });
    head.addEventListener("click", function () { var o = side.classList.toggle("open"); head.querySelector(".mh-x").textContent = o ? "‹" : "›"; });
    side.appendChild(head); side.appendChild(list);
    var col = document.createElement("div"); col.className = "sx-hs-col"; col.appendChild(side);
    var insp = document.getElementById("sxInspect"); if (insp) col.appendChild(insp);
    graphEl.appendChild(col);
    // (No auto-select — show the full, spaced graph on load; the design auto-
    // focused the top hotspot, which zoomed into one cluster and dimmed the rest.)
    svg.addEventListener("click", function () { list.querySelectorAll(".map-hs-item.on").forEach(function (x) { x.classList.remove("on"); }); });
  }

  // real dangling references → the rail's "Dangling references" panel
  function fillFindings(map) {
    var dangling = (map && map.danglingRefs) || [];
    document.querySelectorAll(".sx-rail .sx-find").forEach(function (d) {
      var sum = d.querySelector("summary"); if (!sum || !/dangling/i.test(sum.textContent)) return;
      var fc = sum.querySelector(".fc"); if (fc) fc.textContent = String(dangling.length);
      var body = d.querySelector(".fbody"); if (!body) return;
      body.innerHTML = dangling.length
        ? dangling.slice(0, 12).map(function (r) { return '<div class="fitem"><b>' + esc(r.source || r.from || "") + "</b> → " + esc(r.path || r.to || "") + "</div>"; }).join("")
        : '<div class="fitem">No dangling references — every doc path resolves.</div>';
    });
  }
})();
