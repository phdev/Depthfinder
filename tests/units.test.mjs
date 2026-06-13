// Ingestion policy, score edge matrix, selection ordering, templates,
// and the CLI module-graph boundary (eng review 2A/6A/7A + T1 ordering).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContextFile, MAX_LINE_CHARS } from "../src/cli/ingest.mjs";
import { computeScore, deadTokens, MIN_DEFINITE_FOR_SCORE } from "../src/cli/score.mjs";
import { selectFindings } from "../src/cli/select.mjs";
import { TEMPLATES, consequence } from "../src/cli/templates.mjs";
import { tokchars } from "../lib/text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "df-ingest-"));
  writeFileSync(join(dir, name), content);
  return dir;
}

test("ingest: UTF-16 BOM file is skipped with a reason", () => {
  const dir = tmpFile("AGENTS.md", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello", "utf16le")]));
  const r = readContextFile(dir, "AGENTS.md");
  assert.equal(r.ok, false);
  assert.match(r.reason, /UTF-16/);
  rmSync(dir, { recursive: true, force: true });
});

test("ingest: oversized file is skipped", () => {
  const dir = tmpFile("CLAUDE.md", "x".repeat(2 * 1024 * 1024 + 1));
  const r = readContextFile(dir, "CLAUDE.md");
  assert.equal(r.ok, false);
  assert.match(r.reason, /larger than/);
  rmSync(dir, { recursive: true, force: true });
});

test("ingest: long lines flagged + counted; paragraphs split on blank lines", () => {
  const text = `para one line a\npara one line b\n\n${"y".repeat(MAX_LINE_CHARS + 1)}\n\npara three`;
  const dir = tmpFile("CLAUDE.md", text);
  const r = readContextFile(dir, "CLAUDE.md");
  assert.equal(r.ok, true);
  assert.equal(r.skippedLines, 1);
  assert.equal(r.paragraphs.length, 3);
  assert.deepEqual([r.paragraphs[0].start, r.paragraphs[0].end], [1, 2]);
  rmSync(dir, { recursive: true, force: true });
});

test("score: edge matrix — suppression below 5 definite, unknowns excluded", () => {
  const c = (verdict) => ({ verdict });
  const s1 = computeScore([c("true"), c("true"), c("false")]);
  assert.equal(s1.suppressed, true);
  assert.equal(s1.honesty, null);

  const s2 = computeScore([c("true"), c("true"), c("true"), c("true"), c("false"), c("unknown")]);
  assert.equal(s2.suppressed, false);
  assert.equal(s2.definite, 5);
  assert.equal(s2.honesty, 80);
  assert.equal(s2.unknownCount, 1);

  const s3 = computeScore([c("unknown"), c("unknown")]);
  assert.equal(s3.definite, 0);
  assert.equal(s3.honesty, null);
  assert.equal(MIN_DEFINITE_FOR_SCORE, 5);

  // stale is a subset of false: same score arithmetic, separate count.
  const s4 = computeScore([
    { verdict: "false", evidence: { stale: true } },
    { verdict: "false" },
    ...Array.from({ length: 4 }, () => c("true")),
  ]);
  assert.equal(s4.falseCount, 2);
  assert.equal(s4.staleCount, 1);
  assert.equal(s4.honesty, 67);
});

test("dead tokens: only paragraphs containing false path/symbol claims count", () => {
  const paragraphs = [
    { start: 1, end: 2, text: "twenty characters ok" },
    { start: 4, end: 4, text: "the rotten paragraph mentioning a dead file" },
  ];
  const claims = [
    { verdict: "false", oracle: "path", source: { file: "CLAUDE.md", line: 4 } },
    { verdict: "false", oracle: "dependency", source: { file: "CLAUDE.md", line: 1 } }, // dep ≠ dead tokens
  ];
  const dead = deadTokens(new Map([["CLAUDE.md", paragraphs]]), claims, tokchars);
  assert.equal(dead, tokchars(paragraphs[1].text));
});

test("selection: confidence tier, then oracle priority, then line; cap 3; low never renders", () => {
  const mk = (oracle, confidence, line, verdict = "false") => ({
    oracle, verdict, extraction: { confidence }, source: { file: "CLAUDE.md", line },
  });
  const picked = selectFindings([
    mk("count", "med", 1),
    mk("symbol", "med", 2),
    mk("dependency", "high", 9),
    mk("path", "high", 5),
    mk("path", "low", 1), // low: never rendered
    mk("path", "med", 3),
  ]);
  assert.deepEqual(
    picked.map((c) => [c.oracle, c.extraction.confidence]),
    [["path", "high"], ["dependency", "high"], ["path", "med"]],
  );
});

test("templates: consequence is the verbatim template with literal slots (6A)", () => {
  const claim = {
    oracle: "path",
    predicate: { args: { path: "src/auth/oauth.ts" } },
    evidence: { actual: null },
  };
  assert.equal(
    consequence(claim),
    TEMPLATES.path.replace("{path}", "src/auth/oauth.ts"),
  );
  // every oracle has a template; no template may contain unreplaced braces post-fill
  const filled = consequence({
    oracle: "count",
    predicate: { args: { n: 4, noun: "tiers" } },
    evidence: { actual: "3 in `router/config.js`" },
  });
  assert.ok(!/\{\w+\}/.test(filled), "no unfilled slots");
});

test("boundary (2A): the CLI module graph never imports lib/repo.mjs", () => {
  const repoRoot = resolve(HERE, "..");
  const seen = new Set();
  const queue = [resolve(repoRoot, "bin/depthfinder.mjs")];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      queue.push(resolve(dirname(file), m[1]));
    }
  }
  const offenders = [...seen].filter((f) => f.endsWith(`lib${process.platform === "win32" ? "\\" : "/"}repo.mjs`));
  assert.deepEqual(offenders, [], "published CLI must not load dashboard path resolution");
  assert.ok([...seen].some((f) => f.includes("redact.mjs")), "redaction is in the graph");
  assert.ok([...seen].some((f) => f.includes("text.mjs")), "tokchars comes from lib/text.mjs");
});
