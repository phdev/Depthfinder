/* ============================================================
   DEPTHFINDER — Evals page ("Protection chain")
   Ports the design's Rules→Artifacts→Enforcement chain, wired to
   REAL scan data — nothing fabricated:
     /api/coverage → rules[], each with protects[] (gate/test, inCI)
     /api/summary  → health, dimensions, hotspots (issues)
   A "protection finding" = a rule whose gate/test isn't enforced in CI.
   Rules already protected-in-CI appear under "Satisfied protections".
   ============================================================ */
(function () {
  "use strict";
  var C = 97.39;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function base(p) { p = String(p || ""); var i = p.lastIndexOf("/"); return i >= 0 ? p.slice(i + 1) : p; }
  function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""); }
  function sevClass(s) { return s < 35 ? "sev-hi" : s < 70 ? "sev-md" : "sev-ok"; }
  function ratingWord(s) { return s < 35 ? "Critical" : s < 70 ? "Caution" : "Healthy"; }
  function ratingCls(s) { return s < 35 ? "crit" : s < 70 ? "cau" : "good"; }

  var eli = true, selected = null;
  var LINKS = [], BAD = {}, DETAIL = {}, GOTO = {};
  var GOTOURL = { "Context Map": "/#context", "Token Currents": "/#tokens", "Drift Chain": "/#drift" };
  // plain-language rule names (ELI10) — keyed by the real rule id
  var RULE_ELI = {
    deterministic_slice_replayable: "Same input always gives the same result",
    enhance_not_decide: "AI can polish wording but can't make decisions",
    visibility_is_derived_only: "What shows on screen is computed, never hardcoded",
    reminder_timing_deterministic: "Reminder times are fixed math, not guesses",
  };
  var ELI_BY_TAB = {
    1: "The docs and the code disagree here, so a reader (or the agent) could be misled.",
    2: "This loads into the agent every turn, so it costs time and money on every call.",
    3: "A rule or check meant to run automatically isn't wired into CI yet.",
    4: "What the notes say has drifted from what the code actually does.",
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

  function pcNode(id, inner, cls) { return '<div class="pc-node' + (cls ? " " + cls : "") + '" data-id="' + id + '">' + inner + "</div>"; }
  function det(id, o) { DETAIL[id] = o; }

  // ── build the Rules → Artifacts → Enforcement chain from /api/coverage ──
  function buildChain(cov, summary) {
    var rules = (cov && cov.rules) || [];
    LINKS = []; BAD = {}; DETAIL = {}; GOTO = {};
    var ruleCol = [], artCol = [], enfCol = [], artMap = {}, ruleNodeFor = {}, anyCI = false, anyGap = false;

    rules.forEach(function (r) {
      var rid = "r-" + slug(r.id), ok = r.status === "protected-in-ci";
      ruleNodeFor[r.id] = rid;
      ruleCol.push(pcNode(rid, '<span class="pc-nm" data-rule="' + esc(r.id) + '">' + esc(r.id) + "</span>"));
      det(rid, ruleDetail(r, ok));
      (r.protects || []).forEach(function (p) {
        var a = artMap[p.artifact];
        if (!a) { a = { id: "a-" + slug(p.artifact), kind: p.kind, inCI: !!p.inCI, ciJobs: (p.ciJobs || []).slice(), rules: [], artifact: p.artifact }; artMap[p.artifact] = a; }
        a.inCI = a.inCI || !!p.inCI;
        (p.ciJobs || []).forEach(function (j) { if (a.ciJobs.indexOf(j) < 0) a.ciJobs.push(j); });
        if (a.rules.indexOf(r.id) < 0) a.rules.push(r.id);
        LINKS.push([rid, a.id]);
        if (!p.inCI) BAD[rid + ">" + a.id] = 1;
      });
    });

    Object.keys(artMap).forEach(function (k) {
      var a = artMap[k];
      var kindTag = a.kind === "gate" ? '<span class="kind gate">Gate</span>' : '<span class="kind">Test</span>';
      artCol.push(pcNode(a.id, '<span class="pc-nm">' + esc(base(a.artifact)) + "</span>" + kindTag));
      det(a.id, artDetail(a));
      if (a.inCI) { anyCI = true; LINKS.push([a.id, "c-ci"]); }
      else { anyGap = true; LINKS.push([a.id, "c-gap"]); BAD[a.id + ">c-gap"] = 1; }
    });

    if (anyGap) {
      enfCol.push(pcNode("c-gap", '<span class="pc-nm">Not in CI</span><span class="pc-meta">runs in no workflow</span>', "pc-gap"));
      det("c-gap", { name: "Not in CI", sev: "high", desc: "These artifacts exist but run in no CI workflow, so the rule they protect is ungoverned on merge.", descEli: "The check exists but never runs automatically.", whyLab: "Fix", why: "Add it as a blocking job so the build fails when the invariant breaks.", whyEli: "Wire it into CI so it runs on every merge.", acts: ["Add the gate/eval as a blocking CI job."] });
    }
    if (anyCI) {
      enfCol.push(pcNode("c-ci", '<span class="pc-nm">In CI</span><span class="pc-meta">enforced on merge</span>'));
      det("c-ci", { name: "In CI", sev: "ok", desc: "These artifacts run in CI on merge, so the rules they protect are enforced.", descEli: "These checks run automatically on every merge.", whyLab: "Status", why: "Enforced — no action needed.", whyEli: "Already covered — nothing to do here.", acts: [] });
    }

    $("colRules").innerHTML = '<div class="pc-colh">Rules</div>' + (ruleCol.join("") || '<div class="pc-sub" style="padding:8px 2px;color:var(--ink-3)">No rules declared.</div>');
    $("colArtifacts").innerHTML = '<div class="pc-colh">Artifacts</div>' + artCol.join("");
    $("colEnforce").innerHTML = '<div class="pc-colh">Enforcement</div>' + enfCol.join("");

    buildHotspots(summary, rules, ruleNodeFor);
    buildSatisfied(rules, ruleNodeFor);
  }

  function ruleDetail(r, ok) {
    return {
      name: r.id, sev: ok ? "ok" : (r.severity === "critical" ? "high" : "med"),
      desc: r.description || "", descEli: RULE_ELI[r.id] || r.description || "",
      whyLab: ok ? "Status" : "Fix",
      why: ok ? "Protected · in CI — no action needed." : "No CI enforcement yet — wire its gate/test into a workflow.",
      whyEli: ok ? "Already covered — nothing to do here." : "Add its check to CI so it runs automatically.",
      acts: ok ? [] : ["Add the protecting gate/eval as a blocking CI job."],
    };
  }
  function artDetail(a) {
    var rl = a.rules.join(", ");
    return {
      name: base(a.artifact), sev: a.inCI ? "ok" : (a.kind === "gate" ? "high" : "med"),
      desc: (a.kind === "gate" ? "Gate" : "Test") + " protecting " + rl + ". " + (a.inCI ? ("Runs in CI" + (a.ciJobs.length ? " (" + a.ciJobs.join(", ") + ")" : "") + ".") : "Not in any workflow."),
      descEli: a.inCI ? "This check runs automatically and guards " + rl + "." : "This check exists but never runs automatically.",
      whyLab: a.inCI ? "Status" : "Fix", why: a.inCI ? "Enforced in CI." : "Wire it into a workflow.", whyEli: a.inCI ? "Already running." : "Add it to CI.",
      acts: a.inCI ? [] : ["Add " + base(a.artifact) + " to a CI workflow."],
    };
  }

  // ── hotspots column (real issues), protection-classified ──
  function classify(it, rules, ruleNodeFor) {
    if (it.tab === 3) {
      var gap = rules.filter(function (r) { return r.status !== "protected-in-ci"; })[0];
      if (gap) return { prot: true, rule: ruleNodeFor[gap.id] };
    }
    return { prot: false, goto: ({ 1: "Drift Chain", 2: "Token Currents", 4: "Drift Chain" })[it.tab] || null };
  }
  function buildHotspots(summary, rules, ruleNodeFor) {
    var hs = $("pcHs"); if (!hs) return;
    var raw = (summary && (summary.hotspots || summary.issues)) || [];
    var items = raw.map(function (it, i) {
      var c = classify(it, rules, ruleNodeFor), id = "h-" + i, sev = it.severity === "high" ? "high" : "med";
      det(id, {
        name: it.title || "Hotspot " + (i + 1), sev: sev, health: it.healthGain ? "▲" + it.healthGain : "",
        desc: it.detail || "", descEli: ELI_BY_TAB[it.tab] || "Cleaning this up keeps the agent's context honest.",
        whyLab: c.prot ? "Protection finding" : "Not a Protection finding", why: it.action || "", whyEli: it.action || "",
        acts: it.action ? [it.action] : [], notFinding: !c.prot, gotoName: c.goto,
      });
      if (c.prot && c.rule) LINKS.push([id, c.rule]);
      return { id: id, o: i + 1, name: it.title || "Hotspot " + (i + 1), sev: sev, prot: c.prot };
    });
    var hi = items.filter(function (x) { return x.sev === "high"; }).length, md = items.length - hi;
    var head = '<button class="map-hs-head" type="button"><span class="mh-t">Hotspots <span class="mh-n high">' + hi + " high</span>" + (md ? '<span class="mh-n med">' + md + " medium</span>" : "") + '</span><span class="mh-x">‹</span></button>';
    var list = '<div class="map-hs-list">' + items.map(function (it) {
      return '<button class="map-hs-item pc-node' + (it.prot ? "" : " not-finding") + '" type="button" data-id="' + it.id + '"><span class="mh-ord">' + it.o + '</span><span class="mh-name">' + esc(it.name) + '</span><span class="mh-dot ' + it.sev + '"></span></button>';
    }).join("") + "</div>";
    hs.innerHTML = head + list;
    var hd = hs.querySelector(".map-hs-head");
    if (hd) hd.addEventListener("click", function (e) { e.stopPropagation(); var o = hs.classList.toggle("open"); hd.querySelector(".mh-x").textContent = o ? "‹" : "›"; });
    var firstProt = items.filter(function (x) { return x.prot; })[0];
    window.__pcFirst = firstProt ? firstProt.id : (items[0] && items[0].id);
  }

  // ── satisfied protections (rules already protected-in-CI) ──
  function buildSatisfied(rules, ruleNodeFor) {
    var sat = $("pcSat"); if (!sat) return;
    var ok = rules.filter(function (r) { return r.status === "protected-in-ci"; });
    if (!ok.length) { sat.style.display = "none"; return; }
    sat.style.display = "";
    sat.innerHTML = '<div class="pc-sat-h"><span class="pc-sat-chk">✓</span>Satisfied protections</div>' +
      ok.map(function (r) {
        var sid = "sat-" + slug(r.id);
        LINKS.push([sid, ruleNodeFor[r.id]]);
        DETAIL[sid] = DETAIL[ruleNodeFor[r.id]];
        return '<button class="pc-sat-item pc-node" type="button" data-id="' + sid + '"><span class="pc-nm" data-rule="' + esc(r.id) + '">' + esc(r.id) + "</span></button>";
      }).join("");
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
      var on = active && active[lk[0]] && active[lk[1]], bad = BAD[lk[0] + ">" + lk[1]];
      var x1 = a.rt, x2 = b.l, mx = (x1 + x2) / 2;
      var stroke = on ? (bad ? "rgba(255,84,104,.9)" : "rgba(255,255,255,.9)") : (bad ? "rgba(255,84,104,.28)" : "rgba(150,160,175,.16)");
      var w = on ? 2.4 : 1.2;
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
    var box = $("pcDetail"); if (!box) return;
    var it = DETAIL[id];
    if (!it) { box.classList.remove("show"); box.innerHTML = ""; return; }
    var desc = (eli && it.descEli) ? it.descEli : it.desc;
    var why = (eli && it.whyEli) ? it.whyEli : it.why;
    var sevCls = it.sev === "ok" ? "ok" : (it.sev === "high" ? "high" : "med");
    var sevTxt = it.sev === "ok" ? "Protected" : (it.sev === "high" ? "High" : "Medium");
    var hv = parseFloat(String(it.health || "").replace(/[^0-9.]/g, "")) || 0;
    var acts = it.acts && it.acts.length ? '<div class="ins-acts"><div class="ins-acts-h">Suggested actions</div>' +
      it.acts.map(function (a, i) { return '<div class="ins-act"><span class="ia-n">' + (i + 1) + "</span><span>" + esc(a) + "</span></div>"; }).join("") + "</div>" : "";
    var gotoHtml = it.notFinding ? '<div class="ins-notfinding-top">Not a Protection finding — go to ' + (it.gotoName && GOTOURL[it.gotoName] ? '<a href="' + GOTOURL[it.gotoName] + '" target="_parent" class="goto-link">' + esc(it.gotoName) + "</a>" : esc(it.gotoName || "the relevant view")) + "</div>" : "";
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

  // ── ELI10: swap rule names to plain language + re-render detail ──
  function applyEli() {
    document.querySelectorAll("[data-rule]").forEach(function (el) {
      var id = el.getAttribute("data-rule");
      el.textContent = (eli && RULE_ELI[id]) ? RULE_ELI[id] : id;
    });
    if (selected) renderDetail(selected);
  }

  // ── boot ──
  function boot() {
    Promise.all([
      fetch("/api/coverage").then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch("/api/summary").then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (res) {
      var cov = res[0], summary = res[1];
      if (summary) fillSummary(summary);
      buildChain(cov || {}, summary || {});
      wireChain();
      draw(null);
      var pcEli = $("pcEli10");
      if (pcEli) { eli = pcEli.checked; pcEli.addEventListener("change", function () { eli = pcEli.checked; applyEli(); }); }
      applyEli();
      setTimeout(function () { if (window.__pcFirst) { selected = window.__pcFirst; apply(); } else draw(null); }, 80);
      setTimeout(function () { apply(); }, 260);
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
