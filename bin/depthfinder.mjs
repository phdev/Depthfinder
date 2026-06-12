#!/usr/bin/env node
// depthfinder — keep your AI context honest.
//
// Zero-config: `npx depthfinder [path]`. Deterministic oracles only; no
// model calls; nothing leaves your machine. Default run writes NOTHING to
// the scanned repo (5A).
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
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { redact, redactDeep } from "../lib/redact.mjs";
import { tokchars } from "../lib/text.mjs";
import { findRoot, lsFiles, isShallow, deletionEvidence, GitMissingError, NotARepoError } from "../src/cli/git.mjs";
import { discover } from "../src/cli/discover.mjs";
import { readContextFile } from "../src/cli/ingest.mjs";
import { extractPathClaims } from "../src/cli/extract/path.mjs";
import { extractDependencyClaims } from "../src/cli/extract/dependency.mjs";
import { extractSymbolClaims } from "../src/cli/extract/symbol.mjs";
import { extractCountClaims } from "../src/cli/extract/count.mjs";
import { evaluateClaims } from "../src/cli/evaluate.mjs";
import { computeScore, deadTokens } from "../src/cli/score.mjs";
import { selectFindings } from "../src/cli/select.mjs";
import { renderCard } from "../src/cli/render.mjs";
import { buildPayload, writeOut } from "../src/cli/claims.mjs";
import { firstSegment } from "../src/cli/paths.mjs";

const USAGE = `usage: depthfinder [path] [--json] [--out <dir>]

  path     starting directory for the repo search (default: cwd)
  --json   machine-readable payload to stdout instead of the card
  --out    write claims.json into <dir> (atomic; nothing is written otherwise)`;

main();

function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: { json: { type: "boolean" }, out: { type: "string" } },
    });
  } catch (e) {
    process.stderr.write(`depthfinder: ${e.message}\n${USAGE}\n`);
    process.exit(2);
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

  // ingest + extract
  const claims = [];
  const fileParagraphs = new Map();
  let skippedLines = 0;
  const usable = [];
  for (const rel of scannedFiles) {
    const r = readContextFile(root, rel);
    if (!r.ok) {
      warn(`skipped ${rel}: ${r.reason}`);
      continue;
    }
    usable.push(rel);
    skippedLines += r.skippedLines;
    if (r.skippedLines)
      warn(`${rel}: ${r.skippedLines} line(s) over 1,000 chars excluded from extraction`);
    fileParagraphs.set(rel, r.paragraphs);
    claims.push(
      ...extractPathClaims(rel, r.lines, ctx),
      ...extractDependencyClaims(rel, r.lines),
      ...extractSymbolClaims(rel, r.lines),
      ...extractCountClaims(rel, r.lines),
    );
  }

  evaluateClaims(claims, ctx);
  const score = computeScore(claims);
  const dead = deadTokens(fileParagraphs, claims, tokchars);
  const findings = selectFindings(claims);

  // Lazy git evidence for rendered findings only (path oracle).
  for (const f of findings) {
    if (f.oracle !== "path") continue;
    const ev = deletionEvidence(root, f.predicate.args.path, shallow);
    if (ev.kind === "renamed") {
      f.evidence.actual = `moved to ${ev.to} (git rename)`;
    } else if (ev.kind === "deleted" && ev.sha) {
      f.evidence.summary = `no such tracked file — deleted at ${ev.sha}${ev.commitsAgo ? `, ${ev.commitsAgo} commit${ev.commitsAgo === 1 ? "" : "s"} ago` : ""}`;
    } else if (shallow) {
      f.evidence.summary = "no such tracked file (history unavailable in shallow clone)";
    }
  }

  const model = {
    now: ctx.now,
    rootLabel: firstSegment(root.split("/").filter(Boolean).pop() || root),
    scannedFiles: usable,
    trackedCount: index.size,
    findings,
    score,
    dead,
    claimsTotal: claims.length,
    claims,
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
      process.exit(2);
    }
  }
  process.exit(0);
}
