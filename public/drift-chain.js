/* ============================================================
   DEPTHFINDER — Drift page ("Drift chain")
   Ports the design's Surface→Claims→Target→Resolves chain, wired to
   REAL scan data — nothing fabricated:
     /api/map      → danglingRefs + duplicate edges  → the chain
     /api/summary  → health, dimensions, hotspots (issues)
     /api/drift    → Packmind context-evaluator install state
   A "drift finding" = a real doc↔code/doc↔doc mismatch (a dead ref or a
   duplicated block). Hotspots from other dimensions are shown italic and
   point at the view that owns them.
   ============================================================ */
(function () {
  "use strict";
  var C = 97.39;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function base(p) { p = String(p || ""); var i = p.lastIndexOf("/"); return i >= 0 ? p.slice(i + 1) : p; }
  function sevClass(s) { return s < 35 ? "sev-hi" : s < 70 ? "sev-md" : "sev-ok"; }
  function ratingWord(s) { return s < 35 ? "Critical" : s < 70 ? "Caution" : "Healthy"; }
  function ratingCls(s) { return s < 35 ? "crit" : s < 70 ? "cau" : "good"; }

  var eli = true, selected = null;
  var LINKS = [], BAD = {}, DETAIL = {}, GOTO = {};
  var GOTOURL = { "Context Map": "/#context", "Token Currents": "/#tokens", "Protection Chain": "/#evals" };
  var ELI_BY_TAB = {
    1: "The docs and the code disagree here, so a reader (or the agent) could be misled.",
    2: "This loads into the agent every turn, so it costs time and money on every call.",
    3: "A rule or check meant to run automatically isn't wired into CI yet.",
    4: "The off-machine evaluator that finds deeper drift isn't set up yet.",
  };

  // ── Health hero + Dimensions, from /api/summary ──
  function fillSummary(s) {
    var H = Math.round(s.healthScore != null ? s.healthScore : 0);
    var hEl = document.querySelector(".health");
    if (hEl) { hEl.classList.remove("rt-crit", "rt-caution", "rt-healthy"); hEl.classList.add(H < 35 ? "rt-crit" : H < 70 ? "rt-caution" : "rt-healthy"); }
    var hs = document.querySelector(".health .score");
    if (hs) hs.innerHTML = H + '<span class="den">/ 100</span>';
    var rt = document.querySelector(".health .rating");
    if (rt) { rt.textContent = ratingWord(H); rt.className = "rating " + ratingCls(H); }
    var fill = document.querySelector(".health .rg-fill");
    if (fill) { var c = 2 * Math.PI * 52; fill.style.strokeDasharray = (H / 100 * c).toFixed(1) + " " + c.toFixed(1); }
    var radial = document.querySelector(".health .radial");
    if (radial) radial.setAttribute("aria-label", "Overall health " + H + " of 100");
    var dims = s.dimensions || {}, cards = document.querySelectorAll(".loadgrid .lcard");
    [["honesty", 0], ["weight", 1], ["coverage", 2]].forEach(function (p) {
      var d = dims[p[0]] || (p[0] === "honesty" ? dims.coherence : null), card = cards[p[1]];
      if (!d || !card) return;
      var val = card.querySelector(".lc-val"); if (val) val.textContent = Math.round(d.score);
      card.classList.remove("sev-hi", "sev-md", "sev-ok"); card.classList.add(sevClass(d.score));
    });
  }

  // ── build the chain columns from REAL map data ──
  function pcNode(id, inner, cls) { return '<div class="pc-node' + (cls ? " " + cls : "") + '" data-id="' + id + '">' + inner + "</div>"; }
  function det(id, o) { DETAIL[id] = o; }

  function buildChain(map, summary) {
    var dangling = (map && map.danglingRefs) || [];
    var dupEdges = ((map && map.edges) || []).filter(function (e) { return e.type === "duplicates"; });
    var surf = [], claim = [], targ = [], res = [];
    LINKS = []; BAD = {}; DETAIL = {}; GOTO = {};
    var surfaceFor = {}; // hotspot-keyword → first surface id (for hotspot links)

    // ---- dangling references: one surface per source doc, a row per ref ----
    var bySource = {};
    dangling.forEach(function (d) { (bySource[d.source] = bySource[d.source] || []).push(d.path); });
    Object.keys(bySource).forEach(function (src, si) {
      var sid = "s-d" + si, paths = bySource[src];
      surf.push(pcNode(sid, '<span class="pc-path">' + esc(src) + '</span><span class="pc-sub">doc · ' + paths.length + " path ref" + (paths.length > 1 ? "s" : "") + "</span>"));
      if (!surfaceFor.dangle) surfaceFor.dangle = sid;
      det(sid, { name: src, sev: "med",
        desc: "This surface references " + paths.length + " path" + (paths.length > 1 ? "s" : "") + " that don't resolve on disk.",
        descEli: "This note points at " + paths.length + " file" + (paths.length > 1 ? "s" : "") + " that aren't there.",
        whyLab: "Why", why: "Repoint or remove the dead links; add a dangling-reference lint so CI catches the next one.",
        whyEli: "Point it at files that exist, or drop the link.",
        acts: ["Update or remove the dead reference" + (paths.length > 1 ? "s" : "") + ".", "Add a dangling-reference lint (doc paths that don't resolve on disk)."] });
      paths.forEach(function (path, pi) {
        var cid = "cl-d" + si + "_" + pi, tid = "t-d" + si + "_" + pi, rid = "rs-d" + si + "_" + pi;
        claim.push(pcNode(cid, '<span class="pc-claim">references ' + esc(path) + "</span>"));
        targ.push(pcNode(tid, '<span class="pc-path">' + esc(path) + "</span>"));
        res.push(pcNode(rid, '<div class="pc-resolve"><span class="rx bad">✕</span><span class="pc-nm">does not resolve</span></div><span class="pc-sub">not found on disk</span>', "pc-gap"));
        LINKS.push([sid, cid], [cid, tid], [tid, rid]);
        BAD[tid + ">" + rid] = 1;
        det(cid, { name: "references " + base(path), sev: "med", desc: esc(src) + " links " + path + ".", descEli: "It points at " + base(path) + ".", whyLab: "Target", why: "The path doesn't resolve on disk.", whyEli: "That path isn't found.", acts: [] });
        det(tid, { name: path, sev: "med", desc: "Referenced path is not present in the repo.", descEli: "A path that isn't in the repo.", whyLab: "Resolves", why: "✕ does not resolve.", whyEli: "It leads nowhere.", acts: [] });
        det(rid, { name: "✕ does not resolve", sev: "med",
          desc: "The referenced path is not on disk — the reference is dead.", descEli: "Nobody can open this file.",
          whyLab: "Fix", why: "Repoint to a real path (or remove it) and add a dangling-reference lint.", whyEli: "Use a path that exists, or delete the link.",
          acts: ["Repoint or remove the dead reference.", "Add a dangling-reference lint."] });
      });
    });

    // ---- duplicate blocks: source ↔ target, one chain per pair ----
    dupEdges.forEach(function (e, di) {
      var sid = "s-u" + di, cid = "cl-u" + di, tid = "t-u" + di, rid = "rs-u" + di;
      var blocks = (e.meta && e.meta.sharedBlocks) || 1;
      surf.push(pcNode(sid, '<span class="pc-path">' + esc(e.source) + '</span><span class="pc-sub">doc · duplicated block</span>'));
      claim.push(pcNode(cid, '<span class="pc-claim">shares ' + blocks + " block" + (blocks > 1 ? "s" : "") + " verbatim with " + esc(base(e.target)) + "</span>"));
      targ.push(pcNode(tid, '<span class="pc-path">' + esc(e.target) + '</span><span class="pc-sub pc-dup">duplicate — should link</span>'));
      res.push(pcNode(rid, '<div class="pc-resolve"><span class="rx bad">✕</span><span class="pc-nm">duplicate — should link</span></div><span class="pc-sub">copies diverge independently</span>', "pc-gap"));
      LINKS.push([sid, cid], [cid, tid], [tid, rid]);
      BAD[tid + ">" + rid] = 1;
      if (!surfaceFor.dup) surfaceFor.dup = sid;
      det(sid, { name: e.source, sev: "med", desc: "Shares " + blocks + " block" + (blocks > 1 ? "s" : "") + " verbatim with " + e.target + ".", descEli: "The same text lives in two files.", whyLab: "Why", why: "Keep one canonical copy; replace the other with a link; add a duplication lint.", whyEli: "Keep it in one place and point the other at it.", acts: ["Keep one canonical copy of the shared block.", "Replace the duplicate with a one-line link.", "Add a CI lint that fails on verbatim re-duplication."] });
      det(cid, { name: "shared block × 2 files", sev: "med", desc: "The same block appears verbatim in both files; copies drift independently.", descEli: "The same words are pasted into two files and slowly stop matching.", whyLab: "Target", why: "Fans out to a second file that should just link.", whyEli: "It spreads to a file that should link instead.", acts: [] });
      det(tid, { name: e.target, sev: "med", desc: "Holds a verbatim copy of the shared block.", descEli: "A second copy of the same text.", whyLab: "Resolves", why: "✕ duplicate — should link to the canonical source.", whyEli: "This copy should just point at the original.", acts: [] });
      det(rid, { name: "✕ duplicate — should link", sev: "med", desc: "One of the copies should be replaced with a link to the canonical source.", descEli: "Keep one, link the rest.", whyLab: "Fix", why: "Collapse to one canonical file; link the duplicate; add a duplication lint.", whyEli: "Keep one copy and link the other.", acts: ["Pick the canonical copy.", "Replace the duplicate with a link.", "Add a CI duplication lint."] });
    });

    // empty state
    if (!surf.length) {
      surf.push('<div class="pc-sub" style="padding:8px 2px;color:var(--pos)">✓ No doc↔code drift detected — every reference resolves and no blocks are duplicated.</div>');
    }
    $("colSurface").innerHTML = '<div class="pc-colh">Surface</div>' + surf.join("");
    $("colClaims").innerHTML = '<div class="pc-colh">Claims</div>' + claim.join("");
    $("colTarget").innerHTML = '<div class="pc-colh">Target</div>' + targ.join("");
    $("colResolves").innerHTML = '<div class="pc-colh">Resolves</div>' + res.join("");

    buildHotspots(summary, surfaceFor);
  }

  // ── hotspots column (real issues), drift-classified ──
  function classify(it, surfaceFor) {
    var s = ((it.title || "") + " " + (it.detail || "")).toLowerCase();
    if (it.tab === 1 && /dangling|dead ref|stale|outdated|resolve|references/.test(s) && surfaceFor.dangle) return { drift: true, surface: surfaceFor.dangle };
    if (it.tab === 1 && /duplicat|doc block|boundary|copies/.test(s) && surfaceFor.dup) return { drift: true, surface: surfaceFor.dup };
    return { drift: false, goto: ({ 1: "Context Map", 2: "Token Currents", 3: "Protection Chain" })[it.tab] || null };
  }
  function buildHotspots(summary, surfaceFor) {
    var hs = $("dcHs"); if (!hs) return;
    var raw = (summary && (summary.hotspots || summary.issues)) || [];
    var items = raw.map(function (it, i) {
      var c = classify(it, surfaceFor);
      var id = "h-" + i;
      var sev = it.severity === "high" ? "high" : "med";
      GOTO[id] = c.drift ? null : c.goto;
      det(id, {
        name: it.title || "Hotspot " + (i + 1), sev: sev, health: it.healthGain ? "▲" + it.healthGain : "",
        desc: it.detail || "", descEli: ELI_BY_TAB[it.tab] || "Cleaning this up keeps the agent's context honest.",
        whyLab: c.drift ? "Drift finding" : "Not a Drift finding", why: it.action || "", whyEli: it.action || "",
        acts: it.action ? [it.action] : [], notFinding: !c.drift, gotoName: c.goto,
      });
      if (c.drift && c.surface) LINKS.push([id, c.surface]);
      return { id: id, o: i + 1, name: it.title || "Hotspot " + (i + 1), sev: sev, drift: c.drift };
    });
    var hi = items.filter(function (x) { return x.sev === "high"; }).length, md = items.length - hi;
    var head = '<button class="map-hs-head" type="button"><span class="mh-t">Hotspots <span class="mh-n high">' + hi + " high</span>" + (md ? '<span class="mh-n med">' + md + " medium</span>" : "") + '</span><span class="mh-x">‹</span></button>';
    var list = '<div class="map-hs-list">' + items.map(function (it) {
      return '<button class="map-hs-item pc-node' + (it.drift ? "" : " not-finding") + '" type="button" data-id="' + it.id + '"><span class="mh-ord">' + it.o + '</span><span class="mh-name">' + esc(it.name) + '</span><span class="mh-dot ' + it.sev + '"></span></button>';
    }).join("") + "</div>";
    hs.innerHTML = head + list;
    var hd = hs.querySelector(".map-hs-head");
    if (hd) hd.addEventListener("click", function (e) { e.stopPropagation(); var o = hs.classList.toggle("open"); hd.querySelector(".mh-x").textContent = o ? "‹" : "›"; });
    // first drift-finding hotspot for auto-select
    var firstDrift = items.filter(function (x) { return x.drift; })[0];
    window.__dcFirst = firstDrift ? firstDrift.id : (items[0] && items[0].id);
  }

  // ── ribbons + chain highlight (ported from the design) ──
  function nodeEls() { return [].slice.call(document.querySelectorAll(".pc-node")); }
  function draw(active) {
    var svg = $("pcRibbons"); if (!svg) return;
    var sb = svg.getBoundingClientRect(); if (!sb.width) return;
    svg.setAttribute("viewBox", "0 0 " + sb.width + " " + sb.height);
    var pos = {};
    nodeEls().forEach(function (n) { var r = n.getBoundingClientRect(); pos[n.dataset.id] = { l: r.left - sb.left, rt: r.right - sb.left, y: r.top + r.height / 2 - sb.top }; });
    var html = "";
    LINKS.forEach(function (lk) {
      var a = pos[lk[0]], b = pos[lk[1]]; if (!a || !b) return;
      var on = active && active[lk[0]] && active[lk[1]], bad = BAD[lk[0]+ ">" + lk[1]];
      var x1 = a.rt, x2 = b.l, mx = (x1 + x2) / 2;
      var stroke = on ? (bad ? "rgba(255,84,104,.9)" : "rgba(255,255,255,.9)") : (bad ? "rgba(255,84,104,.26)" : "rgba(150,160,175,.15)");
      var w = on ? 2.2 : 1.1;
      html += '<path d="M' + x1 + " " + a.y + " C " + mx + " " + a.y + " " + mx + " " + b.y + " " + x2 + " " + b.y + '" stroke="' + stroke + '" stroke-width="' + w + '" fill="none" />';
    });
    svg.innerHTML = html;
  }
  function chainFrom(id) {
    var set = {}; set[id] = 1; var changed = true;
    while (changed) { changed = false; LINKS.forEach(function (lk) { if (set[lk[0]] && !set[lk[1]]) { set[lk[1]] = 1; changed = true; } if (set[lk[1]] && !set[lk[0]]) { set[lk[0]] = 1; changed = true; } }); }
    return set;
  }
  function apply() {
    var active = selected ? chainFrom(selected) : null;
    nodeEls().forEach(function (n) { n.classList.toggle("sel", selected === n.dataset.id); n.classList.toggle("dim", !!active && !active[n.dataset.id]); });
    draw(active); renderDetail(selected);
  }

  function renderDetail(id) {
    var box = $("dcDetail"); if (!box) return;
    var it = DETAIL[id];
    if (!it) { box.classList.remove("show"); box.innerHTML = ""; return; }
    var desc = (eli && it.descEli) ? it.descEli : it.desc;
    var why = (eli && it.whyEli) ? it.whyEli : it.why;
    var sevCls = it.sev === "ok" ? "ok" : (it.sev === "high" ? "high" : "med");
    var sevTxt = it.sev === "ok" ? "Resolved" : (it.sev === "high" ? "High" : "Medium");
    var hv = parseFloat(String(it.health || "").replace(/[^0-9.]/g, "")) || 0;
    var acts = it.acts && it.acts.length ? '<div class="ins-acts"><div class="ins-acts-h">Suggested actions</div>' +
      it.acts.map(function (a, i) { return '<div class="ins-act"><span class="ia-n">' + (i + 1) + "</span><span>" + esc(a) + "</span></div>"; }).join("") + "</div>" : "";
    var gotoHtml = it.notFinding ? '<div class="ins-notfinding-top">Not a Drift finding — go to ' + (it.gotoName && GOTOURL[it.gotoName] ? '<a href="' + GOTOURL[it.gotoName] + '" target="_parent" class="goto-link">' + esc(it.gotoName) + "</a>" : esc(it.gotoName || "the relevant view")) + "</div>" : "";
    box.innerHTML =
      gotoHtml +
      '<div class="ins-name">' + esc(it.name) + "</div>" +
      '<div class="ins-sevhealth"><span class="sev-badge ' + sevCls + '">' + sevTxt + "</span>" +
      (it.health ? '<span class="nm-health"><span class="nmh-radial"><svg viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="15.5"></circle><circle class="f" cx="18" cy="18" r="15.5" stroke-dasharray="' + (Math.min(100, hv) / 100 * C).toFixed(2) + ' 97.39"></circle></svg></span>' + esc(it.health) + ' <span class="nmh-lab">health</span></span>' : "") + "</div>" +
      (desc ? '<div class="ins-note" style="border-top:none;padding-top:4px;margin-top:8px;">' + esc(desc) + "</div>" : "") +
      (!it.notFinding && why ? '<div class="ins-why"><span class="iw-lab">' + esc(it.whyLab || "Why") + "</span>" + esc(why) + "</div>" : "") +
      acts;
    box.classList.add("show");
  }

  function wireChain() {
    nodeEls().forEach(function (n) { n.addEventListener("click", function (e) { e.stopPropagation(); selected = (selected === n.dataset.id) ? null : n.dataset.id; apply(); }); });
    var wrap = document.querySelector(".pchain");
    if (wrap) wrap.addEventListener("click", function () { selected = null; apply(); });
    window.addEventListener("resize", function () { apply(); });
  }

  // ── Packmind context-evaluator section, from /api/drift ──
  function buildPackmind(d) {
    var box = $("pkmBody"); if (!box) return;
    d = d || {};
    if (d.installed && (d.status === "running" || d.status === "started")) {
      box.innerHTML = '<div class="pkm-warn" style="color:var(--accent)">Packmind context-evaluator is running… (1–3 min)</div><p class="pkm-desc">It drives your installed AI agent over the repo. Reload this tab when it finishes.</p><div><button class="pkm-recheck" type="button" id="pkmRecheck">↻ Check status</button></div>';
    } else if (d.installed && d.result) {
      box.innerHTML = '<div class="pkm-warn" style="color:var(--pos)">Packmind context-evaluator ran.</div><pre class="pkm-desc" style="white-space:pre-wrap">' + esc(typeof d.result === "string" ? d.result : JSON.stringify(d.result, null, 2)).slice(0, 4000) + '</pre><div><button class="pkm-recheck" type="button" id="pkmRecheck">↻ Re-run</button></div>';
    } else if (d.installed) {
      box.innerHTML = '<div class="pkm-warn" style="color:var(--pos)">Packmind context-evaluator is installed (' + esc(d.method || "ready") + ').</div><p class="pkm-desc">' + esc((d.instructions && d.instructions.summary) || "Run it to drive your AI agent over the repo (1–3 min, costs API tokens).") + '</p><div><button class="pkm-recheck" type="button" id="pkmRun">↻ Run drift</button></div>';
    } else {
      var ins = d.instructions || {};
      var cards = (ins.options || []).map(function (o) {
        return '<div class="pkm-card"><div class="pkm-card-h">' + esc(o.label) + '</div><ol class="pkm-steps">' +
          (o.steps || []).map(function (st) { return '<li><span class="pkm-code">' + esc(st) + "</span></li>"; }).join("") + "</ol></div>";
      }).join("");
      box.innerHTML =
        '<div class="pkm-warn">' + esc(d.message || "Packmind context-evaluator is not installed.") + "</div>" +
        '<p class="pkm-desc">' + esc(ins.summary || "") + "</p>" +
        '<div class="pkm-cards">' + cards + "</div>" +
        '<p class="pkm-then">Then click Run drift, or run: <span class="pkm-code">npm run drift:refresh</span></p>' +
        (ins.repoUrl ? '<a class="pkm-link" href="' + esc(ins.repoUrl) + '" target="_blank" rel="noopener">' + esc(ins.repoUrl) + "</a>" : "") +
        '<div><button class="pkm-recheck" type="button" id="pkmRecheck">↻ Re-check installation</button></div>';
    }
    var rc = $("pkmRecheck");
    if (rc) rc.addEventListener("click", function () { fetch("/api/drift").then(function (r) { return r.json(); }).then(buildPackmind); });
    var run = $("pkmRun");
    if (run) run.addEventListener("click", function () { run.disabled = true; run.textContent = "Starting…"; fetch("/api/refresh/drift", { method: "POST" }).then(function (r) { return r.json(); }).then(buildPackmind); });
  }

  // ── boot ──
  function boot() {
    Promise.all([
      fetch("/api/map").then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch("/api/summary").then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch("/api/drift").then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (res) {
      var map = res[0], summary = res[1], drift = res[2];
      if (summary) fillSummary(summary);
      if (map) buildChain(map, summary || {});
      buildPackmind(drift);
      wireChain();
      draw(null);
      setTimeout(function () { if (window.__dcFirst) { selected = window.__dcFirst; apply(); } else draw(null); }, 80);
      setTimeout(function () { apply(); }, 260);
      var dcEli = $("dcEli10");
      if (dcEli) { eli = dcEli.checked; dcEli.addEventListener("change", function () { eli = dcEli.checked; if (selected) renderDetail(selected); }); }
      // tell the embedding Summary the view has rendered (so it can drop the skeleton)
      var dfReady = function () { try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "df-embed-ready" }, location.origin); } catch (e) {} };
      dfReady(); // fire immediately (microtask priority, not a throttled timer)
      requestAnimationFrame(function () { requestAnimationFrame(dfReady); });
      setTimeout(dfReady, 600);
    });
    var burger = document.querySelector(".burger"), navTabs = document.querySelector(".nav-tabs");
    if (burger && navTabs) burger.addEventListener("click", function () { var o = navTabs.classList.toggle("open"); burger.classList.toggle("is-open", o); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // ── global ELI10 sync (df_eli10) ──
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
