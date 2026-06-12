// Context map generator.
//
// Scans the home-center repo's context surfaces and emits a typed graph
// (nodes + edges + per-node token counts) to .cache/context-map.json.
//
// READ-ONLY against the repo. Emits NO file contents — only paths, labels,
// token counts, derived/flag/tier/job names, and memory populated/count.
//
// Node types : agent_instruction, doc, product_prompt, dev_agent_prompt,
//              memory_store, rule, derived_flag, card, eval, router_tier,
//              code_module, ci_job
// Edge types : read_before, decides, enhances, protected_by, gated_in_ci,
//              references, duplicates
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  CACHE_DIR,
  ensureCache,
  walk,
  readRepoText,
  repoExists,
} from "../lib/repo.mjs";
import { tokchars } from "../lib/text.mjs";
import { redactDeep } from "../lib/redact.mjs";

// ── Architectural facts (the deterministic boundary the graph must depict) ──
// These are true at the code level (see CLAUDE.md "Rules" + the integration
// test). derivations DECIDES card visibility; openclaw/router ENHANCE copy
// only; the boundary is PROTECTED by the integration test.
const DERIVATIONS = "src/core/derivations/index.js";
const REGISTRY = "src/cards/registry.js";
const OPENCLAW = "src/ai/openclaw.js";
const DERIVE_SHIM = "src/state/deriveState.js";
const ROUTER_CFG = "openclaw/router/config.js";

// flag (derived_flag) → card (card.id) it governs. Real architectural mapping
// (registry card.engineType + enhancementFeature ↔ DerivedState flag).
const FLAG_DECIDES_CARD = [
  ["bedtimeReminderActive", "bedtimeToast"],
  ["lunchDecisionNeeded", "lunchDecision"],
  ["takeoutDecisionPending", "takeoutDecision"],
  ["showMorningChecklist", "morningChecklist"],
  ["showClawSuggestions", "clawSuggestions"],
];

// Test files → the modules they import are "protected_by" that test.
const TEST_FILES = [
  "src/__tests__/fallback.integration.test.js",
  "src/ai/openclaw.test.js",
  "src/cards/registry.test.js",
  "src/state/deriveState.test.js",
];

// Map an import specifier to a canonical module node id, resolving relative
// specifiers against the importing file's directory. The deriveState shim
// re-exports derivations, so a test importing it protects the real impl.
function importToModule(spec, fromRel) {
  let cand = spec;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = fromRel.split("/").slice(0, -1).join("/");
    const stack = [];
    for (const part of `${dir}/${spec}`.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    cand = stack.join("/");
  }
  cand = cand.replace(/\.jsx?$/, "").replace(/\/index$/, "");
  if (/(^|\/)state\/deriveState$/.test(cand)) return DERIVATIONS; // shim → impl
  if (/(^|\/)core\/derivations$/.test(cand)) return DERIVATIONS;
  if (/(^|\/)cards\/registry$/.test(cand)) return REGISTRY;
  if (/(^|\/)ai\/openclaw$/.test(cand)) return OPENCLAW;
  return null;
}

export function generateMap() {
  const warnings = [];
  const nodes = new Map(); // id -> node
  const edges = []; // {source, target, type, meta?}
  const edgeKeys = new Set();

  const addNode = (id, node) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...node });
    return nodes.get(id);
  };
  const addEdge = (source, target, type, meta) => {
    if (!source || !target) return;
    const key = `${source}|${target}|${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(meta ? { source, target, type, meta } : { source, target, type });
  };

  // helper: first markdown H1/H2 heading as a friendly label
  const firstHeading = (text) => {
    const m = (text || "").match(/^#{1,2}\s+(.+)$/m);
    return m ? m[1].trim().slice(0, 80) : null;
  };

  const fileNode = (rel, type, load, extra = {}) => {
    const text = readRepoText(rel);
    if (text == null) {
      warnings.push(`missing file: ${rel}`);
      return null;
    }
    const basename = rel.split("/").pop();
    return addNode(rel, {
      type,
      label: basename,
      path: rel,
      load,
      tokens: tokchars(text),
      bytes: text.length,
      meta: { heading: firstHeading(text), ...extra },
    });
  };

  // ─────────────────────────────── agent_instruction ──────────────────────
  const claudeMd = fileNode("CLAUDE.md", "agent_instruction", "always");
  fileNode("school-updates/CLAUDE.md", "agent_instruction", "scoped", {
    note: "loaded only when working under school-updates/",
  });

  // ─── read-first bundle: parse the "READ FIRST" section of CLAUDE.md ───────
  const readFirstDocs = [];
  if (claudeMd) {
    const text = readRepoText("CLAUDE.md") || "";
    const start = text.search(/READ FIRST/i);
    const end = text.search(/Rules \(non-negotiable\)/i);
    const region =
      start >= 0 ? text.slice(start, end > start ? end : start + 2000) : "";
    const seen = new Set();
    for (const m of region.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)) {
      const p = m[0];
      if (!seen.has(p)) {
        seen.add(p);
        readFirstDocs.push(p);
      }
    }
    if (readFirstDocs.length === 0)
      warnings.push("could not parse READ FIRST docs from CLAUDE.md");
  }
  const readFirstSet = new Set(readFirstDocs);

  // ─────────────────────────────── docs ───────────────────────────────────
  for (const rel of walk("docs", { exts: [".md"] })) {
    const load = readFirstSet.has(rel) ? "read-first" : "on-demand";
    fileNode(rel, "doc", load);
  }
  // ensure read-first docs exist as nodes + read_before edges from CLAUDE.md
  for (const rel of readFirstDocs) {
    if (!nodes.has(rel)) fileNode(rel, "doc", "read-first");
    if (nodes.has(rel)) {
      nodes.get(rel).load = "read-first";
      addEdge("CLAUDE.md", rel, "read_before");
    }
  }

  // ─────────────────────────── product_prompt ─────────────────────────────
  for (const rel of walk("openclaw/prompts", { exts: [".md"] })) {
    fileNode(rel, "product_prompt", "runtime", {
      note: "injected by the worker/router at request time",
    });
  }

  // ─────────────────────────── dev_agent_prompt ───────────────────────────
  for (const rel of walk("agents", { exts: [".md"] }))
    fileNode(rel, "dev_agent_prompt", "on-demand");
  for (const rel of walk("claws", { exts: [".md"] }))
    fileNode(rel, "dev_agent_prompt", "on-demand");

  // ─────────────────────────── memory_store ───────────────────────────────
  // SECURITY: never emit contents. Only populated + count.
  for (const rel of walk("memory/household", { exts: [".json", ".jsonl"] })) {
    const raw = readRepoText(rel);
    let count = 0;
    let shape = "unknown";
    if (raw != null) {
      if (rel.endsWith(".jsonl")) {
        count = raw.split("\n").filter((l) => l.trim().length > 0).length;
        shape = "jsonl";
      } else {
        try {
          const j = JSON.parse(raw);
          if (Array.isArray(j)) {
            count = j.length;
            shape = "array";
          } else if (j && typeof j === "object") {
            count = Object.keys(j).length;
            shape = "object";
          }
        } catch {
          warnings.push(`memory parse error: ${rel}`);
        }
      }
    }
    addNode(rel, {
      type: "memory_store",
      label: rel.split("/").pop(),
      path: rel,
      load: "runtime",
      tokens: 0, // contents intentionally not measured / not exposed
      meta: { populated: count > 0, count, shape },
    });
  }

  // ─────────────────────────── derived_flag ───────────────────────────────
  // Parse the DerivedState typedef in src/state/types.js.
  const typesText = readRepoText("src/state/types.js") || "";
  const tdStart = typesText.indexOf("@typedef {Object} DerivedState");
  let flagNames = [];
  if (tdStart >= 0) {
    const tdEnd = typesText.indexOf("*/", tdStart);
    const block = typesText.slice(tdStart, tdEnd > 0 ? tdEnd : undefined);
    for (const m of block.matchAll(/@property\s+\{([^}]+)\}\s+\[?([A-Za-z0-9_]+)\]?/g)) {
      const jsType = m[1].trim();
      const name = m[2].trim();
      const isBool = /boolean/.test(jsType);
      flagNames.push({ name, jsType, isBool });
    }
  } else {
    warnings.push("DerivedState typedef not found in src/state/types.js");
  }
  const governingFlags = new Set(FLAG_DECIDES_CARD.map(([f]) => f));
  for (const f of flagNames) {
    // Keep boolean flags + any flag that governs a card; skip structured-only
    // payload fields to keep the graph legible.
    if (!f.isBool && !governingFlags.has(f.name)) continue;
    addNode(`flag:${f.name}`, {
      type: "derived_flag",
      label: f.name,
      load: "runtime",
      tokens: 0,
      meta: { jsType: f.jsType, source: DERIVATIONS },
    });
  }

  // ─────────────────────────────── card ───────────────────────────────────
  const registryText = readRepoText(REGISTRY) || "";
  const cardBlocks = registryText.split(/\},\s*\{/); // crude per-card split
  const cardIds = [];
  for (const m of registryText.matchAll(
    /id:\s*"([^"]+)"[\s\S]*?tier:\s*(\d)[\s\S]*?placement?[\s\S]*?enhancementFeature:\s*"([^"]+)"/g,
  )) {
    // (best-effort; fallback below covers any miss)
  }
  for (const m of registryText.matchAll(/id:\s*"([^"]+)"/g)) cardIds.push(m[1]);
  const cardMeta = {};
  for (const block of cardBlocks) {
    const id = block.match(/id:\s*"([^"]+)"/)?.[1];
    if (!id) continue;
    cardMeta[id] = {
      tier: Number(block.match(/tier:\s*(\d)/)?.[1]) || null,
      placement: block.match(/placement:\s*"([^"]+)"/)?.[1] || null,
      enhancementFeature: block.match(/enhancementFeature:\s*"([^"]+)"/)?.[1] || null,
    };
  }
  for (const id of [...new Set(cardIds)]) {
    addNode(`card:${id}`, {
      type: "card",
      label: id,
      load: "runtime",
      tokens: 0,
      meta: { source: REGISTRY, ...(cardMeta[id] || {}) },
    });
  }
  if (cardIds.length === 0) warnings.push("no cards parsed from registry.js");

  // ─────────────────────────────── eval ───────────────────────────────────
  for (const rel of walk("openclaw/eval/queries", { exts: [".json"] })) {
    const raw = readRepoText(rel);
    let count = 0;
    try {
      const j = JSON.parse(raw);
      count = Array.isArray(j)
        ? j.length
        : Array.isArray(j.queries)
          ? j.queries.length
          : Object.keys(j || {}).length;
    } catch {
      warnings.push(`eval parse error: ${rel}`);
    }
    addNode(rel, {
      type: "eval",
      label: rel.split("/").pop(),
      path: rel,
      load: "ci/eval",
      tokens: 0,
      meta: { queryCount: count },
    });
  }

  // ─────────────────────────── router_tier ────────────────────────────────
  const cfgText = readRepoText(ROUTER_CFG) || "";
  const tiersStart = cfgText.indexOf("tiers:");
  if (tiersStart >= 0) {
    // top-level tier keys are indented 4 spaces inside `tiers: {`
    const tierRe = /^\s{4}(\w+):\s*\{/gm;
    const region = cfgText.slice(tiersStart);
    for (const m of region.matchAll(tierRe)) {
      const name = m[1];
      // read a small window to find enabled:
      const after = region.slice(m.index, m.index + 400);
      const enabledRaw = after.match(/enabled:\s*([^,\n]+)/)?.[1]?.trim() || null;
      // Honest tri-state: literal true/false vs env-conditional.
      let enabledState = "unknown";
      if (enabledRaw) {
        if (/^true\b/.test(enabledRaw)) enabledState = "on";
        else if (/^false\b/.test(enabledRaw)) enabledState = "off";
        else enabledState = "conditional";
      }
      addNode(`tier:${name}`, {
        type: "router_tier",
        label: name,
        load: "runtime",
        tokens: 0,
        meta: { source: ROUTER_CFG, enabledExpr: enabledRaw, enabledState },
      });
    }
  } else {
    warnings.push("router tiers not found in config.js");
  }

  // ─────────────────────────── code_module ────────────────────────────────
  for (const rel of [DERIVATIONS, REGISTRY, OPENCLAW, DERIVE_SHIM, ROUTER_CFG]) {
    fileNode(rel, "code_module", "code");
  }
  // test files as code_module (role: test) — there is no dedicated test type.
  for (const rel of TEST_FILES) {
    const node = fileNode(rel, "code_module", "code", { role: "test" });
    if (node) node.meta.role = "test";
  }

  // ─────────────────────────────── ci_job ─────────────────────────────────
  // Parse jobs + their run-command text from each workflow (light YAML scan).
  const ciJobs = []; // {id, name, file, runText}
  for (const rel of walk(".github/workflows", { exts: [".yml", ".yaml"] })) {
    const text = readRepoText(rel) || "";
    const lines = text.split("\n");
    let inJobs = false;
    let current = null;
    const flush = () => {
      if (current) ciJobs.push(current);
      current = null;
    };
    for (const line of lines) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
        continue;
      }
      if (!inJobs) continue;
      const jobMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (jobMatch) {
        flush();
        current = { id: jobMatch[1], name: jobMatch[1], file: rel, runText: "" };
        continue;
      }
      if (current) {
        const nameMatch = line.match(/^ {4}name:\s*(.+)$/);
        if (nameMatch) current.name = nameMatch[1].replace(/^["']|["']$/g, "");
        current.runText += line + "\n";
      }
    }
    flush();
  }
  for (const job of ciJobs) {
    addNode(`ci:${job.file}:${job.id}`, {
      type: "ci_job",
      label: job.name || job.id,
      load: "ci",
      tokens: 0,
      meta: {
        jobId: job.id,
        workflow: job.file.split("/").pop(),
        runsTests: /\bnpm test\b|\bnpm run verify\b|\bvitest\b/.test(job.runText),
        runsBuild: /\bnpm run build\b/.test(job.runText),
      },
    });
  }

  // ────────────────────────────── EDGES ───────────────────────────────────
  // decides: derivations module → registry; flag → card
  addEdge(DERIVATIONS, REGISTRY, "decides", {
    note: "derived flags decide card visibility",
  });
  for (const [flag, cardId] of FLAG_DECIDES_CARD) {
    if (nodes.has(`flag:${flag}`) && nodes.has(`card:${cardId}`))
      addEdge(`flag:${flag}`, `card:${cardId}`, "decides");
  }
  // shim → derivations (re-export relationship)
  addEdge(DERIVE_SHIM, DERIVATIONS, "references", { note: "8-line re-export shim" });

  // enhances: openclaw → each card (copy only, non-decisive)
  for (const id of [...new Set(cardIds)])
    if (nodes.has(`card:${id}`)) addEdge(OPENCLAW, `card:${id}`, "enhances");
  addEdge(OPENCLAW, ROUTER_CFG, "references", { note: "router tier config" });

  // protected_by: parse each test's imports → modules it covers
  for (const rel of TEST_FILES) {
    const text = readRepoText(rel);
    if (!text) continue;
    const covered = new Set();
    for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const mod = importToModule(m[1], rel);
      if (mod && nodes.has(mod)) covered.add(mod);
    }
    for (const mod of covered) addEdge(mod, rel, "protected_by");
  }

  // gated_in_ci: a test node is gated by any ci_job that runs the test suite
  const testJobs = ciJobs.filter((j) => {
    const node = nodes.get(`ci:${j.file}:${j.id}`);
    return node?.meta?.runsTests;
  });
  for (const rel of TEST_FILES) {
    if (!nodes.has(rel)) continue;
    for (const j of testJobs) addEdge(rel, `ci:${j.file}:${j.id}`, "gated_in_ci");
  }

  // CI gaps: scripts that SHOULD be protective but appear in no workflow run.
  const allRunText = ciJobs.map((j) => j.runText).join("\n");
  const ciGaps = [];
  for (const script of ["agentci:gate", "eval:score", "eval:taxonomy", "agentci"]) {
    if (!allRunText.includes(script)) ciGaps.push(script);
  }

  // references + dangling-path detection across docs / prompts / agents.
  const danglingRefs = [];
  const scanForRefs = [
    "CLAUDE.md",
    "school-updates/CLAUDE.md",
    ...walk("docs", { exts: [".md"] }),
    ...walk("claws", { exts: [".md"] }),
    ...walk("agents", { exts: [".md"] }),
    ...walk("openclaw/prompts", { exts: [".md"] }),
  ];
  const pathRe =
    /(?:\]\(|["'`])((?:\.\.?\/)?(?:src|docs|openclaw|scripts|pi|voice-service|agents|claws|memory|deploy|email-triage|school-updates|\.github)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8})/g;
  for (const src of scanForRefs) {
    const text = readRepoText(src);
    if (!text) continue;
    const seen = new Set();
    for (const m of text.matchAll(pathRe)) {
      let p = m[1];
      if (p.startsWith("./") || p.startsWith("../")) {
        // resolve relative to the source file's directory
        const dir = src.split("/").slice(0, -1).join("/");
        const parts = (dir + "/" + p).split("/");
        const stack = [];
        for (const part of parts) {
          if (part === "." || part === "") continue;
          if (part === "..") stack.pop();
          else stack.push(part);
        }
        p = stack.join("/");
      }
      if (seen.has(p)) continue;
      seen.add(p);
      if (repoExists(p)) {
        if (nodes.has(p) && p !== src) addEdge(src, p, "references");
      } else {
        danglingRefs.push({ source: src, path: p });
      }
    }
  }

  // duplicates: identical substantial blocks shared across ≥2 markdown files.
  const blockOwners = new Map(); // hash -> Set(files)
  const blockText = new Map();
  const mdFiles = scanForRefs;
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
  };
  for (const src of mdFiles) {
    const text = readRepoText(src);
    if (!text) continue;
    for (const block of text.split(/\n\s*\n/)) {
      const norm = block.replace(/\s+/g, " ").trim().toLowerCase();
      if (norm.length < 200) continue;
      const h = hash(norm);
      if (!blockOwners.has(h)) {
        blockOwners.set(h, new Set());
        blockText.set(h, norm.slice(0, 60));
      }
      blockOwners.get(h).add(src);
    }
  }
  const dupPairs = new Map(); // "a|b" -> count
  for (const [, owners] of blockOwners) {
    if (owners.size < 2) continue;
    const arr = [...owners].sort();
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}|${arr[j]}`;
        dupPairs.set(key, (dupPairs.get(key) || 0) + 1);
      }
  }
  let duplicatePairs = 0;
  for (const [key, count] of [...dupPairs.entries()].sort((a, b) => b[1] - a[1])) {
    const [a, b] = key.split("|");
    if (nodes.has(a) && nodes.has(b)) {
      addEdge(a, b, "duplicates", { sharedBlocks: count });
      duplicatePairs++;
    }
  }

  // ────────────────────────────── summary ─────────────────────────────────
  const nodeList = [...nodes.values()];
  const alwaysTokens = nodeList
    .filter((n) => n.load === "always")
    .reduce((s, n) => s + (n.tokens || 0), 0);
  const readFirstTokens = nodeList
    .filter((n) => n.load === "read-first")
    .reduce((s, n) => s + (n.tokens || 0), 0);
  const totalTokens = nodeList.reduce((s, n) => s + (n.tokens || 0), 0);

  const edgeCounts = {};
  for (const e of edges) edgeCounts[e.type] = (edgeCounts[e.type] || 0) + 1;
  const nodeCounts = {};
  for (const n of nodeList) nodeCounts[n.type] = (nodeCounts[n.type] || 0) + 1;

  const out = {
    generatedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    budgets: { claudeMd: 4000, readFirst: 22000 },
    summary: {
      alwaysTokens,
      readFirstTokens,
      totalTokens,
      nodeCount: nodeList.length,
      edgeCount: edges.length,
      nodeCounts,
      edgeCounts,
      danglingCount: danglingRefs.length,
      duplicatePairs,
      ciGaps,
      claudeMdOverBudget: alwaysTokens > 4000,
      readFirstOverBudget: readFirstTokens > 22000,
    },
    nodes: nodeList,
    edges,
    danglingRefs,
    warnings,
  };

  return redactDeep(out);
}

export function writeMap() {
  ensureCache();
  const map = generateMap();
  const path = join(CACHE_DIR, "context-map.json");
  writeFileSync(path, JSON.stringify(map, null, 2));
  return { path, map };
}

// Run directly: node scripts/context-map.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const { path, map } = writeMap();
  const s = map.summary;
  console.log(`context-map → ${path}`);
  console.log(
    `  ${s.nodeCount} nodes, ${s.edgeCount} edges | always=${s.alwaysTokens}tok (budget 4000${s.claudeMdOverBudget ? " ⚠ OVER" : ""}), read-first=${s.readFirstTokens}tok (budget 22000${s.readFirstOverBudget ? " ⚠ OVER" : ""})`,
  );
  console.log(
    `  dangling refs: ${s.danglingCount} | duplicate pairs: ${s.duplicatePairs} | CI gaps: ${s.ciGaps.join(", ") || "none"}`,
  );
  if (map.warnings.length) console.log(`  warnings: ${map.warnings.join("; ")}`);
}
