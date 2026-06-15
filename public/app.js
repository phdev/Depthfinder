"use strict";

// ── palettes ───────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  agent_instruction: "#ffd166",
  doc: "#58a6ff",
  product_prompt: "#2dd4bf",
  dev_agent_prompt: "#a78bfa",
  memory_store: "#f472b6",
  rule: "#f85149",
  derived_flag: "#fb923c",
  card: "#34d399",
  eval: "#e3b341",
  router_tier: "#94a3b8",
  code_module: "#7dd3fc",
  ci_job: "#c084fc",
};
const TYPE_LABELS = {
  agent_instruction: "agent instruction",
  doc: "doc",
  product_prompt: "product prompt",
  dev_agent_prompt: "dev-agent prompt",
  memory_store: "memory store",
  rule: "rule",
  derived_flag: "derived flag",
  card: "card",
  eval: "eval",
  router_tier: "router tier",
  code_module: "code module",
  ci_job: "CI job",
};
const LOAD_STYLE = {
  always: { color: "#ffd166", style: "solid", width: 4 },
  "read-first": { color: "#58a6ff", style: "solid", width: 3 },
  runtime: { color: "#2dd4bf", style: "dashed", width: 2 },
  scoped: { color: "#ff9b50", style: "dashed", width: 2 },
  "on-demand": { color: "#3a4654", style: "solid", width: 1 },
  code: { color: "#2a3340", style: "solid", width: 1 },
  ci: { color: "#7d5bbe", style: "solid", width: 1 },
  "ci/eval": { color: "#8a7320", style: "solid", width: 1 },
};
const EDGE_STYLE = {
  read_before: { color: "#ffd166", line: "solid", width: 2, arrow: "triangle" },
  decides: { color: "#f85149", line: "solid", width: 3, arrow: "triangle" },
  enhances: { color: "#34d399", line: "dashed", width: 2, arrow: "triangle" },
  protected_by: { color: "#bc8cff", line: "solid", width: 2, arrow: "triangle" },
  gated_in_ci: { color: "#58a6ff", line: "dotted", width: 2, arrow: "triangle" },
  references: { color: "#39424f", line: "solid", width: 1, arrow: "none" },
  duplicates: { color: "#ff9b50", line: "dashed", width: 2, arrow: "none" },
};

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c);
  return n;
};
const fmt = (n) => (n ?? 0).toLocaleString();

// ── tabs ────────────────────────────────────────────────────────────────────
const loaded = {};
// URL-friendly hash names mirror the visible tab labels (Context, Evals)
// even though internal panel ids are "graph" and "coverage".
const PANEL_TO_HASH = { summary: "summary", graph: "context", tokens: "tokens", coverage: "evals", drift: "drift" };
const HASH_TO_PANEL = Object.fromEntries(Object.entries(PANEL_TO_HASH).map(([p, h]) => [h, p]));
const VALID_PANELS = new Set(Object.keys(PANEL_TO_HASH));
function panelFromHash() {
  const h = (location.hash || "").replace(/^#/, "").toLowerCase();
  return HASH_TO_PANEL[h] || (VALID_PANELS.has(h) ? h : null);
}
// activate() is pure: toggles classes + lazy-loads. History is owned by the
// tab-click handler (pushes a new entry) and the initial-load normalizer
// (replaces). hashchange (back/forward) just re-runs activate().
function activate(panel) {
  if (!VALID_PANELS.has(panel)) panel = "summary";
  for (const t of document.querySelectorAll(".tab"))
    t.classList.toggle("active", t.dataset.panel === panel);
  for (const p of document.querySelectorAll(".panel"))
    p.classList.toggle("active", p.id === `panel-${panel}`);
  if (!loaded[panel]) {
    loaded[panel] = true;
    if (panel === "summary") loadSummary();
    if (panel === "graph") loadGraph();
    if (panel === "tokens") loadTokens();
    if (panel === "coverage") loadCoverage();
    if (panel === "drift") loadDrift();
  }
  if (panel === "graph" && window.__cy) window.__cy.resize();
}
const TAB_PANEL = { 0: "summary", 1: "graph", 2: "tokens", 3: "coverage", 4: "drift" };
$("#tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab");
  if (!t) return;
  const want = "#" + PANEL_TO_HASH[t.dataset.panel];
  if (location.hash === want) activate(t.dataset.panel); // re-click same tab
  else location.hash = want; // pushes history; hashchange listener activates
});
window.addEventListener("hashchange", () => {
  const p = panelFromHash();
  if (p) activate(p);
  else {
    // unknown hash (e.g. #foo) — normalize without polluting history
    history.replaceState(null, "", "#summary");
    activate("summary");
  }
});

// ── graph state ─────────────────────────────────────────────────────────────
const enabledTypes = new Set(Object.keys(TYPE_COLORS));
const enabledLoads = new Set();

function nodeSize(n) {
  const t = n.tokens || 0;
  return Math.max(16, Math.min(90, 16 + Math.sqrt(t) / 2));
}

function buildElements(map) {
  const elements = [];
  for (const n of map.nodes) {
    elements.push({
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        load: n.load,
        tokens: n.tokens || 0,
        color: TYPE_COLORS[n.type] || "#888",
        size: nodeSize(n),
        border: (LOAD_STYLE[n.load] || LOAD_STYLE.code).color,
        borderStyle: (LOAD_STYLE[n.load] || LOAD_STYLE.code).style,
        borderWidth: (LOAD_STYLE[n.load] || LOAD_STYLE.code).width,
        raw: n,
      },
    });
  }
  let i = 0;
  for (const e of map.edges) {
    const s = EDGE_STYLE[e.type] || EDGE_STYLE.references;
    elements.push({
      data: {
        id: `e${i++}`,
        source: e.source,
        target: e.target,
        etype: e.type,
        color: s.color,
        line: s.line,
        width: s.width,
        arrow: s.arrow,
      },
    });
  }
  return elements;
}

const CY_STYLE = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      width: "data(size)",
      height: "data(size)",
      "border-color": "data(border)",
      "border-width": "data(borderWidth)",
      "border-style": "data(borderStyle)",
      label: "data(label)",
      color: "#c9d4df",
      "font-size": 8,
      "text-wrap": "wrap",
      "text-max-width": 90,
      "text-valign": "bottom",
      "text-margin-y": 3,
      "min-zoomed-font-size": 6,
    },
  },
  {
    selector: "edge",
    style: {
      width: "data(width)",
      "line-color": "data(color)",
      "line-style": "data(line)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "data(arrow)",
      "curve-style": "bezier",
      opacity: 0.7,
      "arrow-scale": 0.8,
    },
  },
  { selector: ".hidden", style: { display: "none" } },
  {
    selector: "node.faded",
    style: { opacity: 0.12, "text-opacity": 0.1 },
  },
  { selector: "edge.faded", style: { opacity: 0.05 } },
  {
    selector: "node.hit",
    style: { "border-color": "#fff", "border-width": 4 },
  },
  {
    selector: "node:selected",
    style: { "border-color": "#fff", "border-width": 4 },
  },
];

function applyFilters() {
  const cy = window.__cy;
  if (!cy) return;
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const t = n.data("type");
      const l = n.data("load");
      const show = enabledTypes.has(t) && enabledLoads.has(l);
      n.toggleClass("hidden", !show);
    });
    cy.edges().forEach((e) => {
      const hide = e.source().hasClass("hidden") || e.target().hasClass("hidden");
      e.toggleClass("hidden", hide);
    });
  });
}

const PRESETS = {
  full: () => {
    Object.keys(TYPE_COLORS).forEach((t) => enabledTypes.add(t));
    allLoads.forEach((l) => enabledLoads.add(l));
  },
  boundary: () => {
    enabledTypes.clear();
    ["code_module", "derived_flag", "card", "ci_job", "router_tier"].forEach((t) =>
      enabledTypes.add(t),
    );
    enabledLoads.clear();
    allLoads.forEach((l) => enabledLoads.add(l));
  },
  loaded: () => {
    Object.keys(TYPE_COLORS).forEach((t) => enabledTypes.add(t));
    enabledLoads.clear();
    ["always", "read-first", "runtime", "scoped"].forEach((l) => enabledLoads.add(l));
  },
  docs: () => {
    enabledTypes.clear();
    ["doc", "product_prompt", "agent_instruction", "dev_agent_prompt"].forEach((t) =>
      enabledTypes.add(t),
    );
    enabledLoads.clear();
    allLoads.forEach((l) => enabledLoads.add(l));
  },
};

let allLoads = [];

function runLayout() {
  const cy = window.__cy;
  cy.layout({
    name: "cose",
    animate: false,
    nodeRepulsion: 9000,
    idealEdgeLength: 90,
    edgeElasticity: 120,
    gravity: 0.6,
    numIter: 500,
    randomize: false,
    fit: true,
    padding: 30,
  }).run();
}

function renderBudget(map) {
  const b = map.budgets;
  const s = map.summary;
  const meter = (label, val, budget) => {
    const pct = Math.min(120, (val / budget) * 100);
    const over = val > budget;
    return el("div", { class: "meter" }, [
      el("div", { class: "lbl", html: `<span>${label}</span><b>${fmt(val)} / ${fmt(budget)} tok</b>` }),
      el("div", { class: `bar ${over ? "over" : "ok"}` }, [
        el("i", { style: `width:${Math.min(100, pct)}%` }),
        el("span", { class: "budget-mark", style: `left:${Math.min(100, (budget / Math.max(val, budget)) * 100)}%` }),
      ]),
    ]);
  };
  const wrap = $("#budget");
  wrap.innerHTML = "";
  wrap.append(
    meter("CLAUDE.md (always)", s.alwaysTokens, b.claudeMd),
    meter("Read-first bundle", s.readFirstTokens, b.readFirst),
  );
  const grid = el("div", { class: "stat-grid" });
  const stat = (n, k, alert) =>
    el("div", { class: `stat${alert ? " alert" : ""}` }, [
      el("div", { class: "n", text: fmt(n) }),
      el("div", { class: "k", text: k }),
    ]);
  grid.append(
    stat(s.nodeCount, "nodes"),
    stat(s.edgeCount, "edges"),
    stat(s.totalTokens, "total tok"),
    stat(s.danglingCount, "dangling", s.danglingCount > 0),
  );
  wrap.append(grid);
}

function renderFilters(map) {
  allLoads = [...new Set(map.nodes.map((n) => n.load))];
  allLoads.forEach((l) => enabledLoads.add(l));
  const counts = {};
  for (const n of map.nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  const loadCounts = {};
  for (const n of map.nodes) loadCounts[n.load] = (loadCounts[n.load] || 0) + 1;

  const tf = $("#typeFilters");
  tf.innerHTML = "";
  for (const t of Object.keys(TYPE_COLORS)) {
    if (!counts[t]) continue;
    const chip = el("span", { class: "chip", title: t }, [
      el("span", { class: "sw", style: `background:${TYPE_COLORS[t]}` }),
      el("span", { text: `${TYPE_LABELS[t]} ${counts[t]}` }),
    ]);
    chip.onclick = () => {
      enabledTypes.has(t) ? enabledTypes.delete(t) : enabledTypes.add(t);
      chip.classList.toggle("off");
      applyFilters();
    };
    tf.append(chip);
  }

  const lf = $("#loadFilters");
  lf.innerHTML = "";
  for (const l of allLoads) {
    const st = LOAD_STYLE[l] || LOAD_STYLE.code;
    const chip = el("span", { class: "chip", title: l }, [
      el("span", { class: "sw", style: `background:${st.color}` }),
      el("span", { text: `${l} ${loadCounts[l]}` }),
    ]);
    chip.onclick = () => {
      enabledLoads.has(l) ? enabledLoads.delete(l) : enabledLoads.add(l);
      chip.classList.toggle("off");
      applyFilters();
    };
    lf.append(chip);
  }

  const eg = $("#edgeLegend");
  eg.innerHTML = "";
  for (const [t, s] of Object.entries(EDGE_STYLE)) {
    eg.append(
      el("span", { class: "chip edge", title: t }, [
        el("span", { class: "ln", style: `border-top-color:${s.color};border-top-style:${s.line}` }),
        el("span", { text: t }),
      ]),
    );
  }
}

function renderFindings(map) {
  const f = $("#findings");
  f.innerHTML = "";
  const s = map.summary;

  // CI gaps
  const gaps = el("details", {}, [
    el("summary", { html: `CI gaps <span class="pill bad">${s.ciGaps.length}</span>` }),
  ]);
  const gl = el("ul");
  for (const g of s.ciGaps) gl.append(el("li", { html: `<code>${g}</code> — runs in no workflow` }));
  gl.append(el("li", { class: "muted", text: "Protecting jobs that never run in CI — surfacing this is the point." }));
  gaps.append(gl);
  f.append(gaps);

  // dangling refs
  const dang = el("details", {}, [
    el("summary", { html: `Dangling references <span class="pill warn">${map.danglingRefs.length}</span>` }),
  ]);
  const dl = el("ul");
  for (const d of map.danglingRefs)
    dl.append(el("li", { html: `<code>${d.path}</code><br><span class="muted">in ${d.source}</span>` }));
  if (!map.danglingRefs.length) dl.append(el("li", { class: "muted", text: "none" }));
  dang.append(dl);
  f.append(dang);

  // duplicates
  const dup = el("details", {}, [
    el("summary", { html: `Duplicate blocks <span class="pill">${s.duplicatePairs}</span>` }),
  ]);
  const ul = el("ul");
  for (const e of map.edges.filter((x) => x.type === "duplicates"))
    ul.append(el("li", { html: `${e.source.split("/").pop()} ↔ ${e.target.split("/").pop()} <span class="muted">(${e.meta?.sharedBlocks || 1} block)</span>` }));
  if (!s.duplicatePairs) ul.append(el("li", { class: "muted", text: "none" }));
  dup.append(ul);
  f.append(dup);
}

function showDetail(node) {
  const d = node.data("raw");
  const det = $("#detail");
  det.innerHTML = "";
  det.append(
    el("h2", { text: d.label }),
    el("span", {
      class: "type-badge",
      style: `background:${TYPE_COLORS[d.type]}`,
      text: TYPE_LABELS[d.type] || d.type,
    }),
  );
  const dl = el("dl");
  const add = (k, v) => {
    if (v === undefined || v === null || v === "") return;
    dl.append(el("dt", { text: k }), el("dd", { text: String(v) }));
  };
  add("path", d.path || d.id);
  add("load", d.load);
  if (d.tokens) add("tokens", `~${fmt(d.tokens)}`);
  if (d.meta) {
    for (const [k, v] of Object.entries(d.meta)) {
      if (v === null || v === undefined || v === "") continue;
      add(k, typeof v === "object" ? JSON.stringify(v) : v);
    }
  }
  det.append(dl);

  const edges = node.connectedEdges();
  if (edges.length) {
    const list = el("div", { class: "edges-list" });
    list.append(el("div", { html: `<b>${edges.length}</b> edges` }));
    edges.forEach((e) => {
      const out = e.source().id() === node.id();
      const other = out ? e.target() : e.source();
      list.append(
        el("div", {
          html: `${out ? "→" : "←"} <span style="color:${EDGE_STYLE[e.data("etype")]?.color}">${e.data("etype")}</span> ${other.data("label")}`,
        }),
      );
    });
    det.append(list);
  }

  // focus neighborhood
  const cy = window.__cy;
  cy.elements().addClass("faded");
  node.closedNeighborhood().removeClass("faded");
}

function clearDetail() {
  window.__cy?.elements().removeClass("faded");
  $("#detail").innerHTML = `<div class="detail-empty">Tap a node to inspect it.</div>`;
}

async function loadGraph() {
  let map;
  try {
    map = await (await fetch("/api/map")).json();
  } catch (e) {
    $("#cy").innerHTML = `<div class="cdn-warn">Failed to load /api/map: ${e}</div>`;
    return;
  }
  window.__map = map;
  const rr = $("#repoRoot");
  if (rr) rr.textContent = (map.repoRoot || "").split("/").pop() || "repo";

  if (typeof cytoscape === "undefined") {
    $("#cy").innerHTML =
      `<div class="cdn-warn">Cytoscape failed to load from CDN (offline?).<br>The graph needs network for the CDN script; all data is still available at <code>/api/map</code>.</div>`;
    renderBudget(map);
    renderFilters(map);
    renderFindings(map);
    return;
  }

  renderBudget(map);
  renderFilters(map);
  renderFindings(map);

  window.__cy = cytoscape({
    container: $("#cy"),
    elements: buildElements(map),
    style: CY_STYLE,
    wheelSensitivity: 0.2,
    minZoom: 0.1,
    maxZoom: 3,
  });
  runLayout();
  applyFilters();
  window.__cy.on("tap", "node", (e) => showDetail(e.target));
  window.__cy.on("tap", (e) => {
    if (e.target === window.__cy) clearDetail();
  });
}

// search
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const cy = window.__cy;
  if (!cy) return;
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      const hit = q && (n.data("label") + " " + n.id()).toLowerCase().includes(q);
      n.toggleClass("hit", !!hit);
    });
  });
});

$("#layoutPreset").addEventListener("change", (e) => {
  const preset = PRESETS[e.target.value] || PRESETS.full;
  preset();
  // sync chips
  for (const chip of document.querySelectorAll("#typeFilters .chip")) {
    const label = chip.title;
    chip.classList.toggle("off", !enabledTypes.has(label));
  }
  for (const chip of document.querySelectorAll("#loadFilters .chip")) {
    chip.classList.toggle("off", !enabledLoads.has(chip.title));
  }
  applyFilters();
});

$("#refreshMap").addEventListener("click", async () => {
  const btn = $("#refreshMap");
  btn.disabled = true;
  btn.textContent = "↻ …";
  await fetch("/api/refresh/map", { method: "POST" });
  await loadGraph();
  btn.disabled = false;
  btn.textContent = "↻ Refresh";
});

// ── placeholders for panels built in later stages ───────────────────────────
function notBuiltHtml(stage, what) {
  return `<div class="placeholder"><div class="notbuilt"><h2>${what}</h2>
    <p class="muted">This panel is built in <b>stage ${stage}</b>. The endpoint is wired and responding; the view lands next.</p></div></div>`;
}
// ── monochrome icon set (inline SVG, stroked) ──
const ICONS = {
  shield: '<path d="M12 3l9 5v8l-9 5-9-5V8l9-5z"/><path d="M12 8v5"/><path d="M12 17h.01"/>',
  target: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M12 12l-6 5M12 12l6 5"/>',
  doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-4-.98L3 20l1.2-4.4A8.5 8.5 0 1 1 21 11.5z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 16H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  lines: '<path d="M5 7h14M7 12h10M5 17h14"/>',
  triangle: '<path d="M12 3l10 18H2z"/><path d="M12 9v5M12 18h.01"/>',
  layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 0 4 19.5z"/>',
  grid: '<path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/><rect x="7" y="7" width="10" height="10" rx="3"/>',
  ci: '<path d="M4 17l6-6-6-6M12 19h8"/>',
  code: '<path d="M8 18l-6-6 6-6M16 6l6 6-6 6"/>',
  db: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  flow: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M12 12l-6 5M12 12l6 5"/>',
  spark: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z"/>',
};
const svgIcon = (name) => `<svg class="icon" viewBox="0 0 24 24">${ICONS[name] || ICONS.doc}</svg>`;
const ktok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

// stacked sankey for phones: sources list + destinations list, bar ∝ tokens
function buildSankeyStacked(cont, sources, destinations) {
  const max = Math.max(1, ...sources.map((s) => s.tokens), ...destinations.map((d) => d.tokens));
  const line = (x, withPct) =>
    `<div class="sline">${svgIcon(x.icon)}<span class="sl-name">${escapeHtml(x.name)}</span><span class="sl-val">${ktok(x.tokens)}${withPct && x.pct != null ? ` · ${(x.pct * 100).toFixed(0)}%` : ""}</span><span class="sl-bar"><i style="width:${Math.round((x.tokens / max) * 100)}%"></i></span></div>`;
  cont.innerHTML = `<div class="sstack"><div class="sl-head">Sources</div>${sources
    .map((s) => line(s, false))
    .join("")}<div class="sl-head" style="margin-top:14px">Destinations</div>${destinations.map((d) => line(d, true)).join("")}</div>`;
}

// monochrome sankey: left sources → right destinations, band thickness ∝ tokens
function buildSankey(sources, destinations) {
  const cont = $("#sankey");
  if (!cont) return;
  const W = cont.clientWidth || 900;
  if (W < 560) return buildSankeyStacked(cont, sources, destinations);
  const H = cont.clientHeight || 400;
  const LW = Math.min(270, Math.max(150, W * 0.42));
  const RW = Math.min(290, Math.max(150, W * 0.42));
  const rightX = W - RW;
  const sGap = sources.length > 1 ? (H - 50) / (sources.length - 1) : 0;
  const dGap = destinations.length > 1 ? (H - 50) / (destinations.length - 1) : 0;
  const maxTok = Math.max(1, ...sources.map((s) => s.tokens));
  const SRC2DEST = [0, 0, 1, 1, 2, 3]; // source → its purpose destination
  let html = "";
  sources.forEach((s, i) => {
    const di = SRC2DEST[i] ?? 0;
    const x1 = LW;
    const y1 = i * sGap + 25;
    const y2 = di * dGap + 25;
    const dx = rightX - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const w = s.tokens / maxTok;
    const th = Math.max(5, Math.min(26, w * 26));
    html += `<div class="sflow" style="left:${x1}px;top:${y1 - th / 2}px;width:${len}px;height:${th}px;transform:rotate(${ang}deg);opacity:${(0.32 + 0.55 * w).toFixed(2)}"></div>`;
  });
  sources.forEach((s, i) => {
    html += `<div class="snode" style="left:0;top:${i * sGap}px;width:${LW}px">${svgIcon(s.icon)}<span class="sname">${escapeHtml(s.name)}</span><span class="sval">${ktok(s.tokens)}</span></div>`;
  });
  destinations.forEach((dn, j) => {
    html += `<div class="snode" style="right:0;top:${j * dGap}px;width:${RW}px">${svgIcon(dn.icon)}<span class="sname">${escapeHtml(dn.name)}</span><span class="sval">${ktok(dn.tokens)} (${(dn.pct * 100).toFixed(1)}%)</span></div>`;
  });
  cont.innerHTML = html;
}

function renderTokens(d) {
  if (d.status === "not-built") {
    $("#tokensBody").innerHTML = notBuiltHtml("b", "Token Currents");
    return;
  }
  const body = $("#tokensBody");
  body.className = "page";
  const m = d.metrics;
  const metric = (ic, val, label) =>
    `<div class="card metric-card">${svgIcon(ic)}<div><div class="metric-value">${val}</div><div class="metric-label">${label}</div></div></div>`;
  const maxPct = Math.max(...d.contributors.map((c) => c.pct), 0.0001);
  const rows = d.contributors
    .map(
      (c, i) =>
        `<div class="trow"><div>${i + 1}</div><div class="tname">${svgIcon(c.icon)}<span>${escapeHtml(c.name)}</span></div><div>${ktok(c.tokens)}</div><div>${(c.pct * 100).toFixed(1)}%</div><div>${c.over ? '<span class="over-badge"><span class="ob-full">OVER BUDGET </span>⚠</span>' : `<div class="bar"><span style="width:${Math.round((c.pct / maxPct) * 100)}%"></span></div>`}</div></div>`,
    )
    .join("");
  body.innerHTML = `
    <h1 class="page-title">Token Currents</h1>
    <p class="page-subtitle">Where context weight comes from.</p>
    <section class="metrics">
      ${metric("network", fmt(m.nodes), "Nodes")}
      ${metric("link", fmt(m.edges), "Edges")}
      ${metric("lines", fmt(m.totalTokens), "Total tok")}
      ${metric("triangle", fmt(m.dangling), "Dangling")}
      ${metric("layers", fmt(m.duplicates), "Duplicates")}
    </section>
    <section class="controls">
      <div class="control-group"><label>View</label><div class="segment"><span class="selected">Tokens</span><span>Nodes</span></div></div>
      <div class="control-group"><label>Audience</label><div class="segment"><span class="selected">All</span><span>User</span><span>Tool</span><span>System</span></div></div>
    </section>
    <section class="card sankey-card"><div class="sankey" id="sankey"></div></section>
    <section class="card table-card">
      <div class="thead"><div></div><div>Top contributors</div><div>Tokens</div><div>% of total</div><div></div></div>
      ${rows}
      <div class="center-link">View all contributors →</div>
    </section>`;
  buildSankey(d.sources, d.destinations);
  window.__tokensData = d;
}

async function loadTokens() {
  renderTokens(await (await fetch("/api/tokens")).json());
}
const yn = (v) => (v ? '<span class="tick">✓</span>' : '<span class="cross">✗</span>');
const covChip = (t, c) => `<span class="cov-chip ${c}">${t}</span>`;
const STATUS_CHIP = {
  "protected-in-ci": covChip("protected · in CI", "good"),
  "not-in-ci": covChip("NOT in CI · gap", "bad"),
  "partially-in-ci": covChip("partial CI", "warn"),
  "missing-artifact": covChip("missing artifact", "bad"),
};

function gateResultHtml(gate) {
  if (!gate || !gate.ran) return `<div class="muted">Not run yet — click <b>Run gate</b>.</div>`;
  const head = gate.passed ? covChip("PASS", "good") : covChip("FAIL", "bad");
  const when = new Date(gate.at).toLocaleString();
  const rows = gate.fixtures
    .map(
      (f) =>
        `<div class="gate-row">${f.passed ? '<span class="tick">✓</span>' : '<span class="cross">✗</span>'}
         <code>${f.scenarioId || f.fixture}</code>
         <span class="muted">${f.assertions ? `${f.assertions.passed}/${f.assertions.total} assertions` : f.error || ""} · replay ${f.replayMatches ? "✓" : "✗"} · forbidden calls ${f.forbiddenCalls ?? "?"}</span></div>`,
    )
    .join("");
  return `<div class="gate-head">${head} <span class="muted">${gate.fixtures.length} fixtures · ${when}</span></div>${rows}`;
}

function renderCoverage(d) {
  const body = $("#coverageBody");
  body.className = "coverage-body";

  const rows = d.rules
    .map((r) => {
      const protects = r.protects
        .map(
          (p) =>
            `<div class="cov-art"><span class="cov-kind ${p.kind}">${p.kind}</span><code>${p.artifact}</code>
             <span class="cov-mini">exists ${yn(p.exists)} · CI ${yn(p.inCI)}</span></div>`,
        )
        .join("");
      let live = '<span class="muted">—</span>';
      if (r.id === "deterministic_slice_replayable")
        live = d.gate && d.gate.ran ? (d.gate.passed ? covChip("PASS", "good") : covChip("FAIL", "bad")) : '<span class="muted">run gate ↓</span>';
      else if (r.id === "reminder_timing_deterministic")
        live = d.reminderTiming.asserted ? covChip(`asserted ×${d.reminderTiming.assertionCount}`, "good") : covChip("NOT asserted", "bad");
      else live = covChip("via npm test", "good");
      return `<tr>
        <td><b>${r.id}</b>${r.severity ? ` <span class="sev ${r.severity}">${r.severity}</span>` : ""}<div class="cov-desc muted">${r.description}</div>${r.asserts ? `<div class="cov-asserts">asserts: ${r.asserts}</div>` : ""}</td>
        <td>${protects}</td>
        <td>${STATUS_CHIP[r.status] || r.status}</td>
        <td>${live}</td>
      </tr>`;
    })
    .join("");

  const av = d.evalAvailability;
  body.innerHTML = `
    <div class="cov-head"><div><h2>Eval coverage</h2>
      <div class="muted">rule × protecting artifact × in-CI — generated ${new Date(d.generatedAt).toLocaleString()}</div></div>
      <button class="btn" id="refreshCov">↻ Rescan</button></div>

    <table class="matrix">
      <thead><tr><th>Rule</th><th>Protected by (artifact · exists · in-CI)</th><th>Status</th><th>Live</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="cov-gaps"><b>CI gaps:</b> ${d.ci.gaps.map((g) => `<code>${g}</code>`).join(", ") || "none"} — run in no workflow. The test suite (${d.ci.testJobs.map((j) => j.name).join(", ") || "none"}) runs in CI; the gate and evals do not. <b>Surfacing this is the point.</b></div>

    <div class="cov-section">
      <div class="cov-h"><h3>AgentCI gate <span class="muted">— real, deterministic, offline</span></h3>
        <button class="btn primary" id="runGate">▶ Run gate (~2s)</button></div>
      <div id="gateResult">${gateResultHtml(d.gate)}</div>
      <div class="muted small">Replays the 5 fixtures and checks determinism + agent-boundary assertions. Report + goldens are written to <code>.cache/</code> only — never your repo.</div>
    </div>

    <div class="cov-section">
      <div class="cov-h"><h3>eval:score <span class="muted">— live tier availability</span></h3></div>
      <div class="tiers">
        <span class="cov-chip ${av.anthropicKey ? "good" : "off"}">Anthropic key ${yn(av.anthropicKey)}</span>
        <span class="cov-chip ${av.openaiKey ? "good" : "off"}">OpenAI key ${yn(av.openaiKey)}</span>
        <span class="cov-chip ${av.groqKey ? "good" : "off"}">Groq key ${yn(av.groqKey)}</span>
        <span class="cov-chip ${av.ollamaUp ? "good" : "off"}">Ollama local ${yn(av.ollamaUp)}</span>
      </div>
      <div class="cov-empty">${d.evalResultsEmpty ? "No eval runs recorded in <code>openclaw/eval/results/</code> yet." : `${d.evalResults.length} result file(s) on disk.`}</div>
      <div class="muted small">This tool stays read-only — it won't write to your repo's results dir. To produce real scores run <code>npm run eval:score</code>: the local Ollama tier ${av.ollamaUp ? "<b>is reachable now</b>" : "is offline"}; cloud tiers need API keys (currently ${av.anyLiveTier ? "at least one live tier" : "none — would record tier_unavailable"}). Anything that lands in <code>openclaw/eval/results/</code> shows up here.</div>
    </div>`;

  $("#refreshCov").onclick = async () => {
    const r = await (await fetch("/api/refresh/coverage", { method: "POST" })).json();
    renderCoverage(r.data || r);
  };
  $("#runGate").onclick = async () => {
    const btn = $("#runGate");
    btn.disabled = true;
    btn.textContent = "▶ running…";
    $("#gateResult").innerHTML = '<div class="muted">replaying fixtures…</div>';
    try {
      await fetch("/api/run/gate", { method: "POST" });
      const fresh = await (await fetch("/api/coverage")).json();
      renderCoverage(fresh);
    } catch (e) {
      $("#gateResult").innerHTML = `<div class="cross">gate failed: ${e}</div>`;
      btn.disabled = false;
      btn.textContent = "▶ Run gate (~2s)";
    }
  };
}

async function loadCoverage() {
  const r = await (await fetch("/api/coverage")).json();
  if (r.status === "not-built") {
    $("#coverageBody").innerHTML = notBuiltHtml("c", "Eval coverage");
    return;
  }
  renderCoverage(r);
}
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
const DRIFT_WARN =
  '<div class="drift-warn">🔐 Drift is the only feature that sends repo contents off-machine — it drives your installed AI agent (1–3 min, costs API tokens).</div>';
const DRIFT_CONFIRM =
  "Run Packmind context-evaluator?\n\nThis sends your repo's file contents to your installed AI agent, takes 1–3 minutes, and costs API tokens. It is the only feature in this tool that sends repo contents off-machine.";

let driftPoll = null;
function stopDriftPoll() {
  if (driftPoll) {
    clearInterval(driftPoll);
    driftPoll = null;
  }
}

function instructionsHtml(d) {
  const ins = d.instructions || {};
  const opts = (ins.options || [])
    .map(
      (o) =>
        `<div class="drift-opt"><b>${o.label}</b><ol>${o.steps.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join("")}</ol></div>`,
    )
    .join("");
  return `<div class="notbuilt">
    <h2>Drift — Packmind context-evaluator</h2>
    <p class="warn-text">${escapeHtml(d.message || "Not installed.")}</p>
    <p class="muted">${escapeHtml(ins.summary || "")}</p>
    <div class="drift-opts">${opts}</div>
    <p class="muted">${escapeHtml(ins.thenRun || "")}</p>
    ${ins.repoUrl ? `<p><a href="${ins.repoUrl}" target="_blank" rel="noreferrer">${ins.repoUrl}</a></p>` : ""}
    <button class="btn" id="recheckDrift">↻ Re-check installation</button>
  </div>`;
}

function adaptiveResult(r) {
  if (!r || typeof r !== "object") return "";
  let html = "";
  for (const k of ["score", "grade", "summary", "totalIssues", "cost", "agent"])
    if (r[k] != null)
      html += `<div class="drift-kv"><span>${k}</span><b>${escapeHtml(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])}</b></div>`;
  const arr = r.issues || r.findings || r.evaluators || r.results;
  if (Array.isArray(arr)) {
    html += `<div class="muted" style="margin-top:.4rem">${arr.length} items</div><ul class="drift-list">`;
    for (const it of arr.slice(0, 50)) {
      const t = it.title || it.name || it.message || it.id || JSON.stringify(it).slice(0, 90);
      const sev = it.severity || it.level || it.type || "";
      html += `<li>${sev ? `<span class="sev-tag">${escapeHtml(sev)}</span> ` : ""}${escapeHtml(typeof t === "string" ? t : JSON.stringify(t))}</li>`;
    }
    html += "</ul>";
  }
  return html;
}

function renderDrift(d) {
  const body = $("#driftBody");
  body.className = "drift-body";
  if (d.status !== "running") stopDriftPoll();

  if (d.status === "running") {
    body.innerHTML = `<div class="drift-running"><div class="spinner"></div>
      <h2>Running context-evaluator…</h2>
      <p class="muted">started ${timeAgo(d.startedAt)} · 1–3 min · sending repo contents to your AI agent</p></div>`;
    if (!driftPoll) driftPoll = setInterval(() => pollDrift(), 3000);
    return;
  }
  if (d.status === "not-installed" || (d.status === "empty" && d.installed === false)) {
    body.innerHTML = instructionsHtml(d);
    $("#recheckDrift").onclick = () => loadDrift();
    return;
  }
  if (d.status === "empty") {
    body.innerHTML = `<div class="notbuilt"><h2>Drift — Packmind context-evaluator</h2>
      <p class="muted">${escapeHtml(d.message || "Installed, but no drift run cached yet.")}</p>
      ${DRIFT_WARN}<button class="btn primary" id="runDrift">▶ Run drift</button></div>`;
    wireRunDrift();
    return;
  }
  if (d.status === "error") {
    body.innerHTML = `<div class="cov-section"><div class="cov-h"><h2>Drift — last run failed</h2>
      <button class="btn primary" id="runDrift">↻ Retry</button></div>
      <div class="muted">${new Date(d.ranAt).toLocaleString()} · exit ${d.exitCode} · <code>${escapeHtml(d.command || "")}</code></div>
      <pre class="drift-err">${escapeHtml(d.error || "unknown error")}</pre>${DRIFT_WARN}</div>`;
    wireRunDrift();
    return;
  }
  // ok
  body.innerHTML = `<div class="drift-result">
    <div class="cov-h"><h2>Drift result</h2><button class="btn primary" id="runDrift">↻ Re-run</button></div>
    <div class="muted">last run ${new Date(d.ranAt).toLocaleString()} · ${Math.round((d.durationMs || 0) / 1000)}s · ${d.method}${d.parseNote ? ` · ${escapeHtml(d.parseNote)}` : ""}</div>
    <div class="drift-kvs">${adaptiveResult(d.result)}</div>
    <details><summary>Raw result JSON</summary><pre>${escapeHtml(JSON.stringify(d.result, null, 2))}</pre></details>
    ${DRIFT_WARN}</div>`;
  wireRunDrift();
}

function wireRunDrift() {
  const btn = $("#runDrift");
  if (!btn) return;
  btn.onclick = async () => {
    if (!confirm(DRIFT_CONFIRM)) return;
    btn.disabled = true;
    btn.textContent = "▶ starting…";
    try {
      const resp = await (await fetch("/api/refresh/drift", { method: "POST" })).json();
      if (resp.status === "started") renderDrift({ status: "running", startedAt: resp.startedAt });
      else renderDrift(resp); // not-installed
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "▶ Run drift";
    }
  };
}

async function pollDrift() {
  try {
    renderDrift(await (await fetch("/api/drift")).json());
  } catch {}
}

async function loadDrift() {
  renderDrift(await (await fetch("/api/drift")).json());
}

// ── Panel 0: summary / triage ───────────────────────────────────────────────
// Faithful port of the Claude Design "Summary" mockup, wired to the real
// /api/summary contract. Health hero + scroll-reveal score strip + 3 dimension
// cards (Coherence/Weight/Coverage — the mockup's 4th "Simplicity" is omitted)
// + the centerpiece Hotspots table built from the already-ranked `issues`.
//
// Honesty note: the mockup's per-row "+N health" badge and per-dimension
// "▲N%" impact columns have NO source in the real data (issues carry only
// severity/title/detail/tab/action). Rather than fabricate them, those columns
// are dropped — the table keeps suggested-order #, name, severity badge, a
// deep-link to the proving tab, and the expandable Suggested actions.

// Honest health rating thresholds (shared by hero + strip).
const ratingFor = (s) =>
  s < 35 ? { word: "Critical", cls: "rt-crit" }
  : s < 70 ? { word: "Caution", cls: "rt-caution" }
  : { word: "Healthy", cls: "rt-healthy" };
// severity → CSS suffix used by the dimension cards / strip radials
const SEV_CLS = { high: "sev-high", medium: "sev-medium", ok: "sev-ok" };
// issue severity → table-cell classes
const ISSUE_BADGE = { high: "high", medium: "med", low: "low" };
const ISSUE_BADGE_TXT = { high: "High", medium: "Medium", low: "Low" };
const ISSUE_ROW = { high: "r-red", medium: "r-amber", low: "r-blue" };

// SVG progress ring. r=15.5 → C≈97.39 (strip radials); dimension cards pass
// r=11.5 + their own track/fill classes. Arc length = pct of circumference.
function radialSvg(score, r, trackCls = "t", fillCls = "f") {
  const c = 2 * Math.PI * r;
  const fill = (Math.max(0, Math.min(100, score)) / 100) * c;
  return `<svg viewBox="0 0 ${r * 2 + 5} ${r * 2 + 5}">
    <circle class="${trackCls}" cx="${r + 2.5}" cy="${r + 2.5}" r="${r}"></circle>
    <circle class="${fillCls}" cx="${r + 2.5}" cy="${r + 2.5}" r="${r}"
      stroke-dasharray="${fill.toFixed(2)} ${(c - fill).toFixed(2)}"></circle>
  </svg>`;
}

function renderSummary(d) {
  const body = $("#summaryBody");
  body.removeAttribute("class");
  if (!d || d.healthScore == null || !d.dimensions) {
    body.className = "page";
    body.innerHTML = `<p class="page-subtitle">Summary unavailable.</p>`;
    return;
  }

  const rt = ratingFor(d.healthScore);
  const dims = ["coherence", "weight", "coverage"].map((k) => d.dimensions[k]).filter(Boolean);
  const counts = d.counts || { high: 0, medium: 0, low: 0 };
  const issues = Array.isArray(d.issues) ? d.issues : [];

  // hero radial uses the hero geometry; strip + cards use the small geometry
  const heroRadial = `<div class="radial" role="img" aria-label="Overall health ${d.healthScore} of 100">
    <svg viewBox="0 0 120 120">
      <circle class="rg-track" cx="60" cy="60" r="52"></circle>
      <circle class="rg-fill" cx="60" cy="60" r="52"
        stroke-dasharray="${((2 * Math.PI * 52) * Math.max(0, Math.min(100, d.healthScore)) / 100).toFixed(2)} ${(2 * Math.PI * 52).toFixed(2)}"></circle>
    </svg></div>`;

  // sub-nav score strip: Health + the 3 dimensions
  const stripItem = (label, score, sevCls, asLabel) =>
    `<div class="snav-item ${sevCls}">
      <span class="snav-radial">${radialSvg(score, 15.5)}</span>
      <span class="snav-txt">${asLabel ? "" : `<span class="snav-k">${escapeHtml(label)}</span>`}<span class="snav-v tnum">${score}</span></span>
      ${asLabel ? `<span class="snav-label">${escapeHtml(label)}</span>` : ""}
    </div>`;
  const strip = `<div class="df-subnav" id="dfSubnav"><div class="df-subnav-row">
    ${stripItem("Health", d.healthScore, rt.cls === "rt-crit" ? "sev-high" : rt.cls === "rt-caution" ? "sev-medium" : "sev-ok", true)}
    <span class="snav-desc"><span class="snav-rating ${rt.cls}">${rt.word}</span></span>
    ${dims.map((dm) => stripItem(dm.label, dm.score, SEV_CLS[dm.sev] || "")).join("")}
    <label class="eli10-toggle snav-eli"><input type="checkbox" class="df-eli"><span>ELI10</span></label>
  </div></div>`;

  // dimension cards (3)
  const card = (dm) =>
    `<div class="lcard ${SEV_CLS[dm.sev] || ""}" data-tab="${dm.tab}">
      <div class="lc-top"><span class="lc-name">${escapeHtml(dm.label)}
        <span class="lc-sub">${escapeHtml(dm.sub || "")}</span>
        <span class="lc-improve"><span class="lci-tri">▲</span>Improves ${escapeHtml(dm.improves || "")}</span></span>
      </div>
      <div class="lc-score">
        <span class="lc-radial">${radialSvg(dm.score, 11.5, "lcr-track", "lcr-fill")}</span>
        <span class="lc-val tnum">${dm.score}</span>
      </div>
    </div>`;

  // hotspot rows from the ranked issues
  const hotspotRow = (it, i) => {
    const badge = ISSUE_BADGE[it.severity] || "low";
    const badgeTxt = ISSUE_BADGE_TXT[it.severity] || "Low";
    const rowCls = ISSUE_ROW[it.severity] || "r-blue";
    const tabName = TAB_PANEL[it.tab] ? PANEL_TO_HASH[TAB_PANEL[it.tab]] : null;
    const link = tabName
      ? `<span class="nm-link" data-tab="${it.tab}">${escapeHtml(tabName)}<span class="nl-arrow">→</span></span>`
      : "";
    // ELI10 OFF → terse title only; ELI10 ON → adds the plain-language detail
    // line. We carry `detail` in a data attr and toggle its visibility.
    const detail = it.detail
      ? `<div class="de" data-eli10>${escapeHtml(it.detail)}</div>`
      : "";
    // Each issue carries exactly one `action` string (the summary data contract).
    // No count badge — a literal "1" would silently lie if `action` ever became a
    // list. If it does, render the real count here AND swap the da-n "1" below.
    const action = it.action
      ? `<button class="acts-btn" type="button">Suggested action <span class="ab-arrow">→</span></button>
         <div class="acts-expand"><div class="acts-expand-in"><div class="ae-head">Suggested action</div>
           <div class="ae-act"><span class="da-n">1</span><span>${escapeHtml(it.action)}</span></div></div></div>`
      : "";
    return `<div class="df-trow ${rowCls}">
      <div class="hs"><div class="nm">
        <div class="nm-r1"><span class="num tnum">${i + 1}</span><span class="nm-t">${escapeHtml(it.title)}</span></div>
        <div class="nm-r2"><span class="sev-badge ${badge}">${badgeTxt}</span>${link}</div>
      </div>${detail}${action}</div>
    </div>`;
  };

  const tableInner = issues.length
    ? issues.map(hotspotRow).join("")
    : `<div class="df-empty"><b>All clear.</b> No ranked hotspots — your context surfaces look healthy.</div>`;

  const countChips =
    `${counts.high ? `<span class="hc high">${counts.high} high</span>` : ""}` +
    `${counts.medium ? `<span class="hc med">${counts.medium} medium</span>` : ""}` +
    `${!counts.high && !counts.medium && counts.low ? `<span class="hc">${counts.low} low</span>` : ""}`;

  const healthy = Array.isArray(d.healthy) && d.healthy.length
    ? `<section class="df-healthy"><span class="hh-lab">Working</span>${d.healthy
        .map((h) => `<span class="hh">${escapeHtml(h)}</span>`)
        .join("")}</section>`
    : "";

  body.innerHTML = `<div class="df-sum">
    ${strip}
    <section class="df-head"><h1>Summary</h1></section>

    <section class="df-health ${rt.cls}">
      ${heroRadial}
      <div class="left">
        <span class="ovl">Health</span>
        <div class="scoreline">
          <span class="score tnum">${d.healthScore}<span class="den">/ 100</span></span>
          <span class="rating">${rt.word}</span>
        </div>
        <p class="why">Higher health = more reliable, faster, cheaper AI interactions.</p>
      </div>
    </section>

    <details class="df-factors">
      <summary><span class="factors-t">Dimensions</span><span class="chev-d">›</span></summary>
      <section class="df-loadgrid">${dims.map(card).join("")}</section>
    </details>

    <section class="df-tsec" id="dfTsec">
      <div class="df-tsec-head">
        <div class="th-left">
          <button class="hs-collapse" id="dfHsCollapse" type="button" aria-expanded="true"><span class="hs-chev">›</span>Hotspots</button>
          <div class="hs-counts">${countChips}</div>
        </div>
        <div class="th-right">
          <label class="eli10-toggle"><input type="checkbox" class="df-eli" checked><span>ELI10</span></label>
        </div>
      </div>
      <div class="df-table" id="dfTable">${tableInner}</div>
      ${healthy}
    </section>
  </div>`;

  wireSummary(body);
}

// Wire all Summary interactions (idempotent per render).
function wireSummary(root) {
  // deep-links: dimension cards + per-row tab chips
  root.querySelectorAll("[data-tab]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      activate(TAB_PANEL[b.dataset.tab]);
    });
  });

  // collapse Hotspots
  const coll = root.querySelector("#dfHsCollapse");
  const tsec = root.querySelector("#dfTsec");
  if (coll && tsec)
    coll.addEventListener("click", () => {
      const c = tsec.classList.toggle("collapsed");
      coll.setAttribute("aria-expanded", String(!c));
    });

  // inline Suggested-action expand (one open at a time)
  const table = root.querySelector("#dfTable");
  if (table)
    table.addEventListener("click", (e) => {
      const btn = e.target.closest(".acts-btn");
      if (!btn) return;
      const panel = btn.parentElement.querySelector(".acts-expand");
      if (!panel) return;
      const isOpen = panel.classList.contains("open");
      table.querySelectorAll(".acts-expand.open").forEach((p) => {
        if (p !== panel) {
          p.classList.remove("open");
          const b = p.parentElement.querySelector(".acts-btn");
          if (b) b.classList.remove("is-open");
        }
      });
      panel.classList.toggle("open", !isOpen);
      btn.classList.toggle("is-open", !isOpen);
    });

  // ELI10 toggle — show/hide the plain-language detail line. The two checkboxes
  // (strip + header) stay in sync; default is ON (header box is `checked`).
  const elis = [...root.querySelectorAll(".df-eli")];
  const applyEli = (on) => {
    root.querySelectorAll(".de[data-eli10]").forEach((el) => {
      el.style.display = on ? "" : "none";
    });
    elis.forEach((c) => (c.checked = on));
  };
  elis.forEach((c) => c.addEventListener("change", () => applyEli(c.checked)));
  applyEli(true);

  // scroll-reveal the score strip once the hero scrolls past
  const panel = $("#panel-summary");
  const subnav = root.querySelector("#dfSubnav");
  if (panel && subnav) {
    const onScroll = () => subnav.classList.toggle("show", panel.scrollTop > 210);
    panel.removeEventListener("scroll", panel.__dfSumScroll || (() => {}));
    panel.__dfSumScroll = onScroll;
    panel.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
}

async function loadSummary() {
  try {
    renderSummary(await (await fetch("/api/summary")).json());
  } catch (e) {
    const body = $("#summaryBody");
    body.className = "page";
    body.innerHTML = `<p class="page-subtitle">Failed to load summary: ${escapeHtml(String(e))}</p>`;
  }
}

// global refresh ↻ — reloads whichever panel is active
$("#globalRefresh")?.addEventListener("click", async () => {
  const panel = document.querySelector(".tab.active")?.dataset.panel || "summary";
  const btn = $("#globalRefresh");
  btn.classList.add("spin");
  try {
    if (panel === "summary") await loadSummary();
    else if (panel === "graph") {
      await fetch("/api/refresh/map", { method: "POST" });
      await loadGraph();
    } else if (panel === "tokens") await loadTokens();
    else if (panel === "coverage") await loadCoverage();
    else if (panel === "drift") await loadDrift();
  } finally {
    btn.classList.remove("spin");
  }
});

// keep the sankey + graph laid out on resize
let __rszTimer;
window.addEventListener("resize", () => {
  clearTimeout(__rszTimer);
  __rszTimer = setTimeout(() => {
    if (document.querySelector(".tab.active")?.dataset.panel === "tokens" && window.__tokensData)
      buildSankey(window.__tokensData.sources, window.__tokensData.destinations);
    if (window.__cy) window.__cy.resize();
  }, 150);
});

// Initial load: normalize URL to the canonical hash (no extra history entry).
{
  const start = panelFromHash() || "summary";
  const canonical = "#" + PANEL_TO_HASH[start];
  if (location.hash !== canonical) history.replaceState(null, "", canonical);
  activate(start);
}
