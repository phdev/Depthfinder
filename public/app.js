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
function activate(panel) {
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
  if (t) activate(t.dataset.panel);
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
  $("#repoRoot").textContent = (map.repoRoot || "").split("/").pop() || "repo";

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
function calloutCard(title, c, note) {
  const denom = Math.max(c.tokens, c.budget);
  const fill = (c.tokens / denom) * 100;
  const mark = (c.budget / denom) * 100;
  return el("div", { class: `callout ${c.over ? "over" : "ok"}` }, [
    el("div", { class: "callout-h", html: `<span>${title}</span><span class="status">${c.over ? "OVER" : "OK"}</span>` }),
    el("div", { class: "callout-n", html: `${fmt(c.tokens)} <small>/ ${fmt(c.budget)} tok</small>` }),
    el("div", { class: `bar ${c.over ? "over" : "ok"}` }, [
      el("i", { style: `width:${fill}%` }),
      el("span", { class: "budget-mark", style: `left:${mark}%` }),
    ]),
    el("div", { class: "callout-note", text: note }),
  ]);
}

function renderTokTree(container, nodes, total, depth) {
  for (const n of nodes) {
    const isDir = n.isDir && n.children && n.children.length;
    const pct = total ? (n.tokens / total) * 100 : 0;
    const row = el("div", { class: "tok-row" + (isDir ? " dir" : "") });
    row.style.paddingLeft = depth * 14 + 8 + "px";
    const caret = el("span", { class: "caret", text: isDir ? "▸" : "" });
    const name = el("span", { class: "tok-name", text: n.name + (n.isDir ? "/" : "") });
    const bar = el("span", { class: "tokbar" }, [el("i", { style: `width:${Math.max(0.5, pct)}%` })]);
    const num = el("span", { class: "tok-num", html: `${fmt(n.tokens)} <small>${pct.toFixed(1)}%</small>` });
    row.append(caret, name, bar, num);
    container.append(row);
    if (isDir) {
      const kids = el("div", { class: "tok-kids collapsed" });
      renderTokTree(kids, n.children, total, depth + 1);
      container.append(kids);
      row.onclick = (e) => {
        e.stopPropagation();
        const open = !kids.classList.toggle("collapsed");
        caret.textContent = open ? "▾" : "▸";
      };
    }
  }
}

function renderTokens(d) {
  const body = $("#tokensBody");
  body.className = "tokens-body";
  body.innerHTML = "";
  body.append(
    el("div", { class: "tok-head" }, [
      el("div", {}, [
        el("h2", { text: "Token budget" }),
        el("div", { class: "muted", html: `source: ${d.source} · ${fmt(d.totals.totalTokens)} tokens · ${d.totals.fileCount} files` }),
      ]),
      el("button", { class: "btn", id: "refreshTokens", text: "↻ Recompute" }),
    ]),
  );

  const cm = d.callouts.claudeMd;
  const rf = d.callouts.readFirst;
  body.append(
    el("div", { class: "callouts" }, [
      calloutCard("CLAUDE.md — always loaded", cm, cm.over ? `${cm.ratio.toFixed(1)}× over the ${fmt(cm.budget)}-token budget` : "within budget"),
      calloutCard("Read-first bundle (gbrain docs)", rf, rf.over ? "over budget" : `within the ${fmt(rf.budget)}-token budget`),
    ]),
  );

  // read-first breakdown
  const rfList = el("div", { class: "rf-list" }, [el("div", { class: "muted", text: "Read-first bundle breakdown:" })]);
  for (const f of rf.files)
    rfList.append(el("div", { class: "rf-row", html: `<span>${f.path}</span><b>${fmt(f.tokens)}</b>` }));
  body.append(rfList);

  // tree
  const tree = el("div", { class: "tok-tree" }, [el("h3", { text: "Token cost by path (click a folder to drill in)" })]);
  const treeRows = el("div", { class: "tok-rows" });
  renderTokTree(treeRows, d.tree.children, d.totals.totalTokens, 0);
  tree.append(treeRows);
  body.append(tree);

  $("#refreshTokens").onclick = async () => {
    const btn = $("#refreshTokens");
    btn.disabled = true;
    btn.textContent = "↻ recomputing… (~10s)";
    try {
      const res = await (await fetch("/api/refresh/tokens", { method: "POST" })).json();
      renderTokens(res.data || res);
    } catch {
      btn.disabled = false;
      btn.textContent = "↻ Recompute";
    }
  };
}

async function loadTokens() {
  const r = await (await fetch("/api/tokens")).json();
  if (r.status === "not-built") {
    $("#tokensBody").innerHTML = notBuiltHtml("b", "Token budget");
    return;
  }
  renderTokens(r);
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
const SEV_CLASS = { high: "critical", medium: "warn", low: "low" };
const STATUS_CARD = { good: "good", warn: "warn", bad: "critical", muted: "neutral" };

// pick a sonar-themed icon for a health metric by its meaning
function metricIcon(label, status) {
  const l = label.toLowerCase();
  if (l.includes("dangling")) return { cls: "chain", glyph: "⌁" };
  if (l.includes("gate")) return { cls: "shield", glyph: status === "bad" ? "✕" : "✓" };
  if (l.includes("drift")) return { cls: "clock", glyph: "◷" };
  if (l.includes("rules")) return { cls: "triangle", glyph: "!" };
  if (status === "good") return { cls: "check", glyph: "✓" };
  if (status === "bad") return { cls: "gauge", glyph: "!" };
  return { cls: "triangle", glyph: "!" };
}

// "10,834 / 4,000" → big value + small budget; else a single styled value
function metricValue(label, value) {
  if (label.toLowerCase().includes("budget")) {
    const m = String(value).match(/^(.+?)\s*\/\s*(.+)$/);
    if (m) return `<strong>${escapeHtml(m[1].trim())}</strong><small>/ ${escapeHtml(m[2].trim())}</small>`;
  }
  let v = String(value);
  v = /^(pass|fail)$/i.test(v) ? v.toUpperCase() : v.charAt(0).toUpperCase() + v.slice(1);
  return `<strong>${escapeHtml(v)}</strong>`;
}

function healthyIcon(text) {
  const t = text.toLowerCase();
  if (t.includes("local-only") || t.includes("leakage") || t.includes("memory"))
    return { cls: "lock", glyph: "▣" };
  return { cls: "", glyph: "✓" };
}

function renderSummary(d) {
  const body = $("#summaryBody");
  body.className = "summary-body";

  const health = d.health
    .map((h) => {
      const ic = metricIcon(h.label, h.status);
      const cls = STATUS_CARD[h.status] || "neutral";
      return `<button class="metric-card ${cls}" data-tab="${h.tab}">
        <span class="metric-label">${escapeHtml(h.label)}</span>
        <span class="icon ${ic.cls}">${ic.glyph}</span>
        ${metricValue(h.label, h.value)}
      </button>`;
    })
    .join("");

  const issues = d.issues
    .map(
      (it, i) =>
        `<a class="issue-card ${SEV_CLASS[it.severity] || "low"}" data-tab="${it.tab}" href="#">
        <span class="rank">${i + 1}</span>
        <span class="issue-copy">
          <strong>${escapeHtml(it.title)}</strong>
          <small>${escapeHtml(it.detail)}</small>
          ${it.action ? `<small class="action">↳ ${escapeHtml(it.action)}</small>` : ""}
        </span>
        <span class="tab-chip">Tab ${it.tab} <b>›</b></span>
      </a>`,
    )
    .join("");

  const healthy = d.healthy
    .map((h) => {
      const ic = healthyIcon(h);
      return `<div class="healthy-row"><span class="healthy-icon ${ic.cls}">${ic.glyph}</span><span class="healthy-text">${escapeHtml(h)}</span><b>›</b></div>`;
    })
    .join("");

  body.innerHTML = `
    <div class="ocean-glow" aria-hidden="true"></div>
    <div class="sonar-field" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <section class="hero">
      <p class="eyebrow">Repo context sonar</p>
      <div class="hero-row"><h2>Summary</h2>
        <button class="refresh" id="refreshSummary" aria-label="Refresh">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v6h-6"/><path d="M19 12a7 7 0 1 1-2.05-4.95L20 10"/></svg>
        </button></div>
      <p class="updated">Updated ${new Date(d.generatedAt).toLocaleString()}</p>
    </section>
    <section class="health-strip">${health}</section>
    <section class="priority-section">
      <div class="section-title critical-title"><span class="section-icon">!</span><h3>What to fix first</h3></div>
      ${issues || '<div class="muted">No issues — all clear.</div>'}
    </section>
    <section class="healthy-section">
      <div class="section-title good-title"><span class="section-icon">✓</span><h3>Healthy</h3></div>
      <div class="healthy-list">${healthy}</div>
    </section>`;

  body.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault();
      activate(TAB_PANEL[b.dataset.tab]);
    }),
  );
  $("#refreshSummary").onclick = () => loadSummary();
}
async function loadSummary() {
  try {
    renderSummary(await (await fetch("/api/summary")).json());
  } catch (e) {
    $("#summaryBody").innerHTML = `<div class="cdn-warn">Failed to load summary: ${e}</div>`;
  }
}

activate("summary");
