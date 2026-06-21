// Semantic Honesty judge (V1.6) — the model tier. These tests cover the pure
// pieces (prompt build + redaction, output parsing, verdict tally, agent argv,
// render) and the CLI integration via the STUB agent, so NOT ONE makes a real
// model call. Invariant 4 extends to --judge: the only real-model path is opt-in
// and never exercised in CI.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJudgePrompt,
  parseJudgeOutput,
  judgeCounts,
  judgeAgentArgv,
  renderJudge,
  JUDGE_RUBRIC,
} from "../src/cli/judge.mjs";
import { makeRepo, runCli, hashTree, cleanup, STUB_AGENT } from "./helpers/fixture.mjs";

const STUB = `${process.execPath} ${STUB_AGENT}`;

test("buildJudgePrompt: embeds the rubric + a DOC header, and REDACTS secrets in the doc text", () => {
  const prompt = buildJudgePrompt([
    { path: "CLAUDE.md", text: "Use `src/x.js`. token: sk-test-aaaabbbbccccddddeeee here." },
  ]);
  assert.match(prompt, /Semantic Honesty/);
  assert.match(prompt, /Judge the MEANING, not the links/);
  assert.match(prompt, /DOC: CLAUDE\.md/);
  // 1A: the planted secret must not leave the process in the prompt.
  assert.ok(!prompt.includes("sk-test-aaaabbbbccccddddeeee"), "secret redacted from judge input");
});

test("parseJudgeOutput: bare array + trailing summary line", () => {
  const raw =
    '[{"location":"a:1","claim":"c","verdict":"FALSE","evidence":"e","severity":"crit","fix":"f"}]\n' +
    "Semantic Honesty: 1 state-claims · 0 hold · 0 stale · 1 false · 0 unknown.";
  const r = parseJudgeOutput(raw);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].verdict, "false", "verdict lowercased");
  assert.equal(r.findings[0].severity, "CRIT", "severity uppercased");
  assert.match(r.summary, /Semantic Honesty: 1 state-claims/);
});

test("parseJudgeOutput: tolerates a ```json fence and a prose preamble", () => {
  const fenced = 'Here is my analysis:\n```json\n[{"location":"x","claim":"y","verdict":"holds"}]\n```\n';
  assert.equal(parseJudgeOutput(fenced).findings.length, 1);
  const prose = 'I checked everything.\n[{"location":"x","verdict":"stale"}]\nDone.';
  const r = parseJudgeOutput(prose);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].verdict, "stale");
});

test("parseJudgeOutput: unparseable reply / empty → error, never throws", () => {
  assert.match(parseJudgeOutput("no json at all here").error, /could not parse/);
  assert.match(parseJudgeOutput("").error, /empty/);
});

test("judgeCounts: tallies by verdict", () => {
  const c = judgeCounts([{ verdict: "false" }, { verdict: "holds" }, { verdict: "HOLDS" }, { verdict: "x" }]);
  assert.equal(c.total, 4);
  assert.equal(c.false, 1);
  assert.equal(c.holds, 2); // case-insensitive
});

test("judgeAgentArgv: claude gets READ-ONLY tool flags; override passes through; unknown agent untouched", () => {
  const cl = judgeAgentArgv(["claude", "-p"]);
  assert.ok(cl.includes("--allowedTools"), "claude judge run allow-lists tools");
  assert.ok(cl.join(" ").includes("Read Grep Glob Bash"), "read-only tool set (no Write/Edit)");
  assert.ok(!cl.join(" ").includes("Write"), "no write tool granted");
  assert.deepEqual(judgeAgentArgv(["claude", "-p"], { override: "myagent --x" }), ["myagent", "--x"]);
  assert.deepEqual(judgeAgentArgv(["node", "/stub.mjs"]), ["node", "/stub.mjs"], "unknown agent passes through");
});

test("renderJudge: error path is a one-liner; findings path shows verdicts + summary", () => {
  assert.match(renderJudge({ error: "no agent found" }), /judge skipped: no agent found/);
  const out = renderJudge({
    findings: [
      { location: "CLAUDE.md:1", claim: "x is a plan", verdict: "false", evidence: "x ships", severity: "CRIT", fix: "fix it" },
      { location: "CLAUDE.md:2", claim: "ok", verdict: "holds", evidence: "", severity: "LOW", fix: "" },
    ],
    counts: { total: 2, holds: 1, stale: 0, false: 1, unknown: 0 },
  });
  assert.match(out, /Semantic Honesty \(model judge\)/);
  assert.match(out, /FALSE/);
  assert.match(out, /CLAUDE\.md:1/);
  assert.match(out, /Semantic Honesty: 2 state-claims · 1 hold · 0 stale · 1 false · 0 unknown/);
});

test("renderJudge: color=true emits SGR escapes; default is plain", () => {
  const f = { findings: [{ location: "a", claim: "c", verdict: "false", evidence: "e", severity: "CRIT", fix: "f" }], counts: judgeCounts([{ verdict: "false" }]) };
  assert.ok(renderJudge(f, { color: true }).includes("\x1b["), "colored");
  assert.ok(!renderJudge(f, { color: false }).includes("\x1b["), "plain by default");
});

test("JUDGE_RUBRIC instructs evidence-first + JSON-only output", () => {
  assert.match(JUDGE_RUBRIC, /Evidence-first/);
  assert.match(JUDGE_RUBRIC, /Prefer a missed finding to a false accusation/);
  assert.match(JUDGE_RUBRIC, /NO markdown fences/);
});

// ---- CLI integration via the stub agent (no real model call) ----

test("--judge: runs the stub agent, renders the Semantic Honesty section + consent contract", () => {
  const root = makeRepo({ "CLAUDE.md": "# r\n\nEntry is `src/i.js`.\n", "src/i.js": "export const i=1\n" });
  try {
    const r = runCli(root, ["--judge"], { DEPTHFINDER_BURN_AGENT: STUB });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Semantic Honesty \(model judge\)/);
    assert.match(r.stdout, /FALSE/);
    assert.match(r.stdout, /WebGPU/); // from the stub's canned CRIT finding
    assert.match(r.stderr, /--judge: running .* read-only over .*; .* your consent/);
  } finally {
    cleanup(root);
  }
});

test("--judge --json: payload.judge carries findings + counts (additive field)", () => {
  const root = makeRepo({ "CLAUDE.md": "# r\n\nEntry is `src/i.js`.\n", "src/i.js": "export const i=1\n" });
  try {
    const r = runCli(root, ["--judge", "--json"], { DEPTHFINDER_BURN_AGENT: STUB });
    assert.equal(r.code, 0);
    const p = JSON.parse(r.stdout);
    assert.ok(p.judge, "judge field present");
    assert.equal(p.judge.findings.length, 2);
    assert.equal(p.judge.counts.false, 1);
    assert.equal(p.judge.counts.holds, 1);
    assert.ok(!("raw" in p.judge), "raw output dropped from payload");
  } finally {
    cleanup(root);
  }
});

test("--judge: a failing/missing agent warns but is never fatal (exit 0, advisory)", () => {
  const root = makeRepo({ "CLAUDE.md": "# r\n\nEntry is `src/i.js`.\n", "src/i.js": "export const i=1\n" });
  try {
    // An explicit override that isn't on PATH → spawn ENOENT, surfaced as a
    // --judge warning; the scan itself still succeeds (model tier is advisory).
    const r = runCli(root, ["--judge"], { DEPTHFINDER_BURN_AGENT: "/nonexistent/agent-xyz" });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /--judge: (ENOENT|no agent|agent)/);
  } finally {
    cleanup(root);
  }
});

test("no --judge: payload.judge is null and no model-tier section renders", () => {
  const root = makeRepo({ "CLAUDE.md": "# r\n\nEntry is `src/i.js`.\n", "src/i.js": "export const i=1\n" });
  try {
    const json = JSON.parse(runCli(root, ["--json"], { DEPTHFINDER_BURN_AGENT: STUB }).stdout);
    assert.equal(json.judge, null);
    const card = runCli(root, [], { DEPTHFINDER_BURN_AGENT: STUB });
    assert.ok(!card.stdout.includes("model judge"), "no judge section without --judge");
  } finally {
    cleanup(root);
  }
});

test("--judge writes NOTHING to the scanned repo (5A holds for the model tier)", () => {
  const root = makeRepo({ "CLAUDE.md": "# r\n\nEntry is `src/i.js`.\n", "src/i.js": "export const i=1\n" });
  try {
    const before = hashTree(root);
    runCli(root, ["--judge"], { DEPTHFINDER_BURN_AGENT: STUB });
    assert.equal(hashTree(root), before, "repo byte-identical after --judge");
  } finally {
    cleanup(root);
  }
});
