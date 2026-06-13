#!/usr/bin/env node
// depthfinder — keep your AI context honest.
//
// Zero-config: `npx depthfinder [path]`. Deterministic oracles only; no
// model calls (except opt-in --burn); nothing leaves your machine. Default run
// writes NOTHING to the scanned repo (5A); it records one score-history line
// in the user cache dir (--no-history to skip).
//
//   Exit codes (full table — absorb #4):
//     0  ran successfully (findings or not — V1 is advisory)
//     1  internal error (uncaught)
//     2  usage error / bad --out / not a git repo / git binary missing
//     3  no context files found
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
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
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
import { repoIdentity, cacheFile, readLast, append } from "../src/cli/history.mjs";
import { selectFindings } from "../src/cli/select.mjs";
import { renderCard } from "../src/cli/render.mjs";
import { buildPayload, writeOut } from "../src/cli/claims.mjs";
import { firstSegment, resolveRelPosix } from "../src/cli/paths.mjs";
import { directiveLinks } from "../src/cli/follow.mjs";
import { resolveAgent, runBurn, verificationDetours } from "../src/cli/burn.mjs";

// Read once at load; a missing/corrupt package.json (only a hand-copied partial
// tree, never a real npm install) must NOT crash the CLI before its exit-code
// logic — fall back to a sentinel version.
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || VERSION;
} catch { /* keep the sentinel */ }

const USAGE = `usage: depthfinder [path] [--json] [--out <dir>] [--no-follow] [--docs]

  path        starting directory for the repo search (default: cwd)
  --json      machine-readable payload to stdout instead of the card
  --out       write claims.json into <dir> (atomic; nothing is written otherwise)
  --no-follow do not follow "read first" links from context files into repo docs
  --docs      also scan the wider repo docs for a Doc Honesty score (opt-in;
              the doc grammar isn't yet corpus-clean enough to accuse by default)
  --burn      run a local agent (claude/codex) against the top false claim and
              show what it actually says — opt-in; the ONLY path that calls a
              model. Override the agent with --burn-agent "<cmd>".
  --burn-agent <cmd>  the agent command for --burn (default: claude, else codex)
  --no-history do not record this run / show a "since last run" delta (the
              record lives in your cache dir, never in the scanned repo)
  -v, --version  print the depthfinder version and exit
  -h, --help     print this usage and exit`;

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
  const findings = selectFindings(claims);

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
  // docScore is null when no docs were scanned (--no-docs, or a repo with no
  // doc files) — distinct from "scanned, nothing checkable" (a real score
  // object with honesty null). The render + payload both key off this.
  const docScore = docFiles.length ? computeScore(docClaims) : null;
  const dead = deadTokens(fileParagraphs, claims, tokchars);
  const weight = Math.round(weightChars / 4);

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
    docScore,
    delta: scoreDelta,
    dead,
    weight,
    claimsTotal: claims.length,
    claims,
    docClaims,
    meta: { skippedLines, warnings, shallowClone: shallow },
  };

  if (values.json) {
    process.stdout.write(JSON.stringify(redactDeep(buildPayload(model)), null, 2) + "\n");
  } else {
    process.stdout.write(redact(renderCard(model)));
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
  // No process.exit() here: payloads >64KB are still buffered in the stdout
  // pipe, and exit() would truncate them mid-write (caught live on a
  // 92-claim repo). Let the event loop drain; exitCode covers the status.
  process.exitCode = 0;
}
