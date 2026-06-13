#!/usr/bin/env node
// Multi-repo zero-false-accusation gate — the docs-audit publish gate.
//
// Default-on doc accusations are only credible once they're validated beyond
// home-center (one self-authored corpus). A first-run FALSE accusation on a
// stranger's repo is the fatal error this gate exists to catch. The harness
// shallow-clones a pinned set of public repos that carry an agent context
// file, runs depthfinder on each, and prints EVERY false verdict (Context AND
// Doc tier) for hand-verification. Exit 1 if any false survives.
//
//   node scripts/doc-corpus.mjs [--cache <dir>] [--keep] [--repos a,b]
//
// This NEVER scans your local working repos — only fresh public clones under
// <cache> (default: a temp dir, removed unless --keep). Edit REPOS to curate.
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "depthfinder.mjs");

// Pinned public repos that carry CLAUDE.md / AGENTS.md / .cursorrules AND real
// docs. Curated for diversity (TS/Py/Go/Rust, monorepo, doc-heavy). Repos
// without a context file exit 3 and are reported as "no context files".
const REPOS = [
  { name: "openai/codex", url: "https://github.com/openai/codex" },
  { name: "sst/opencode", url: "https://github.com/sst/opencode" },
  { name: "block/goose", url: "https://github.com/block/goose" },
  { name: "browserbase/stagehand", url: "https://github.com/browserbase/stagehand" },
  { name: "cloudflare/agents", url: "https://github.com/cloudflare/agents" },
  { name: "modelcontextprotocol/servers", url: "https://github.com/modelcontextprotocol/servers" },
  { name: "anthropics/anthropic-sdk-python", url: "https://github.com/anthropics/anthropic-sdk-python" },
  { name: "vercel/ai", url: "https://github.com/vercel/ai" },
];

const { values } = parseArgs({
  options: {
    cache: { type: "string" },
    keep: { type: "boolean" },
    repos: { type: "string" }, // comma-separated name filter
  },
});

const cacheDir = values.cache
  ? (mkdirSync(values.cache, { recursive: true }), values.cache)
  : mkdtempSync(join(tmpdir(), "df-corpus-"));
const filter = values.repos ? new Set(values.repos.split(",")) : null;
const repos = filter ? REPOS.filter((r) => filter.has(r.name)) : REPOS;

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

function clone(repo) {
  const dir = join(cacheDir, repo.name.replace("/", "__"));
  if (existsSync(join(dir, ".git"))) return dir; // reuse
  const r = sh("git", ["clone", "--depth", "1", "--quiet", repo.url, dir]);
  if (r.status !== 0) return { error: (r.stderr || "clone failed").trim().split("\n").pop() };
  return dir;
}

function scan(dir) {
  const r = sh(process.execPath, [BIN, dir, "--json"]);
  if (r.status === 3) return { skipped: "no context files" };
  if (r.status !== 0) return { error: `exit ${r.status}: ${(r.stderr || "").trim().split("\n").pop()}` };
  try {
    return { payload: JSON.parse(r.stdout) };
  } catch {
    return { error: "unparseable --json" };
  }
}

const falses = []; // every false verdict across the corpus, for hand-verify
const rows = [];
console.log(`\n  Depthfinder doc-corpus gate — ${repos.length} repos → ${cacheDir}\n`);

for (const repo of repos) {
  process.stdout.write(`  ${repo.name.padEnd(38)} `);
  const dir = clone(repo);
  if (dir.error) { console.log(`clone error: ${dir.error}`); rows.push({ repo: repo.name, note: "clone error" }); continue; }
  const head = sh("git", ["-C", dir, "rev-parse", "--short", "HEAD"]).stdout.trim();
  const res = scan(dir);
  if (res.skipped) { console.log(`— ${res.skipped}`); rows.push({ repo: repo.name, note: res.skipped }); continue; }
  if (res.error) { console.log(`scan error: ${res.error}`); rows.push({ repo: repo.name, note: res.error }); continue; }

  const p = res.payload;
  const ctxFalse = (p.claims || []).filter((c) => c.verdict === "false");
  const docFalse = (p.docClaims || []).filter((c) => c.verdict === "false");
  for (const c of [...ctxFalse.map((c) => ({ ...c, tier: "context" })), ...docFalse.map((c) => ({ ...c, tier: "doc" }))])
    falses.push({ repo: repo.name, head, ...c });
  rows.push({
    repo: repo.name, head,
    ctx: `${p.score.honesty ?? "—"}·${p.score.definite}`,
    doc: p.docScore ? `${p.docScore.honesty ?? "—"}·${p.docScore.definite}·${p.docs.scanned}docs` : "no docs",
    false: ctxFalse.length + docFalse.length,
  });
  console.log(`ctx ${rows.at(-1).ctx}  doc ${rows.at(-1).doc}  false ${rows.at(-1).false}  @${head}`);
}

console.log("\n  ── false verdicts (HAND-VERIFY each: real dangling ref, or a tool FP?) ──");
if (falses.length === 0) {
  console.log("  none — zero false accusations across the corpus ✓\n");
} else {
  for (const f of falses) {
    const arg = f.predicate?.args || {};
    const target = arg.path ?? arg.name ?? arg.symbol ?? arg.noun ?? JSON.stringify(arg);
    console.log(`  [${f.tier}] ${f.repo}  ${target}`);
    console.log(`      @ ${f.source.file}:${f.source.line} — ${(f.text || "").replace(/\s+/g, " ").slice(0, 100)}`);
  }
  console.log("");
}

const scanned = rows.filter((r) => r.false !== undefined).length;
console.log(`  scanned ${scanned}/${repos.length} repos · ${falses.length} false verdict(s) total`);
if (!values.keep && !values.cache) rmSync(cacheDir, { recursive: true, force: true });
else console.log(`  clones kept at ${cacheDir}`);

// Gate: any false verdict that hand-verification finds to be a FALSE POSITIVE
// must be fixed (harden docmode / grammar) before a publish tag. The harness
// can't tell a real dangling ref from an FP — it surfaces them; you decide.
process.exitCode = falses.length === 0 ? 0 : 1;
