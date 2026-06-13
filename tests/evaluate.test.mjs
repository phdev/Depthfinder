// Predicate evaluation — the unknown-never-false posture under fire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateClaims } from "../src/cli/evaluate.mjs";
import { lsFiles } from "../src/cli/git.mjs";
import { makeRepo, cleanup } from "./helpers/fixture.mjs";

function claimOf(oracle, type, args, confidence = "high") {
  return {
    id: "clm_test", schema: 0, kind: "descriptive", text: "t",
    source: { file: "CLAUDE.md", line: 1 }, oracle,
    predicate: { type, args },
    extraction: { pattern: "test", confidence },
    verdict: "unknown", evidence: { summary: "", actual: null, checkedAt: null },
  };
}

const ctxFor = (root, warn = () => {}) => ({
  root, index: lsFiles(root), warn, now: "2026-01-01T00:00:00Z",
});

test("path: tracked=true, missing=false, untracked-on-disk=unknown", () => {
  const root = makeRepo({ "src/a.js": "x\n", "CLAUDE.md": "# t\n" });
  try {
    const c1 = claimOf("path", "file_exists", { path: "src/a.js" });
    const c2 = claimOf("path", "file_exists", { path: "src/gone.js" });
    evaluateClaims([c1, c2], ctxFor(root));
    assert.equal(c1.verdict, "true");
    assert.equal(c2.verdict, "false");

    writeFileSync(join(root, "src", "new.js"), "y\n"); // on disk, NOT committed
    const c3 = claimOf("path", "file_exists", { path: "src/new.js" });
    evaluateClaims([c3], ctxFor(root));
    assert.equal(c3.verdict, "unknown", "new-file-before-commit must not read as a lie");
  } finally {
    cleanup(root);
  }
});

test("path: gitignored-and-absent = unknown, never false (real-corpus class)", () => {
  const root = makeRepo({
    ".gitignore": "voice-service/logs/\n",
    "voice-service/app.js": "x\n",
    "CLAUDE.md": "# t\n",
  });
  try {
    const log = claimOf("path", "file_exists", { path: "voice-service/logs/run.jsonl" });
    const gone = claimOf("path", "file_exists", { path: "voice-service/gone.js" });
    evaluateClaims([log, gone], ctxFor(root));
    assert.equal(log.verdict, "unknown", "ignored runtime artifact is machine-local state, not a lie");
    assert.match(log.evidence.summary, /gitignored/);
    assert.equal(gone.verdict, "false", "non-ignored missing path still reads false");
  } finally {
    cleanup(root);
  }
});

test("dependency: all four fields + workspace manifests count", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({
      name: "m", workspaces: ["packages/*"],
      peerDependencies: { "peer-pkg": "^1.0.0" },
      optionalDependencies: { "opt-pkg": "^1.0.0" },
    }) + "\n",
    "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "ws-pkg": "^1.0.0" } }) + "\n",
    "CLAUDE.md": "# t\n",
  });
  try {
    const peer = claimOf("dependency", "declared_dependency", { name: "peer-pkg" });
    const opt = claimOf("dependency", "declared_dependency", { name: "opt-pkg" });
    const ws = claimOf("dependency", "declared_dependency", { name: "ws-pkg" });
    const nope = claimOf("dependency", "declared_dependency", { name: "ghost-pkg" });
    evaluateClaims([peer, opt, ws, nope], ctxFor(root));
    assert.equal(peer.verdict, "true");
    assert.equal(opt.verdict, "true");
    assert.equal(ws.verdict, "true", "workspace manifest declares it");
    assert.match(ws.evidence.summary, /packages\/app\/package\.json/, "evidence names the declaring package");
    assert.equal(nope.verdict, "false");
  } finally {
    cleanup(root);
  }
});

test("dependency: polyglot and missing-manifest repos emit unknown, not false", () => {
  const poly = makeRepo({
    "package.json": JSON.stringify({ name: "p" }) + "\n",
    "go.mod": "module example.com/x\n",
    "CLAUDE.md": "# t\n",
  });
  const nopkg = makeRepo({ "main.py": "pass\n", "CLAUDE.md": "# t\n" });
  try {
    const c1 = claimOf("dependency", "declared_dependency", { name: "some-go-thing" });
    evaluateClaims([c1], ctxFor(poly));
    assert.equal(c1.verdict, "unknown", "polyglot -> unknown");

    const c2 = claimOf("dependency", "declared_dependency", { name: "requests" });
    evaluateClaims([c2], ctxFor(nopkg));
    assert.equal(c2.verdict, "unknown", "no package.json -> unknown");
  } finally {
    cleanup(poly);
    cleanup(nopkg);
  }
});

test("dependency: malformed package.json emits unknown + warning (7A)", () => {
  const root = makeRepo({ "package.json": "{ not json\n", "CLAUDE.md": "# t\n" });
  try {
    const warnings = [];
    const c = claimOf("dependency", "declared_dependency", { name: "anything" });
    evaluateClaims([c], ctxFor(root, (m) => warnings.push(m)));
    assert.equal(c.verdict, "unknown");
    assert.ok(warnings.some((w) => /malformed/.test(w)));
  } finally {
    cleanup(root);
  }
});

test("symbol: named file — true / false+did-you-mean / unknown-forms", () => {
  const root = makeRepo({
    "src/a.js": "export function startServer() {}\nexport const helperThing = 1\n",
    "src/star.js": "export * from './a.js'\n",
    "src/cjs.cjs": "module.exports = { x: 1 }\n",
    "CLAUDE.md": "# t\n",
  });
  try {
    const t = claimOf("symbol", "symbol_exported", { symbol: "startServer", file: "src/a.js" });
    const f = claimOf("symbol", "symbol_exported", { symbol: "helperThink", file: "src/a.js" });
    const u1 = claimOf("symbol", "symbol_exported", { symbol: "anything", file: "src/star.js" });
    const u2 = claimOf("symbol", "symbol_exported", { symbol: "x", file: "src/cjs.cjs" });
    const u3 = claimOf("symbol", "symbol_exported", { symbol: "y", file: "src/missing.js" });
    evaluateClaims([t, f, u1, u2, u3], ctxFor(root));
    assert.equal(t.verdict, "true");
    assert.equal(f.verdict, "false");
    assert.match(f.evidence.actual ?? "", /helperThing/, "did-you-mean nearest export");
    assert.equal(u1.verdict, "unknown", "export * -> unknown, never false");
    assert.equal(u2.verdict, "unknown", "CJS -> unknown");
    assert.equal(u3.verdict, "unknown", "missing file -> unknown");
  } finally {
    cleanup(root);
  }
});

test("symbol: repo-wide — unique=true, ambiguous=unknown", () => {
  const root = makeRepo({
    "src/a.js": "export function uniqueFn() {}\n",
    "src/b.js": "export function dupFn() {}\n",
    "src/c.js": "export function dupFn() {}\n",
    "CLAUDE.md": "# t\n",
  });
  try {
    const uniq = claimOf("symbol", "symbol_exported", { symbol: "uniqueFn", file: null }, "med");
    const dup = claimOf("symbol", "symbol_exported", { symbol: "dupFn", file: null }, "med");
    evaluateClaims([uniq, dup], ctxFor(root));
    assert.equal(uniq.verdict, "true");
    assert.equal(dup.verdict, "unknown", "multiple matches -> ambiguous -> unknown");
  } finally {
    cleanup(root);
  }
});

test("count: matching=true, mismatched=false+actual, strings-inside=unknown", () => {
  const root = makeRepo({
    "router/config.js": "export const tiers = { cache: {}, local: {}, cloud: {} }\n",
    "router/strs.js": 'export const tabs = { a: "x,y", b: 2 }\n',
    "CLAUDE.md": "# t\n",
  });
  try {
    const ok = claimOf("count", "count_matches", { n: 3, noun: "tiers", anchor: "router/config.js" }, "med");
    const bad = claimOf("count", "count_matches", { n: 4, noun: "tiers", anchor: "router/config.js" }, "med");
    const unc = claimOf("count", "count_matches", { n: 2, noun: "tabs", anchor: "router/strs.js" }, "med");
    evaluateClaims([ok, bad, unc], ctxFor(root));
    assert.equal(ok.verdict, "true");
    assert.equal(bad.verdict, "false");
    assert.match(bad.evidence.actual ?? "", /3/);
    assert.equal(unc.verdict, "unknown", "strings inside literal -> counting uncertain");
  } finally {
    cleanup(root);
  }
});
