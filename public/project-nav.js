/* ============================================================
   DEPTHFINDER — repo-name dropdown (shared across the SPA shell + the design
   pages). Replaces the static "local-only" badge with the scanned repo's name
   as a dropdown: switch between added projects or add a new one. Self-contained
   (injects its own styles) so every nav can load it with one <script>.
   ============================================================ */
(function () {
  "use strict";
  // The Summary's embedded views load pages with ?embed (nav hidden) — no badge.
  if (document.documentElement.classList.contains("embed")) return;
  var badge = document.querySelector(".badge-local");
  if (!badge) return;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  if (!document.getElementById("dfProjStyle")) {
    var st = document.createElement("style");
    st.id = "dfProjStyle";
    st.textContent =
      ".df-proj{position:relative;display:inline-flex;}" +
      ".df-proj-btn{display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:11px;color:#c4ccd6;" +
        "background:none;border:1px solid #27313f;border-radius:999px;padding:5px 10px 5px 11px;cursor:pointer;white-space:nowrap;letter-spacing:.03em;}" +
      ".df-proj-btn:hover{border-color:#39465a;color:#eaf0f7;}" +
      ".df-proj-dot{width:6px;height:6px;border-radius:50%;background:#3fd09a;box-shadow:0 0 7px #3fd09a;flex:0 0 auto;}" +
      ".df-proj-name{font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;}" +
      ".df-proj-caret{font-size:9px;color:#5d6878;}" +
      ".df-proj-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:280px;max-width:380px;z-index:60;" +
        "background:#0a0e15;border:1px solid #27313f;border-radius:12px;padding:6px;box-shadow:0 18px 50px rgba(0,0,0,.6);}" +
      ".df-proj-menu[hidden]{display:none;}" +
      ".df-proj-h{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#5d6878;padding:8px 10px 6px;}" +
      ".df-proj-item{display:grid;grid-template-columns:18px 1fr;gap:2px 8px;width:100%;text-align:left;background:none;border:none;" +
        "border-radius:8px;padding:8px 10px;cursor:pointer;color:#c4ccd6;font:inherit;}" +
      ".df-proj-item:hover{background:#141a23;}" +
      ".df-proj-check{grid-row:1/3;align-self:center;color:#3fd09a;font-size:12px;}" +
      ".df-proj-item-n{font-size:13px;font-weight:600;color:#eaf0f7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".df-proj-item.on .df-proj-item-n{color:#3fd09a;}" +
      ".df-proj-item-p{font-size:10.5px;color:#5d6878;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".df-proj-sep{height:1px;background:#1b2330;margin:6px 4px;}" +
      ".df-proj-add{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;border-radius:8px;" +
        "padding:9px 10px;cursor:pointer;color:#9aa7b7;font:inherit;font-size:12.5px;}" +
      ".df-proj-add:hover{background:#141a23;color:#eaf0f7;}" +
      ".df-proj-form{display:none;padding:8px 6px 6px;gap:6px;}" +
      ".df-proj-form.open{display:flex;flex-direction:column;}" +
      ".df-proj-input{font:inherit;font-size:12px;color:#eaf0f7;background:#05080d;border:1px solid #27313f;border-radius:7px;" +
        "padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;}" +
      ".df-proj-input:focus{border-color:#39465a;}" +
      ".df-proj-form-row{display:flex;gap:6px;}" +
      ".df-proj-go{font:inherit;font-size:12px;font-weight:600;color:#04070d;background:#3fd09a;border:none;border-radius:7px;padding:7px 14px;cursor:pointer;}" +
      ".df-proj-go:hover{background:#5bdcab;}" +
      ".df-proj-err{font-size:11px;color:#ff7a8a;padding:0 2px;display:none;}" +
      ".df-proj-err.show{display:block;}";
    document.head.appendChild(st);
  }

  var wrap = document.createElement("div");
  wrap.className = "df-proj";
  wrap.innerHTML =
    '<button type="button" class="df-proj-btn"><span class="df-proj-dot"></span>' +
    '<span class="df-proj-name">…</span><span class="df-proj-caret">▾</span></button>' +
    '<div class="df-proj-menu" hidden></div>';
  badge.replaceWith(wrap);

  var btn = wrap.querySelector(".df-proj-btn");
  var menu = wrap.querySelector(".df-proj-menu");
  var state = { name: "", root: "", projects: [] };

  function render() {
    wrap.querySelector(".df-proj-name").textContent = state.name || "project";
    var items = state.projects.map(function (p) {
      var on = p.root === state.root;
      return '<button type="button" class="df-proj-item' + (on ? " on" : "") + '" data-root="' + esc(p.root) + '">' +
        '<span class="df-proj-check">' + (on ? "✓" : "") + "</span>" +
        '<span class="df-proj-item-n">' + esc(p.name) + "</span>" +
        '<span class="df-proj-item-p">' + esc(p.root) + "</span></button>";
    }).join("");
    menu.innerHTML =
      '<div class="df-proj-h">Projects</div>' + items +
      '<div class="df-proj-sep"></div>' +
      '<button type="button" class="df-proj-add">＋&nbsp; Add a project…</button>' +
      '<div class="df-proj-form"><input class="df-proj-input" placeholder="/path/to/project" spellcheck="false" />' +
      '<div class="df-proj-err"></div>' +
      '<div class="df-proj-form-row"><button type="button" class="df-proj-go">Add</button></div></div>';
  }

  function load() {
    fetch("/api/project").then(function (r) { return r.json(); }).then(function (d) {
      state.name = d.name; state.root = d.root; state.projects = d.projects || []; render();
    }).catch(function () {});
  }

  function activate(root) {
    fetch("/api/project/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: root }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) (window.top || window).location.reload(); else alert(d.error || "Could not switch project"); });
  }

  btn.addEventListener("click", function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener("click", function () { menu.hidden = true; });
  menu.addEventListener("click", function (e) {
    e.stopPropagation();
    var item = e.target.closest(".df-proj-item");
    if (item) { if (item.dataset.root === state.root) { menu.hidden = true; } else activate(item.dataset.root); return; }
    if (e.target.closest(".df-proj-add")) {
      var form = menu.querySelector(".df-proj-form");
      form.classList.add("open");
      var inp = form.querySelector(".df-proj-input"); inp.focus();
      return;
    }
    if (e.target.closest(".df-proj-go")) submitAdd();
  });
  menu.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.classList.contains("df-proj-input")) { e.preventDefault(); submitAdd(); } });

  function submitAdd() {
    var inp = menu.querySelector(".df-proj-input"), err = menu.querySelector(".df-proj-err");
    var path = (inp.value || "").trim(); if (!path) { inp.focus(); return; }
    err.classList.remove("show");
    fetch("/api/project/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: path }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { state.projects = d.projects; render(); menu.hidden = false; }
        else { err.textContent = d.error || "Could not add project"; err.classList.add("show"); }
      })
      .catch(function () { err.textContent = "Could not add project"; err.classList.add("show"); });
  }

  load();
})();
