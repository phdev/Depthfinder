/* ============================================================
   DEPTHFINDER — sticky score subnav (shared). Gives the design pages
   (Context/Tokens/Drift/Evals) the SAME scroll-revealed scores strip as the
   Summary tab: Health + Honesty/Weight/Coverage radials inline + rating + ELI10.
   Self-contained (injects its own scoped styles, .dfx-subnav) so it can't clash
   with the design's own .subnav (which it replaces) or context-base.css.
   ============================================================ */
(function () {
  "use strict";
  if (document.documentElement.classList.contains("embed")) return; // hidden in Summary embeds
  var topnav = document.querySelector(".topnav");
  if (!topnav) return;

  // drop the design's original subnav (Health + "+"); we replace it with the
  // Summary-style all-inline strip.
  var old = document.getElementById("subnav") || document.querySelector(".subnav");
  if (old) old.remove();

  if (!document.getElementById("dfxSubnavStyle")) {
    var st = document.createElement("style");
    st.id = "dfxSubnavStyle";
    st.textContent =
      ".dfx-subnav{position:sticky;top:60px;z-index:18;border-bottom:1px solid var(--line,#1b2330);" +
        "background:rgba(7,10,15,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
        "max-height:0;opacity:0;overflow:hidden;pointer-events:none;transition:max-height .26s ease,opacity .2s ease;}" +
      ".dfx-subnav.show{max-height:64px;opacity:1;pointer-events:auto;}" +
      ".dfx-row{display:flex;align-items:center;gap:30px;height:50px;max-width:1200px;margin:0 auto;padding:0 40px;}" +
      ".dfx-subnav .snav-item{display:flex;align-items:center;gap:8px;}" +
      ".dfx-subnav .snav-radial{width:26px;height:26px;flex:0 0 auto;}" +
      ".dfx-subnav .snav-radial svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible;display:block;}" +
      ".dfx-subnav .snav-radial .t{fill:none;stroke:var(--panel-3,#0e141d);stroke-width:7;}" +
      ".dfx-subnav .snav-radial .f{fill:none;stroke:var(--ink-3,#5d6878);stroke-width:7;stroke-linecap:round;}" +
      ".dfx-subnav .snav-item.sev-high .snav-radial .f{stroke:var(--red,#ff5468);}" +
      ".dfx-subnav .snav-item.sev-medium .snav-radial .f{stroke:var(--amber,#ffb13b);}" +
      ".dfx-subnav .snav-item.sev-ok .snav-radial .f{stroke:var(--pos,#3fd09a);}" +
      ".dfx-subnav .snav-txt{display:flex;flex-direction:column;line-height:1.02;}" +
      ".dfx-subnav .snav-k{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3,#5d6878);}" +
      ".dfx-subnav .snav-v{font-size:16px;font-weight:800;letter-spacing:-.02em;color:var(--ink,#eaf0f7);font-variant-numeric:tabular-nums;}" +
      ".dfx-subnav .snav-item.sev-high .snav-v{color:var(--red,#ff5468);}" +
      ".dfx-subnav .snav-item.sev-medium .snav-v{color:var(--amber,#ffb13b);}" +
      ".dfx-subnav .snav-item.sev-ok .snav-v{color:var(--pos,#3fd09a);}" +
      ".dfx-subnav .snav-label{font-size:12px;font-weight:700;letter-spacing:.01em;color:var(--ink,#eaf0f7);margin-left:-2px;}" +
      ".dfx-subnav .snav-desc{display:flex;flex-direction:column;line-height:1.15;}" +
      ".dfx-subnav .snav-rating{font-size:12px;font-weight:700;letter-spacing:.01em;}" +
      ".dfx-subnav .snav-rating.rt-crit{color:var(--red,#ff5468);}" +
      ".dfx-subnav .snav-rating.rt-caution{color:var(--amber,#ffb13b);}" +
      ".dfx-subnav .snav-rating.rt-healthy{color:var(--pos,#3fd09a);}" +
      ".dfx-subnav .eli10-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-size:11px;color:var(--ink-2,#9aa7b7);cursor:pointer;}" +
      "@media (max-width:760px){.dfx-row{gap:16px;padding:0 20px;overflow-x:auto;}.dfx-subnav .snav-label{display:none;}}";
    document.head.appendChild(st);
  }

  var C = 97.39; // r=15.5 circumference
  function dash(score) { return (Math.max(0, Math.min(100, score)) / 100 * C).toFixed(2) + " " + C; }
  function sevOf(s) { return s < 35 ? "sev-high" : s < 70 ? "sev-medium" : "sev-ok"; }
  function ratingCls(s) { return s < 35 ? "rt-crit" : s < 70 ? "rt-caution" : "rt-healthy"; }
  function ratingWord(s) { return s < 35 ? "Critical" : s < 70 ? "Caution" : "Healthy"; }
  function radial(score) { return '<span class="snav-radial"><svg viewBox="0 0 36 36"><circle class="t" cx="18" cy="18" r="15.5"></circle><circle class="f" cx="18" cy="18" r="15.5" stroke-dasharray="' + dash(score) + '"></circle></svg></span>'; }
  function item(label, score, asLabel) {
    var v = Math.round(score);
    return '<div class="snav-item ' + sevOf(score) + '">' + radial(score) +
      '<span class="snav-txt">' + (asLabel ? "" : '<span class="snav-k">' + label + "</span>") + '<span class="snav-v">' + v + "</span></span>" +
      (asLabel ? '<span class="snav-label">' + label + "</span>" : "") + "</div>";
  }

  var bar = document.createElement("div");
  bar.className = "dfx-subnav";
  bar.id = "dfxSubnav";
  bar.innerHTML = '<div class="dfx-row" id="dfxRow"></div>';
  topnav.insertAdjacentElement("afterend", bar);
  var row = bar.querySelector("#dfxRow");

  function fill(s) {
    var H = Math.round(s.healthScore != null ? s.healthScore : 0);
    var dims = s.dimensions || {};
    var hon = dims.honesty || dims.coherence || {}, wt = dims.weight || {}, cov = dims.coverage || {};
    row.innerHTML =
      item("Health", H, true) +
      '<span class="snav-desc"><span class="snav-rating ' + ratingCls(H) + '">' + ratingWord(H) + "</span></span>" +
      (hon.score != null ? item("Honesty", hon.score) : "") +
      (wt.score != null ? item("Weight", wt.score) : "") +
      (cov.score != null ? item("Coverage", cov.score) : "") +
      '<label class="eli10-toggle"><input type="checkbox" checked><span>ELI10</span></label>';
  }

  fetch("/api/summary").then(function (r) { return r.json(); }).then(fill).catch(function () {});

  // reveal on scroll (matches the Summary's behavior). Low threshold so it still
  // triggers on the shorter design pages, which scroll less than the tall Summary.
  function onScroll() { bar.classList.toggle("show", (window.scrollY || document.documentElement.scrollTop || 0) > 80); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
