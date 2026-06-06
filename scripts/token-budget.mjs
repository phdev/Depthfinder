// Token budget generator.
//
// Orchestrates `npx repomix --token-count-tree` (o200k_base) against the repo
// and parses its tree into a nested path→tokens structure. Calls out the
// always-loaded total (CLAUDE.md ≤ 4k) and the read-first bundle (≤ 22k).
//
// The packed output is redirected into .cache (never the repo) and deleted
// after; only the token-count tree is parsed. If repomix is unavailable,
// falls back to a chars/4 estimate over a repo walk.
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  CACHE_DIR,
  ensureCache,
  readRepoText,
  walk,
  tokchars,
} from "../lib/repo.mjs";
import { redactDeep } from "../lib/redact.mjs";

const CACHE = join(CACHE_DIR, "tokens.json");
const PACK_TMP = join(CACHE_DIR, "repomix-output.xml");
const BUDGETS = { claudeMd: 4000, readFirst: 22000 };

// The read-first bundle = the docs listed under CLAUDE.md "READ FIRST".
function readFirstDocs() {
  const text = readRepoText("CLAUDE.md") || "";
  const start = text.search(/READ FIRST/i);
  const end = text.search(/Rules \(non-negotiable\)/i);
  const region = start >= 0 ? text.slice(start, end > start ? end : start + 2000) : "";
  const out = [];
  const seen = new Set();
  for (const m of region.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g))
    if (!seen.has(m[0])) (seen.add(m[0]), out.push(m[0]));
  return out;
}

// ── repomix ──────────────────────────────────────────────────────────────
function runRepomix() {
  ensureCache();
  try {
    // Bare `--token-count-tree` (NO threshold — `0` suppresses it) prints the
    // tree to stdout even without a TTY. Packed XML goes to .cache via -o.
    const res = spawnSync(
      "npx",
      ["-y", "repomix", "--token-count-tree", "-o", PACK_TMP],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 180000, maxBuffer: 128 * 1024 * 1024 },
    );
    const raw = `${res.stdout || ""}\n${res.stderr || ""}`;
    if (/Token Count Tree/.test(raw)) return { ok: true, raw };
    return { ok: false, error: res.error?.message || `repomix exit ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try {
      unlinkSync(PACK_TMP);
    } catch {}
  }
}

function parseRepomixTree(raw) {
  const clean = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
  const lines = clean.split("\n");
  const start = lines.findIndex((l) => /Token Count Tree/.test(l));
  if (start < 0) return null;
  const root = { name: "(repo)", path: "", tokens: 0, isDir: true, children: [] };
  const stack = [{ node: root, depth: -1 }];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/Pack Summary|Security Check|All Done|🎉/.test(line)) break;
    const connIdx = line.search(/[├└]── /);
    if (connIdx < 0) continue;
    const m = line.slice(connIdx + 4).match(/^(.+?) \(([\d,]+) tokens\)\s*$/);
    if (!m) continue;
    const depth = connIdx / 4;
    const isDir = m[1].endsWith("/");
    const name = isDir ? m[1].slice(0, -1) : m[1];
    const tokens = parseInt(m[2].replace(/,/g, ""), 10);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1].node;
    const path = parent.path ? `${parent.path}/${name}` : name;
    const node = { name, path, tokens, isDir, children: [] };
    parent.children.push(node);
    stack.push({ node, depth });
  }
  root.tokens = root.children.reduce((s, c) => s + c.tokens, 0);
  return root.children.length ? root : null;
}

// ── chars/4 fallback ─────────────────────────────────────────────────────
const BINARY = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2",
  ".ttf", ".otf", ".mp3", ".wav", ".onnx", ".bin", ".pdf", ".zip", ".gz",
]);
function buildFallbackTree() {
  const root = { name: "(repo)", path: "", tokens: 0, isDir: true, children: [] };
  const index = new Map([["", root]]);
  const ensureDir = (relDir) => {
    if (index.has(relDir)) return index.get(relDir);
    const parts = relDir.split("/");
    const name = parts.pop();
    const parent = ensureDir(parts.join("/"));
    const node = { name, path: relDir, tokens: 0, isDir: true, children: [] };
    parent.children.push(node);
    index.set(relDir, node);
    return node;
  };
  for (const rel of walk("", { exts: null })) {
    const dot = rel.lastIndexOf(".");
    if (dot >= 0 && BINARY.has(rel.slice(dot).toLowerCase())) continue;
    const text = readRepoText(rel);
    if (text == null) continue;
    const tokens = tokchars(text);
    const parts = rel.split("/");
    const name = parts.pop();
    const parent = ensureDir(parts.join("/"));
    parent.children.push({ name, path: rel, tokens, isDir: false, children: [] });
  }
  const rollup = (n) => {
    if (!n.isDir) return n.tokens;
    n.tokens = n.children.reduce((s, c) => s + rollup(c), 0);
    return n.tokens;
  };
  rollup(root);
  return root;
}

// ── assemble ─────────────────────────────────────────────────────────────
function flatten(root) {
  const map = new Map();
  const visit = (n) => {
    if (n.path) map.set(n.path, n.tokens);
    n.children.forEach(visit);
  };
  visit(root);
  return map;
}
function leaves(root) {
  const out = [];
  const visit = (n) => (n.isDir ? n.children.forEach(visit) : out.push(n));
  visit(root);
  return out;
}
function sortTree(n) {
  n.children.sort((a, b) => b.tokens - a.tokens).forEach(sortTree);
  return n;
}

export function generateTokens() {
  const r = runRepomix();
  let root = r.ok ? parseRepomixTree(r.raw) : null;
  let source = "repomix · o200k_base";
  if (!root) {
    root = buildFallbackTree();
    source = "chars/4 estimate (repomix unavailable)";
  }
  sortTree(root);
  const byPath = flatten(root);
  const totalTokens = root.tokens;
  const fileCount = leaves(root).length;

  const claudeMd = byPath.get("CLAUDE.md") || 0;
  const rfDocs = readFirstDocs();
  const rfFiles = rfDocs.map((p) => ({ path: p, tokens: byPath.get(p) || 0 }));
  const readFirst = rfFiles.reduce((s, f) => s + f.tokens, 0);

  const topFiles = leaves(root)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 15)
    .map((n) => ({ path: n.path, tokens: n.tokens, pct: totalTokens ? n.tokens / totalTokens : 0 }));

  return redactDeep({
    generatedAt: new Date().toISOString(),
    source,
    budgets: BUDGETS,
    totals: { totalTokens, fileCount },
    callouts: {
      claudeMd: {
        tokens: claudeMd,
        budget: BUDGETS.claudeMd,
        over: claudeMd > BUDGETS.claudeMd,
        ratio: claudeMd / BUDGETS.claudeMd,
      },
      readFirst: {
        tokens: readFirst,
        budget: BUDGETS.readFirst,
        over: readFirst > BUDGETS.readFirst,
        ratio: readFirst / BUDGETS.readFirst,
        files: rfFiles,
      },
    },
    topFiles,
    tree: root,
  });
}

export function writeTokens() {
  ensureCache();
  const data = generateTokens();
  writeFileSync(CACHE, JSON.stringify(data, null, 2));
  return data;
}

export function readTokens() {
  if (existsSync(CACHE)) {
    try {
      return JSON.parse(readFileSync(CACHE, "utf8"));
    } catch {}
  }
  return writeTokens();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = writeTokens();
  const c = data.callouts;
  console.log(`token-budget → ${CACHE}  (${data.source})`);
  console.log(`  total: ${data.totals.totalTokens.toLocaleString()} tok over ${data.totals.fileCount} files`);
  console.log(`  CLAUDE.md: ${c.claudeMd.tokens.toLocaleString()} / ${c.claudeMd.budget} ${c.claudeMd.over ? "⚠ OVER" : "ok"}`);
  console.log(`  read-first: ${c.readFirst.tokens.toLocaleString()} / ${c.readFirst.budget} ${c.readFirst.over ? "⚠ OVER" : "ok"}`);
}
