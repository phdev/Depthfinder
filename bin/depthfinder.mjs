#!/usr/bin/env node
// depthfinder — keep your AI context honest.
//
// Zero-config: `npx depthfinder [path]`. Deterministic oracles only; no
// model calls (except opt-in --burn); nothing leaves your machine. Default run
// writes NOTHING to the scanned repo (5A); it records one score-history line
// in the user cache dir (--no-history to skip).
//
//   Exit codes (full table — absorb #4):
//     0  ran successfully (findings or not — the default run is advisory)
//     1  internal error (uncaught)
//     2  usage error / bad --out / not a git repo / git binary missing
//     3  no context files found
//     20 --strict gate breach: Context Honesty has > --max-false false claims,
//        OR a context file couldn't be verified (skipped/unread → fail-closed).
//        Outside Node's reserved 1-13 range so a wrapper/CI Action can tell it
//        from a tool crash; only ever appears under --strict. Precedence: 2 > 3 > 20 > 0.
//
//   Pipeline:
//     cwd ─▶ git root ─▶ ls-files Set ─▶ discover context files
//        ─▶ ingest (7A policy) ─▶ extract (4 oracles) ─▶ evaluate
//        ─▶ score + dead tokens ─▶ top-3 ─▶ lazy git evidence ─▶ render
//
// Stream discipline (8A): stdout carries the card or --json payload ONLY;
// every diagnostic goes to stderr. Redaction (1A) wraps both outputs at the
// stream/serializer boundary.
import { parseArgs } from "node:util";
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, sep, join } from "node:path";
import { homedir } from "node:os";
import { redact, redactDeep } from "../lib/redact.mjs";
import { tokchars } from "../lib/text.mjs";
import { findRoot, lsFiles, isShallow, deletionEvidence, currentBranch, GitMissingError, NotARepoError } from "../src/cli/git.mjs";
import { discover, discoverDocs } from "../src/cli/discover.mjs";
import { readContextFile } from "../src/cli/ingest.mjs";
import { keepDocClaims } from "../src/cli/docmode.mjs";
import { extractPathClaims } from "../src/cli/extract/path.mjs";
import { extractDependencyClaims } from "../src/cli/extract/dependency.mjs";
import { extractSymbolClaims } from "../src/cli/extract/symbol.mjs";
import { extractCountClaims } from "../src/cli/extract/count.mjs";
import { evaluateClaims } from "../src/cli/evaluate.mjs";
import { computeScore, deadTokens, SCORING_SCHEMA } from "../src/cli/score.mjs";
import { computeCliDimensions, computeFixGain, DEFAULT_WEIGHT_BUDGET } from "../src/cli/dimensions.mjs";
import { repoIdentity, cacheFile, readLast, append } from "../src/cli/history.mjs";
import { selectFindings } from "../src/cli/select.mjs";
import { renderCard } from "../src/cli/render.mjs";
import { runTriage } from "../src/cli/triage.mjs";
import { buildPayload, writeOut } from "../src/cli/claims.mjs";
import { firstSegment, resolveRelPosix } from "../src/cli/paths.mjs";
import { directiveLinks } from "../src/cli/follow.mjs";
import { resolveAgent, runBurn, verificationDetours } from "../src/cli/burn.mjs";
import { collectRenameFixes, applyRenameFixes, renderFixPreview } from "../src/cli/fix.mjs";

// Read once at load; a missing/corrupt package.json (only a hand-copied partial
// tree, never a real npm install) must NOT crash the CLI before its exit-code
// logic — fall back to a sentinel version.
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || VERSION;
} catch { /* keep the sentinel */ }

const USAGE = `usage: depthfinder [path] [--json] [--out <dir>] [--no-follow] [--docs] [--strict [--max-false N]]

  path        starting directory for the repo search (default: cwd)
  --json      machine-readable payload to stdout instead of the card
  --out       write claims.json into <dir> (atomic; nothing is written otherwise)
  --no-follow do not follow "read first" links from context files into repo docs
  --docs      also scan the wider repo docs for a Doc Honesty score (opt-in;
              the doc grammar isn't yet corpus-clean enough to accuse by default)
  --strict    CI gate: exit 20 when Context Honesty has false claims (rot) or a
              context file couldn't be verified (skipped/unread → fail-closed).
              Gates the Context tier only (convention files + nested + followed
              "read first" links, minus --no-follow); Doc Honesty is never gated.
              Pin the version in CI (e.g. npx depthfinder@${VERSION}) so the
              threshold is stable across releases.
  --max-false N  allow up to N false Context claims before --strict fails
              (default 0). A non-negative integer; ratchet it down over time.
  --warn-below N  warn when a Health dimension (Honesty/Weight/Coverage/Health)
              scores below N (0-100). Advisory by default (stderr, exit 0);
              gating under --strict (a breach fails the build, exit 20).
  --weight-budget N  token budget for the Weight dimension (default ${DEFAULT_WEIGHT_BUDGET});
              a HEURISTIC, not a derived constant — Weight = 100 within budget,
              penalized above. Honesty and Coverage need no budget.
  --fix       repoint stale path claims that git proves were RENAMED to their new
              location. DRY-RUN by default (prints the proposed change, writes
              nothing); add --write to apply. Rename-only — deletions and
              fabrications are never auto-fixed. Context tier only.
  --write     with --fix, apply the rename-fixes to your context files — the one
              opt-in write to the scanned repo
  --triage    INTERACTIVE: step through every hotspot (↑/↓ to move, enter to
              fix), and hand a chosen fix to your coding harness (claude/codex) —
              it prints the command and asks before spawning. Needs a real
              terminal (not CI / a pipe / --json).
  --burn      run a local agent (claude/codex) against the top false claim and
              show what it actually says — opt-in; the ONLY path that calls a
              model. Override the agent with --burn-agent "<cmd>".
  --burn-agent <cmd>  the agent command for --burn (default: claude, else codex)
  --no-history do not record this run / show a "since last run" delta (the
              record lives in your cache dir, never in the scanned repo)
  --convention print a drop-in CLAUDE.md/AGENTS.md snippet that tells agents to
              self-check this file with depthfinder, then exit (stdout = the
              snippet, so: npx depthfinder --convention >> CLAUDE.md)
  --install-skill  install the /depthfinder agent skill (one SKILL.md) into each
              detected harness — Claude Code (~/.claude/skills/) and Codex
              (~/.agents/skills/) — so the agent can self-check context honesty as
              a first-class skill, then exit. (Hermes/OpenClaw install the same
              skill from this repo's skills/ dir — see --help notes / README.)
  -v, --version  print the depthfinder version and exit
  -h, --help     print this usage and exit`;

// The "convention line" — a copy-pasteable snippet a user adds to their own
// CLAUDE.md / AGENTS.md so any agent self-checks context honesty via the CLI it
// already has (the cheap, zero-surface alternative to a bundled MCP server: the
// agent reads this file every turn, so the file itself is the discovery point).
// Printed to STDOUT alone (clean markdown, append-safe); the how-to goes to stderr.
const CONVENTION = `
## Context honesty (depthfinder)

Before you trust the factual claims in this file — file paths, dependencies,
counts, exported symbols — run \`npx depthfinder\` at the repo root and read the
card. Any claim it flags as **false** or **stale** is unreliable: verify it
against the actual code before acting on it, and prefer fixing the doc over
trusting the line.
`;

// The /depthfinder agent skill — ONE SKILL.md that works across harnesses (Claude
// Code, Codex, OpenClaw, Hermes all use this format now). Generated inline so the
// CLI can install it with zero extra tarball files; the committed copy at
// skills/depthfinder/SKILL.md (for registry installs — `hermes skills install`,
// `npx skills add`, clawhub) MUST match this byte-for-byte (enforced by a test).
const SKILL_MD = `---
name: depthfinder
description: Verify this repo's AI context files (CLAUDE.md / AGENTS.md / .cursorrules) are still TRUE against the code. Surfaces false and stale claims — dead paths, missing dependencies, wrong counts, absent symbols — before you trust them. Use before relying on the project docs, or when the user asks about context rot, stale docs, or drift.
---

# depthfinder — keep your AI context honest

The files you read as ground truth (CLAUDE.md, AGENTS.md, .cursorrules, and the
docs they point to) rot: paths go dead, dependency claims go stale, counts drift.
depthfinder scans the factual claims those files make and verifies each against
the repo — deterministically, no model calls, nothing leaves the machine.

## When to use

- BEFORE you rely on a factual claim in the context files (a file path, a
  dependency, a count, an exported symbol).
- Whenever the user asks "is my context stale?", "what's rotted?", or anything
  about context honesty / drift.

## How

\`\`\`bash
npx depthfinder            # scan the current repo; prints the honesty card
npx depthfinder --json     # structured: score + false/stale claims + dimensions + hotspots
npx depthfinder --strict   # CI gate: exit 20 if the context has any false claim
npx depthfinder --triage   # interactive: step through hotspots, hand a fix to claude/codex
\`\`\`

Read the **Health** meters (**Honesty / Weight / Coverage**) and the **Hotspots**
(each false/stale claim with a criticality tag and a \`→ fix:\` line). Treat any
claim flagged **false** (never matched the repo) or **stale** (git proves the
target moved or was deleted) as UNRELIABLE: verify it against the code before
acting, and prefer fixing the doc. Requires Node >= 20 and git.

## Fix it all (loop)

To clear *every* rotted claim, loop — and let depthfinder be the termination
gate. It's deterministic, so a clean exit is a real done-signal, not a guess:

\`\`\`bash
until npx depthfinder --strict --no-history >/dev/null 2>&1; do
  # one pass: read the worst claim, fix it, let the loop re-check.
  npx depthfinder --json --no-history   # false/stale claims + each Hotspot's fix
  # …edit the context file (repoint the path, drop the dead dep, fix the count)…
done
\`\`\`

\`--strict\` exits **0** when no false claim remains and **20** while any does, so
the \`until\` stops exactly when the context is honest again. Fix one claim per
pass (the top Hotspot), prefer editing the doc over the code, and never invent a
target — if a path's real home is unknown, delete the line rather than guess.
`;

main();

function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        out: { type: "string" },
        "no-follow": { type: "boolean" },
        docs: { type: "boolean" },
        burn: { type: "boolean" },
        "burn-agent": { type: "string" },
        "no-history": { type: "boolean" },
        convention: { type: "boolean" },
        "install-skill": { type: "boolean" },
        strict: { type: "boolean" },
        "max-false": { type: "string" },
        "warn-below": { type: "string" },
        "weight-budget": { type: "string" },
        fix: { type: "boolean" },
        write: { type: "boolean" },
        triage: { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    process.stderr.write(`depthfinder: ${e.message}\n${USAGE}\n`);
    process.exit(2);
  }

  // --version / --help are explicit informational requests: print to stdout
  // (the convention for `tool --version | …`) and exit 0 before any repo work.
  if (args.values.version) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  if (args.values.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  // --convention: print the drop-in snippet to STDOUT (append-safe) and the
  // how-to + CI pointer to STDERR (stream discipline), then exit before repo work.
  if (args.values.convention) {
    process.stdout.write(`${CONVENTION}\n`);
    process.stderr.write(
      `Append the snippet above to your CLAUDE.md or AGENTS.md so agents self-check\n` +
        `context honesty, e.g.:  npx depthfinder --convention >> CLAUDE.md\n` +
        `CI gate: npx depthfinder@${VERSION} --strict   (exit 20 on rotted claims)\n`,
    );
    process.exit(0);
  }
  // --install-skill: write the ONE /depthfinder SKILL.md into each DETECTED
  // harness's skills dir (Claude Code ~/.claude/skills, Codex ~/.agents/skills).
  // Writes to the user's home, NEVER the scanned repo (invariant 5 holds). The
  // file content matches the committed skills/depthfinder/SKILL.md (registry path).
  if (args.values["install-skill"]) {
    const home = homedir();
    const targets = [];
    if (existsSync(join(home, ".claude"))) targets.push(join(home, ".claude", "skills", "depthfinder"));
    if (existsSync(join(home, ".codex")) || existsSync(join(home, ".agents")))
      targets.push(join(home, ".agents", "skills", "depthfinder"));
    if (targets.length === 0) targets.push(join(home, ".claude", "skills", "depthfinder")); // none detected → default
    const written = [];
    for (const dir of targets) {
      try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "SKILL.md");
        writeFileSync(file, SKILL_MD.trimStart());
        written.push(file);
        process.stdout.write(`installed ${file}\n`);
      } catch (e) {
        process.stderr.write(`depthfinder --install-skill: could not write ${dir}: ${e.message}\n`);
      }
    }
    if (written.length === 0) {
      process.exitCode = 2;
      return;
    }
    process.stderr.write(
      `depthfinder: /depthfinder skill installed for ${written.length} harness(es) — restart your agent to pick it up.\n` +
        `Hermes / OpenClaw / Vercel skills install the SAME skill from this repo:\n` +
        `  hermes skills install phdev/Depthfinder/skills/depthfinder\n` +
        `  npx skills add phdev/Depthfinder/skills --skill depthfinder\n`,
    );
    process.exit(0);
  }

  try {
    run(args);
  } catch (e) {
    if (e instanceof GitMissingError || e instanceof NotARepoError) {
      process.stderr.write(`depthfinder: ${e.message}\n`);
      process.exit(e.exitCode);
    }
    process.stderr.write(`depthfinder internal error: ${e?.stack || e}\n`);
    process.exit(1);
  }
}

function run({ values, positionals }) {
  // Validate --max-false BEFORE any repo work (usage error → exit 2). A pure
  // non-negative integer only: rejects floats, exponentials, NaN/Infinity,
  // negatives, and empty — each would otherwise silently mis-set the budget.
  let maxFalse = 0;
  if (values["max-false"] !== undefined) {
    const raw = String(values["max-false"]).trim();
    if (!/^\d+$/.test(raw)) {
      process.stderr.write(`depthfinder: --max-false must be a non-negative integer (got "${values["max-false"]}")\n${USAGE}\n`);
      process.exit(2);
    }
    maxFalse = parseInt(raw, 10);
    // A huge digit string parseInt-overflows to Infinity (or just exceeds 2^53),
    // making `falseCount > maxFalse` ALWAYS false — i.e. a silently-disabled gate
    // (fail-open, the worst failure for a safety check). Refuse anything that
    // isn't a safe integer; a real rot budget is a handful, never astronomical.
    if (!Number.isSafeInteger(maxFalse)) {
      process.stderr.write(`depthfinder: --max-false is too large (got "${values["max-false"]}" — that would silently disable the gate)\n${USAGE}\n`);
      process.exit(2);
    }
  }

  // --warn-below N: per-dimension soft-gate threshold (an integer 0-100). Same
  // strict validation as --max-false; a value outside 0-100 is a usage error
  // (a threshold can't exceed the 0-100 dimension scale).
  let warnBelow = null;
  if (values["warn-below"] !== undefined) {
    const raw = String(values["warn-below"]).trim();
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!Number.isSafeInteger(n) || n > 100) {
      process.stderr.write(`depthfinder: --warn-below must be an integer 0-100 (got "${values["warn-below"]}")\n${USAGE}\n`);
      process.exit(2);
    }
    warnBelow = n;
  }
  // --weight-budget N: the HEURISTIC token budget for the Weight dimension (a
  // positive integer; default DEFAULT_WEIGHT_BUDGET). Labeled a heuristic, not a
  // derived constant, wherever it surfaces.
  let weightBudget = DEFAULT_WEIGHT_BUDGET;
  if (values["weight-budget"] !== undefined) {
    const raw = String(values["weight-budget"]).trim();
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!Number.isSafeInteger(n) || n === 0) {
      process.stderr.write(`depthfinder: --weight-budget must be a positive integer (got "${values["weight-budget"]}")\n${USAGE}\n`);
      process.exit(2);
    }
    weightBudget = n;
  }

  // --triage is interactive: it needs a real terminal to draw the selector and
  // read keystrokes, and it spawns a harness, so it can't be machine-piped.
  // Gate up front (usage error → exit 2) before any scan work.
  if (values.triage) {
    if (values.json) {
      process.stderr.write(`depthfinder: --triage is interactive and can't be combined with --json\n${USAGE}\n`);
      process.exit(2);
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write(`depthfinder: --triage needs an interactive terminal (it can't run in CI, a pipe, or a non-TTY agent shell)\n`);
      process.exit(2);
    }
  }

  const startDir = resolve(positionals[0] || ".");
  if (!existsSync(startDir) || !statSync(startDir).isDirectory()) {
    process.stderr.write(`depthfinder: no such directory: ${startDir}\n`);
    process.exit(2);
  }

  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    process.stderr.write(redact(`  ! ${msg}\n`));
  };

  const root = findRoot(startDir);
  const index = lsFiles(root);
  const shallow = isShallow(root);

  const scannedFiles = discover(root, index);
  if (scannedFiles.length === 0) {
    process.stderr.write(
      "depthfinder: no context files found (looked for CLAUDE.md, AGENTS.md, .cursorrules, .cursor/rules/**.mdc, nested CLAUDE/AGENTS.md)\n",
    );
    process.exit(3);
  }

  // first-segment directory existence (path oracle precondition)
  const dirSet = new Set();
  for (const p of index) dirSet.add(firstSegment(p));
  const ctx = {
    root,
    index,
    warn,
    now: new Date().toISOString(),
    dirExists: (seg) => dirSet.has(seg) || existsSync(resolve(root, seg)),
    degraded: [], // tool-failure degradations (e.g. fatal git check-ignore) — feeds the --strict fail-closed
  };

  // ingest + extract. `counted` files feed Weight (per-turn load); linked
  // docs are scanned for honesty but do NOT load every turn, so they are
  // not counted toward Weight.
  const claims = [];
  const fileParagraphs = new Map();
  let skippedLines = 0;
  let weightChars = 0;
  const ingestOne = (rel, counted, filter = false) => {
    const r = readContextFile(root, rel);
    if (!r.ok) {
      warn(`skipped ${rel}: ${r.reason}`);
      return null;
    }
    if (counted) weightChars += r.chars;
    skippedLines += r.skippedLines;
    if (r.skippedLines)
      warn(`${rel}: ${r.skippedLines} line(s) over 1,000 chars excluded from extraction`);
    fileParagraphs.set(rel, r.paragraphs);
    let extracted = [
      ...extractPathClaims(rel, r.lines, ctx),
      ...extractDependencyClaims(rel, r.lines),
      ...extractSymbolClaims(rel, r.lines),
      ...extractCountClaims(rel, r.lines),
    ];
    // Linked "read first" docs are still PROSE — apply the doc modality filter
    // (drop fenced/narrative/example/generated lines) so a linked brain doc
    // can't false-accuse on the default Context score. Convention files are
    // present-tense contracts and keep the unfiltered grammar (byte-stable).
    if (filter) {
      const linesByNum = new Map(r.lines.map((l) => [l.n, l]));
      extracted = keepDocClaims(extracted, linesByNum);
    }
    claims.push(...extracted);
    return r;
  };

  const usable = [];
  const linkCandidates = []; // {target, from, line} — directive links to resolve
  for (const rel of scannedFiles) {
    const r = ingestOne(rel, true);
    if (!r) continue;
    usable.push(rel);
    if (!values["no-follow"])
      for (const l of directiveLinks(r.lines)) linkCandidates.push({ ...l, from: rel });
  }

  // Transitive discovery (one hop): resolve directive links to TRACKED repo
  // docs, dedupe against the convention set + each other, cap for the budget,
  // and scan them. We never follow links found INSIDE linked docs — one hop
  // means no cycles and a bounded fan-out by construction.
  const FOLLOW_CAP = 25;
  const linkedFiles = [];
  if (linkCandidates.length) {
    const primary = new Set(usable);
    const seen = new Set();
    const resolved = [];
    for (const c of linkCandidates) {
      const rel = resolveRelPosix(c.from, c.target);
      if (!rel || primary.has(rel) || seen.has(rel) || !index.has(rel)) continue;
      seen.add(rel);
      resolved.push({ file: rel, from: c.from });
    }
    if (resolved.length > FOLLOW_CAP)
      warn(`${resolved.length} linked docs found; scanning the first ${FOLLOW_CAP} (cap) — ${resolved.length - FOLLOW_CAP} not scanned`);
    for (const entry of resolved.slice(0, FOLLOW_CAP))
      if (ingestOne(entry.file, false, true)) linkedFiles.push(entry); // filter: linked docs are prose
  }

  // ── doc tier (opt-in via --docs): the wider repo docs read on demand ───
  // PATH ORACLE ONLY (dependency/count/symbol are prose-FP drivers in docs),
  // then the docmode modality filter drops narrative/example/generated/fenced
  // lines. A separate advisory Doc Honesty score; never touches Weight or the
  // contract breakdown. Doc claims carry tier:"doc" so evaluate also resolves
  // them relative to their own dir (monorepo READMEs). OPT-IN for V1: the doc
  // grammar isn't yet corpus-clean enough to accuse by default (the doc-corpus
  // gate still surfaces repo-idiosyncratic FPs); flip to default-on once clean.
  const DOC_CAP = 200;
  const docClaims = [];
  const docFiles = [];
  const docMeta = { totalFound: 0, scanned: 0, cappedAt: null };
  if (values.docs) {
    const contextSet = new Set([...usable, ...linkedFiles.map((l) => l.file)]);
    const allDocs = discoverDocs(root, index, contextSet);
    docMeta.totalFound = allDocs.length;
    const scanned = allDocs.length > DOC_CAP ? allDocs.slice(0, DOC_CAP) : allDocs;
    if (allDocs.length > DOC_CAP) {
      docMeta.cappedAt = DOC_CAP;
      warn(`${allDocs.length} docs found; scanning the first ${DOC_CAP} (sorted) — ${allDocs.length - DOC_CAP} not scanned`);
    }
    for (const rel of scanned) {
      const r = readContextFile(root, rel);
      if (!r.ok) {
        warn(`skipped ${rel}: ${r.reason}`);
        continue;
      }
      docFiles.push(rel);
      if (r.skippedLines)
        warn(`${rel}: ${r.skippedLines} line(s) over 1,000 chars excluded from extraction`);
      const linesByNum = new Map(r.lines.map((l) => [l.n, l]));
      // Extensionless paths in docs are usually NOT files — JSON-RPC methods
      // (`ui/initialize`), routes, globs, package/dir refs. Docs get the
      // with-extension path grammar only (corpus gate: block/goose blog +
      // codex/cloudflare dir refs false-accused). Convention files keep both.
      const raw = extractPathClaims(rel, r.lines, ctx).filter(
        (c) => c.extraction.pattern !== "backtick_path_noext",
      );
      const kept = keepDocClaims(raw, linesByNum);
      for (const c of kept) c.tier = "doc";
      docClaims.push(...kept);
    }
    docMeta.scanned = docFiles.length;
  }

  // One evaluation pass over both tiers (single check-ignore batch).
  evaluateClaims(claims.concat(docClaims), ctx);
  // Uncapped for the card: the user asked to see ALL hotspots. selectFindings
  // still filters to med+ confidence false claims (low-confidence never accused).
  const findings = selectFindings(claims, Infinity);

  // Lazy git history (path oracle) doubles as stale classification: a false
  // claim whose target verifiably existed — deleted or renamed in history —
  // was once TRUE; the doc rotted rather than lied from birth. Rendered
  // findings enrich first (they must always carry evidence); the remaining
  // false path claims classify up to a cap that keeps the lazy-history
  // budget bounded on pathological repos (uncapped tail stays plain false).
  const STALE_CAP = 25;
  const falsePaths = claims.filter((c) => c.verdict === "false" && c.oracle === "path");
  const ordered = [
    ...falsePaths.filter((c) => findings.includes(c)),
    ...falsePaths.filter((c) => !findings.includes(c)),
  ];
  for (const c of ordered.slice(0, STALE_CAP)) {
    const ev = deletionEvidence(root, c.predicate.args.path, shallow);
    if (ev.kind === "renamed") {
      c.evidence.stale = true;
      c.evidence.actual = `moved to ${ev.to} (git rename)`;
    } else if (ev.kind === "deleted" && ev.sha) {
      c.evidence.stale = true;
      c.evidence.summary = `no such tracked file — deleted at ${ev.sha}${ev.commitsAgo ? `, ${ev.commitsAgo} commit${ev.commitsAgo === 1 ? "" : "s"} ago` : ""}`;
    } else if (shallow) {
      c.evidence.summary = "no such tracked file (history unavailable in shallow clone)";
    }
  }

  // Live Burn (V1.1, opt-in) — show what a real agent does with the top
  // rotten line. The --burn flag is consent; this is the ONLY path that calls
  // a model. Burn the #1 finding only (model calls are slow). The contract
  // notice names exactly what is sent and to which agent before it runs.
  if (values.burn) {
    // Burn the top rendered finding (context tier); if the contract surface is
    // clean but the docs rot, fall back to the first confirmed-false doc claim
    // so --docs --burn still demonstrates the moment.
    const f = findings[0] || docClaims.find((c) => c.verdict === "false");
    if (!f) {
      warn("--burn: no false claims to demonstrate");
    } else {
      const agent = resolveAgent({ agentCmd: values["burn-agent"] });
      if (!agent) {
        warn("--burn: no agent found — install claude or codex, or set DEPTHFINDER_BURN_AGENT");
      } else {
        process.stderr.write(
          redact(`  ! --burn: running \`${agent.join(" ")}\` against ${f.source.file}:${f.source.line}; that line is sent to the agent (passing --burn is your consent)\n`),
        );
        f.burn = runBurn(f, { agent });
        if (f.burn.error) warn(`--burn: ${f.burn.error}`);
        else f.burn.detours = verificationDetours(f.burn.output); // the tax, when it catches the lie
      }
    }
  }

  const score = computeScore(claims);
  // --strict gate state (Phase A), evaluated on the CONTEXT tier only. Recorded
  // in the payload so `--json` consumers read gate.failed directly instead of
  // re-deriving it from score.false. null unless --strict was requested.
  //
  // FAIL-CLOSED: a context-tier file that couldn't even be READ (UTF-16 BOM,
  // EACCES, oversize) contributes zero claims, so "0 false" doesn't mean "clean"
  // — it can mean "I never checked this file." A gate that PASSES on an unread
  // context file is fail-open, the cardinal sin for a safety check. So a skipped
  // convention file fails the gate too (`unverifiedFiles`). (The subtler oracle-
  // degradation cases — a fatal `git check-ignore`, a symbol-search timeout that
  // turns would-be-false into unknown — are a tracked P1 follow-up.)
  const unverifiedFiles = values.strict ? scannedFiles.length - usable.length : 0;
  // `degraded` = a TOOL FAILURE blinded an oracle (today: a fatal git
  // check-ignore that turns would-be-false paths into unknown). Distinct from a
  // legitimate unknown — both don't gate on their own, but under --strict a
  // degraded run can't be trusted to say "0 false", so it fails closed.
  const degraded = values.strict && ctx.degraded.length > 0;
  // NOTE: the --strict `gate` object is built lower down, AFTER the Health
  // dimensions it now carries (it needs weight → dimensions → breached).

  // --fix (safe-fix): repoint stale paths git PROVES were renamed. Dry-run by
  // default (writes nothing); --write applies — the one opt-in write to the
  // scanned repo. Short-circuits the card/json/history: its deliverable is the
  // fix report. Context tier only (the evaluated `claims`).
  if (values.fix) {
    const fixes = collectRenameFixes(claims, root, shallow);
    if (fixes.length === 0) {
      process.stderr.write("depthfinder --fix: nothing to fix — only paths git can prove were RENAMED are auto-fixable (deletions and fabrications have no safe target)\n");
      process.exitCode = 0;
      return;
    }
    if (values.write) {
      const applied = applyRenameFixes(root, fixes);
      for (const f of applied) process.stderr.write(redact(`  ✎ ${f.file}:${f.line}  ${f.oldPath} → ${f.newPath}\n`));
      const files = new Set(applied.map((f) => f.file)).size;
      process.stderr.write(`depthfinder --fix --write: repointed ${applied.length} renamed path${applied.length === 1 ? "" : "s"} across ${files} file${files === 1 ? "" : "s"}. Review the diff before committing.\n`);
    } else if (values.json) {
      process.stdout.write(JSON.stringify(redactDeep({ schema: 0, tool: "depthfinder", mode: "fix", fixes }), null, 2) + "\n");
      process.stderr.write(`depthfinder --fix: ${fixes.length} safe rename-fix(es) (dry run — add --write to apply)\n`);
    } else {
      process.stdout.write(redact(renderFixPreview(fixes)));
      process.stderr.write("depthfinder --fix: dry run — nothing written. Re-run with --fix --write to apply.\n");
    }
    process.exitCode = 0;
    return;
  }
  // docScore is null when no docs were scanned (--no-docs, or a repo with no
  // doc files) — distinct from "scanned, nothing checkable" (a real score
  // object with honesty null). The render + payload both key off this.
  const docScore = docFiles.length ? computeScore(docClaims) : null;
  const dead = deadTokens(fileParagraphs, claims, tokchars);
  const weight = Math.round(weightChars / 4);

  // CLI Health model (Honesty / Weight / Coverage → composite). Pure transform
  // over data already computed; null when the honesty score is suppressed
  // (< 5 definite) — the same unknown-never-false guard, so no fabricated 0.
  const dimensions = computeCliDimensions({
    honesty: score.honesty,
    definite: score.definite,
    unknownCount: score.unknownCount,
    weight,
    budget: weightBudget,
  });
  // --warn-below soft-gate: which dimensions fall below the threshold. Empty
  // unless --warn-below is set AND the dimensions rendered (honesty not suppressed).
  const DIM_KEYS = ["honesty", "weight", "coverage", "health"];
  const breached =
    warnBelow != null && dimensions ? DIM_KEYS.filter((k) => dimensions[k] < warnBelow) : [];

  // --strict gate verdict over the CONTEXT tier (built HERE, after dimensions —
  // it now carries the dim scores + the --warn-below breach). null unless
  // --strict. Fail-closed on unread files + oracle degradation; a --warn-below
  // breach also fails it. `--json` consumers read gate.failed directly.
  const gate = values.strict
    ? {
        strict: true, maxFalse, false: score.falseCount, tier: "context",
        unverifiedFiles, degraded,
        warnBelow,
        dimensions: dimensions
          ? { honesty: dimensions.honesty, weight: dimensions.weight, coverage: dimensions.coverage, health: dimensions.health }
          : null,
        breached,
        failed:
          score.falseCount > maxFalse || unverifiedFiles > 0 || degraded || breached.length > 0,
      }
    : null;

  // Score-history (V1.2): delta vs the last COMPARABLE run, then record this
  // run — to the user cache dir, never the scanned repo (5A holds). Suppressed
  // scores (honesty null) are skipped: nothing to compare or record. A failed
  // cache write disables the delta but never breaks the scan.
  let scoreDelta = null;
  if (!values["no-history"] && score.honesty != null) {
    const cmp = { scoringSchema: SCORING_SCHEMA, branch: currentBranch(root), follow: !values["no-follow"], docs: !!values.docs };
    try {
      const { raw, key } = repoIdentity(root);
      const file = cacheFile(key);
      // 5A guard: never write history inside the SCANNED repo, even if the
      // cache env var resolved there (relative DEPTHFINDER_CACHE/XDG_CACHE_HOME).
      if (resolve(file).startsWith(resolve(root) + sep)) {
        warn("score-history: cache path resolves inside the scanned repo — skipping (set DEPTHFINDER_CACHE to an absolute path outside the repo)");
      } else {
        const prev = readLast(file, cmp);
        // require a numeric prior honesty — a corrupt record must not yield a NaN delta
        if (prev && typeof prev.honesty === "number") scoreDelta = score.honesty - prev.honesty;
        const ok = append(file, {
          schema: 0, at: ctx.now, toolVersion: VERSION, ...cmp,
          honesty: score.honesty, definite: score.definite,
          false: score.falseCount, stale: score.staleCount, weight, identity: raw,
        });
        if (!ok) {
          warn("score-history: cache not writable — delta disabled (use --no-history to silence)");
          scoreDelta = null; // don't show a delta we couldn't persist
        }
      }
    } catch (e) {
      warn(`score-history: ${e?.message || e}`);
    }
  }

  const model = {
    now: ctx.now,
    rootLabel: firstSegment(root.split("/").filter(Boolean).pop() || root),
    scannedFiles: usable,
    linkedFiles,
    docFiles,
    docMeta,
    trackedCount: index.size,
    findings,
    score,
    gate,
    dimensions,
    docScore,
    delta: scoreDelta,
    dead,
    weight,
    claimsTotal: claims.length,
    claims,
    docClaims,
    meta: { skippedLines, warnings, shallowClone: shallow },
  };

  const color = !!process.stdout.isTTY && !process.env.NO_COLOR;
  if (values.triage) {
    // Interactive: print the colored card, then step through the hotspots and
    // hand a chosen fix to the harness. TTY-gated up front, so this never runs
    // in CI / a pipe / --json. Spawns the harness only after y/N consent.
    process.stdout.write(redact(renderCard(model, { color })) + "\n");
    const agent = resolveAgent({ agentCmd: values["burn-agent"] });
    const gain = computeFixGain({ score, weight, budget: weightBudget });
    runTriage(findings, { gain, agent, repoRoot: root }).then(() => process.exit(process.exitCode || 0));
    return;
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(redactDeep(buildPayload(model)), null, 2) + "\n");
  } else {
    process.stdout.write(redact(renderCard(model, { color })));
    process.stdout.write("\n");
  }

  if (values.out) {
    try {
      const file = writeOut(resolve(values.out), redactDeep(buildPayload(model)));
      process.stderr.write(`  wrote ${file}\n`);
    } catch (e) {
      process.stderr.write(`depthfinder: could not write --out: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
  }
  // --strict gate (Phase A): fail CI with a DISTINCT exit 20 — outside Node's
  // reserved 1-13 range (1=uncaught, 3-12=internal), so a wrapper/Action can
  // tell "context rotted" / "couldn't verify" from "the tool crashed". Runs
  // AFTER --out (an --out write failure already returned with exit 2: the
  // requested artifact wasn't produced, which outranks the gate). Sets
  // process.exitCode, never process.exit() — exit() would truncate a >64KB
  // --json payload mid-write (same guard as the success path below).
  if (gate) {
    // Only flag the doc tier when it actually has ungated rot — a green build
    // hiding doc dead-refs is the confusing case worth a word; clean docs aren't.
    if (values.docs && docScore && docScore.falseCount > 0)
      process.stderr.write(`  ! --strict gates Context Honesty only; Doc Honesty is advisory and was not gated (${docScore.falseCount} doc dead ref${docScore.falseCount === 1 ? "" : "s"})\n`);
    if (score.falseCount > maxFalse) {
      process.stderr.write(
        `depthfinder --strict: FAIL — ${score.falseCount} false Context claim${score.falseCount === 1 ? "" : "s"} > --max-false ${maxFalse} (exit 20)\n`,
      );
      process.exitCode = 20;
      return;
    }
    if (unverifiedFiles > 0 || degraded) {
      // Fail-closed: we couldn't fully verify, so "0 false" isn't trustworthy.
      // Don't green-light a run we couldn't actually check.
      const reasons = [];
      if (unverifiedFiles > 0) reasons.push(`${unverifiedFiles} context file(s) skipped/unread`);
      if (degraded) reasons.push(ctx.degraded[0]);
      process.stderr.write(
        `depthfinder --strict: COULD NOT VERIFY — ${reasons.join("; ")}, so "${score.falseCount} false" can't be trusted; failing closed (exit 20)\n`,
      );
      process.exitCode = 20;
      return;
    }
    // Soft-gate becomes a hard gate ONLY under --strict: a dimension below the
    // --warn-below threshold fails the build (exit 20), after the false-claim and
    // verifiability checks above.
    if (breached.length > 0) {
      const detail = breached.map((k) => `${k} ${dimensions[k]}`).join(", ");
      process.stderr.write(
        `depthfinder --strict --warn-below ${warnBelow}: FAIL — ${breached.length} dimension${breached.length === 1 ? "" : "s"} below ${warnBelow} — ${detail} (exit 20)\n`,
      );
      process.exitCode = 20;
      return;
    }
    process.stderr.write(`depthfinder --strict: PASS — ${score.falseCount} false ≤ --max-false ${maxFalse} (Context Honesty)\n`);
  }
  // --warn-below WITHOUT --strict is advisory: warn on a breach, but exit stays 0.
  if (!values.strict && breached.length > 0) {
    const detail = breached.map((k) => `${k} ${dimensions[k]}`).join(", ");
    process.stderr.write(
      `depthfinder: ${breached.length} dimension${breached.length === 1 ? "" : "s"} below --warn-below ${warnBelow} — ${detail} (advisory; add --strict to fail the build)\n`,
    );
  }
  // No process.exit() here: payloads >64KB are still buffered in the stdout
  // pipe, and exit() would truncate them mid-write (caught live on a
  // 92-claim repo). Let the event loop drain; exitCode covers the status.
  process.exitCode = 0;
}
