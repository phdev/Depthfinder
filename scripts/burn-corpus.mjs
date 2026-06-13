#!/usr/bin/env node
// Burn corpus — exercise V1.1 `--burn` across every rot type.
//
// `--burn` only fires on a repo's #1 false claim, so to validate the moment
// for paths, dependencies, counts, and symbols we need repos where each of
// those is the top finding. Public repos are mostly clean (no rot to burn),
// so the reliable core is a set of HERMETIC synthetic repos, each planting
// exactly one false claim of a given kind. Run them through `--burn` and read
// what the agent does with each.
//
//   node scripts/burn-corpus.mjs            # synthetic repos, stub agent (CI smoke)
//   node scripts/burn-corpus.mjs --real     # synthetic repos, real local agent
//   node scripts/burn-corpus.mjs --agent "claude -p"
//   node scripts/burn-corpus.mjs --real-repos   # REAL rotten public repos,
//                                               # full report: Context + Doc + Burn
//
// Stub mode is a fast offline regression. --real-repos is the headline demo:
// the burn moment lands on REAL, specific rot (synthetic dead-paths make
// frontier agents hedge; real moved-file rot makes them take the bait).
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { materialize, makeRepo, runCli, cleanup, STUB_AGENT } from "../tests/helpers/fixture.mjs";

const { values } = parseArgs({
  options: {
    real: { type: "boolean" },
    agent: { type: "string" },
    "real-repos": { type: "boolean" },
    cache: { type: "string" },
  },
});

// Agent the burn shadows. Default: the deterministic stub. --real: let the CLI
// autodetect a local agent. --agent: explicit command.
const env =
  values.agent ? { DEPTHFINDER_BURN_AGENT: values.agent }
  : values.real ? {} // CLI autodetects claude/codex
  : { DEPTHFINDER_BURN_AGENT: `${process.execPath} ${STUB_AGENT}` };
const agentLabel = values.agent || (values.real ? "auto (claude/codex)" : "stub");

// Each entry materializes a hermetic repo whose TOP finding is the named rot
// type, so --burn fires on it. makeRepo = single commit; materialize("dirty")
// carries a real deletion (stale-path: "deleted at <sha>").
const CORPUS = [
  {
    name: "stale-path (deleted)",
    oracle: "path",
    make: () => materialize("dirty"), // top finding: src/auth/oauth.ts, deleted commit 2
  },
  {
    name: "dead-path (never existed)",
    oracle: "path",
    make: () => makeRepo({
      "package.json": JSON.stringify({ name: "svc", version: "1.0.0" }) + "\n",
      "src/index.ts": "export const app = 1\n",
      "src/server.ts": "export const server = 1\n",
      "CLAUDE.md": [
        "# svc",
        "",
        "Entry is `src/index.ts`; the HTTP layer is `src/server.ts`.",
        "The configuration loader lives in `src/config/settings.ts`.",
        "",
      ].join("\n"),
    }),
  },
  {
    name: "missing-dependency",
    oracle: "dependency",
    make: () => makeRepo({
      "package.json": JSON.stringify({ name: "voice", version: "1.0.0", dependencies: { "node-fetch": "^3.0.0" } }) + "\n",
      "src/index.js": "export const x = 1\n",
      "CLAUDE.md": [
        "# voice",
        "",
        "Entry is `src/index.js`. Wake word handled by `porcupine-node`.",
        "",
      ].join("\n"),
    }),
  },
  {
    name: "wrong-count",
    oracle: "count",
    make: () => makeRepo({
      "router/config.js": "export const tiers = { cache: {}, local: {}, cloud: {} }\n",
      "src/index.js": "export const x = 1\n",
      "CLAUDE.md": [
        "# router",
        "",
        "Entry is `src/index.js`.",
        "Model routing uses 4 tiers (see `router/config.js`).",
        "",
      ].join("\n"),
    }),
  },
  {
    name: "missing-symbol",
    oracle: "symbol",
    make: () => makeRepo({
      "src/engine.js": "export function bootEngine() {}\nexport const ready = true\n",
      "src/index.js": "export const x = 1\n",
      "CLAUDE.md": [
        "# eng",
        "",
        "Entry is `src/index.js`.",
        "The engine `src/engine.js` exports `startEngine`.",
        "",
      ].join("\n"),
    }),
  },
];

function wrap(s, width, indent) {
  const out = [];
  let cur = "";
  for (const w of (s || "").replace(/\s+/g, " ").trim().split(" ")) {
    if (cur && cur.length + 1 + w.length > width) { out.push(indent + cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(indent + cur);
  return out.slice(0, 8);
}

// ── --real-repos: the headline report over genuinely rotten public repos ──
// Confirmed real rot (hand-verified 2026-06-13). Shallow-cloned to --cache
// (default /tmp/df-corpus, reused if already present).
const REAL_ROT = [
  { name: "All-Hands-AI/OpenHands", url: "https://github.com/All-Hands-AI/OpenHands" },
  { name: "openai/codex", url: "https://github.com/openai/codex" },
  { name: "danny-avila/LibreChat", url: "https://github.com/danny-avila/LibreChat" },
  { name: "mastra-ai/mastra", url: "https://github.com/mastra-ai/mastra" },
  { name: "continuedev/continue", url: "https://github.com/continuedev/continue" },
  { name: "BerriAI/litellm", url: "https://github.com/BerriAI/litellm" },
];

function cloneOrReuse(repo, cacheDir) {
  const dir = join(cacheDir, repo.name.replace("/", "__"));
  if (existsSync(join(dir, ".git"))) return dir;
  mkdirSync(cacheDir, { recursive: true });
  const r = spawnSync("git", ["clone", "--depth", "1", "--quiet", repo.url, dir], { encoding: "utf8" });
  return r.status === 0 ? dir : { error: (r.stderr || "clone failed").trim().split("\n").pop() };
}

function runRealRepos() {
  const cacheDir = values.cache || "/tmp/df-corpus";
  // Real burns by default (the point); --agent forces an override (e.g. a stub).
  const burnEnv = values.agent ? { DEPTHFINDER_BURN_AGENT: values.agent } : {};
  console.log(`\n  Depthfinder real-rot corpus — ${REAL_ROT.length} repos · cache ${cacheDir} · burn: ${values.agent || "auto (claude/codex)"}\n`);
  for (const repo of REAL_ROT) {
    console.log(`  ${repo.name}`);
    const dir = cloneOrReuse(repo, cacheDir);
    if (dir.error) { console.log(`      clone error: ${dir.error}\n`); continue; }
    const r = runCli(dir, ["--json", "--docs", "--burn"], burnEnv);
    if (r.code === 3) { console.log(`      (no context files)\n`); continue; }
    let p; try { p = JSON.parse(r.stdout); } catch { console.log(`      scan error (exit ${r.code})\n`); continue; }
    console.log(`      Context Honesty: ${p.score.honesty ?? "—"} · ${p.score.definite} claims · ${p.score.false} false`);
    console.log(`      Doc Honesty:     ${p.docScore ? `${p.docScore.honesty ?? "—"} · ${p.docScore.definite} claims · ${p.docs.scanned} docs · ${p.docScore.false} dead refs` : "—"}`);
    const burned = [...(p.claims || []), ...(p.docClaims || [])].find((c) => c.burn);
    if (!burned) { console.log(`      Burn:            (no false claim to burn)\n`); continue; }
    if (burned.burn.error) { console.log(`      Burn:            skipped — ${burned.burn.error}\n`); continue; }
    const a = burned.predicate.args;
    const tgt = a.path ?? a.name ?? a.symbol ?? `${a.n} ${a.noun}`;
    console.log(`      Burn target:     [${burned.tier || "context"}] ${tgt}  @ ${burned.source.file}:${burned.source.line}`);
    console.log(`      Agent said:`);
    for (const ln of wrap(burned.burn.output, 66, "          ")) console.log(ln);
    console.log("");
  }
}

if (values["real-repos"]) {
  runRealRepos();
} else {

console.log(`\n  Depthfinder burn corpus — ${CORPUS.length} repos · agent: ${agentLabel}\n`);
let withFinding = 0, burned = 0;

for (const entry of CORPUS) {
  const root = entry.make();
  try {
    const r = runCli(root, ["--json", "--burn"], env);
    const p = JSON.parse(r.stdout);
    const finding = (p.claims || []).find((c) => c.verdict === "false");
    if (!finding) { console.log(`  ${entry.name.padEnd(26)} — NO FINDING (expected ${entry.oracle})`); continue; }
    withFinding++;
    const arg = finding.predicate.args;
    const target = arg.path ?? arg.name ?? arg.symbol ?? `${arg.n} ${arg.noun}`;
    const ok = finding.oracle === entry.oracle ? "" : `  ⚠ got ${finding.oracle}, expected ${entry.oracle}`;
    console.log(`  ${entry.name.padEnd(26)} [${finding.oracle}] ${target}${ok}`);
    console.log(`      claim:  "${finding.text.replace(/\s+/g, " ").trim()}"`);
    console.log(`      truth:  ${finding.evidence.summary}`);
    if (finding.burn?.error) {
      console.log(`      burn:   skipped — ${finding.burn.error}`);
    } else if (finding.burn?.output) {
      burned++;
      const lines = wrap(finding.burn.output, 64, "              ");
      console.log(`      burn:   ${lines[0].trimStart()}`);
      for (const ln of lines.slice(1)) console.log(ln);
    } else {
      console.log(`      burn:   (none)`);
    }
    console.log("");
  } finally {
    cleanup(root);
  }
}

console.log(`  ${withFinding}/${CORPUS.length} produced a finding · ${burned}/${CORPUS.length} burned`);
process.exitCode = withFinding === CORPUS.length ? 0 : 1;

}
