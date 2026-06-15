// 3-dimension Health model (Coherence / Weight / Coverage → composite).
// Pure-function tests with synthetic signals — deterministic, no live repo.
// Backfills the dimension math added in the Summary redesign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDimensions, buildActionPrompt, parseGithubSlug } from "../scripts/summary.mjs";

test("computeDimensions: clean signals → all 100, all ok", () => {
  const d = computeDimensions({
    codeDanglingCount: 0,
    otherDanglingCount: 0,
    dupBlocks: 0,
    cmTokens: 1000,
    cmBudget: 4000,
    readFirstOver: false,
    rulesInCi: 3,
    totalRules: 3,
    ciGaps: 0,
    missingArtifacts: 0,
  });
  assert.equal(d.coherence, 100);
  assert.equal(d.weight, 100);
  assert.equal(d.coverage, 100);
  assert.equal(d.healthScore, 100);
  for (const k of ["coherence", "weight", "coverage"]) assert.equal(d.dimensions[k].sev, "ok");
});

test("computeDimensions: coherence — penalties, caps, clamp", () => {
  // each dead code ref = -12
  assert.equal(computeDimensions({ codeDanglingCount: 6 }).coherence, 28);
  // runtime dangling capped at 8 total, dup drift capped at 15
  assert.equal(computeDimensions({ otherDanglingCount: 100, dupBlocks: 100 }).coherence, 100 - 8 - 15);
  // never below 0
  assert.equal(computeDimensions({ codeDanglingCount: 1000 }).coherence, 0);
});

test("computeDimensions: weight — budget overage, read-first, no divide-by-zero", () => {
  // 2x over budget → 100 - 1.0*45 = 55
  assert.equal(computeDimensions({ cmTokens: 8000, cmBudget: 4000 }).weight, 55);
  // within budget → 100; read-first over → flat -15
  assert.equal(computeDimensions({ cmTokens: 4000, cmBudget: 4000, readFirstOver: true }).weight, 85);
  // budget unknown (0) must not divide-by-zero / NaN
  assert.equal(computeDimensions({ cmBudget: 0, cmTokens: 99999 }).weight, 100);
});

test("computeDimensions: coverage — rulesInCi, gaps, missing, no divide-by-zero", () => {
  assert.equal(computeDimensions({ rulesInCi: 2, totalRules: 4 }).coverage, 50);
  // zero rules must not divide-by-zero
  assert.equal(computeDimensions({ rulesInCi: 0, totalRules: 0 }).coverage, 0);
  // 100 - 8 (one CI gap) - 10 (one missing artifact)
  assert.equal(
    computeDimensions({ rulesInCi: 4, totalRules: 4, ciGaps: 1, missingArtifacts: 1 }).coverage,
    82,
  );
});

test("computeDimensions: health is the 0.4/0.3/0.3 weighted composite", () => {
  // coherence 100, weight 0 (3x over budget), coverage 0 → 0.4*100 = 40
  const d = computeDimensions({ cmTokens: 4000, cmBudget: 1000, rulesInCi: 0, totalRules: 4 });
  assert.equal(d.coherence, 100);
  assert.equal(d.weight, 0);
  assert.equal(d.coverage, 0);
  assert.equal(d.healthScore, 40);
  assert.deepEqual(d.healthWeights, { coherence: 0.4, weight: 0.3, coverage: 0.3 });
});

test("computeDimensions: severity thresholds (<35 high, <70 medium, else ok)", () => {
  const sevOfCoherence = (code, other) =>
    computeDimensions({ codeDanglingCount: code, otherDanglingCount: other }).dimensions.coherence.sev;
  assert.equal(sevOfCoherence(5, 6), "high"); // score 34
  assert.equal(sevOfCoherence(5, 5), "medium"); // score 35 (boundary)
  assert.equal(sevOfCoherence(2, 7), "medium"); // score 69
  assert.equal(sevOfCoherence(2, 6), "ok"); // score 70 (boundary)
});

test("computeDimensions: dimensions carry stable labels/keys/tabs", () => {
  const { dimensions } = computeDimensions({});
  assert.equal(dimensions.coherence.label, "Coherence");
  assert.equal(dimensions.coherence.key, "coherence");
  assert.equal(dimensions.coherence.tab, 1);
  assert.equal(dimensions.weight.tab, 2);
  assert.equal(dimensions.coverage.tab, 3);
});

test("computeDimensions: no args → defaults, never throws", () => {
  let d;
  assert.doesNotThrow(() => {
    d = computeDimensions();
  });
  for (const k of ["coherence", "weight", "coverage", "healthScore"]) assert.equal(typeof d[k], "number");
});

// ── Suggested Action prompts (copy-paste v1) ──
const ISSUE = {
  severity: "high",
  title: "AgentCI gate isn't enforced in CI",
  detail: "Protected by agentci:gate — runs in no workflow.",
  tab: 3,
  action: "Add the gate/eval to a workflow (it's offline and fast).",
};

test("buildActionPrompt: grounds the prompt in the issue's real data", () => {
  const p = buildActionPrompt(ISSUE, "Coverage");
  assert.match(p, /AgentCI gate isn't enforced in CI/); // title
  assert.match(p, /Protected by agentci:gate/); // detail
  assert.match(p, /Add the gate\/eval to a workflow/); // action → Task
  assert.match(p, /Verify:/); // closes with a verify step
  assert.match(p, /Coverage score improves/); // dimension-aware verify
});

test("buildActionPrompt: harness-neutral — no Claude/Codex/Cursor-specific syntax", () => {
  const p = buildActionPrompt(ISSUE, "Coverage");
  // must paste cleanly into ANY agent: no slash-commands, no @-mentions, no
  // tool-call fences, no harness brand names in the instruction body.
  assert.doesNotMatch(p, /\/(plan|ship|review|qa)\b/);
  assert.doesNotMatch(p, /@(claude|codex|cursor)\b/i);
  assert.doesNotMatch(p, /\bclaude -p\b|\bcodex exec\b/);
});

test("buildActionPrompt: honesty — no fabricated target numbers in the verify step", () => {
  // unknown-never-false applies here: we say "confirm it improves", never invent
  // a precise future target like "3/4 → 4/4" the tool can't promise.
  const p = buildActionPrompt(ISSUE, "Coverage");
  const verifyLine = p.split("\n").find((l) => l.startsWith("Verify:"));
  assert.ok(verifyLine);
  assert.doesNotMatch(verifyLine, /\d+\s*\/\s*\d+/); // no "N/M" target
  assert.doesNotMatch(verifyLine, /→|->/); // no "X → Y" promise
});

test("buildActionPrompt: drift (no dimension) → generic verify, still well-formed", () => {
  const driftIssue = { ...ISSUE, tab: 4, title: "Packmind drift not set up" };
  const p = buildActionPrompt(driftIssue, null);
  assert.match(p, /Packmind drift not set up/);
  assert.match(p, /Verify:.*this hotspot clears/);
  assert.doesNotMatch(p, /\bscore improves\b/); // no dimension name when there isn't one
});

test("buildActionPrompt: tolerates a missing detail/action without throwing", () => {
  let p;
  assert.doesNotThrow(() => {
    p = buildActionPrompt({ title: "Bare issue", tab: 1 }, "Coherence");
  });
  assert.match(p, /Bare issue/);
  assert.match(p, /Task:/); // falls back to a generic task line
});

// ── claude-cli:// deep-link target (owner/repo slug, no abs-path leak) ──
test("parseGithubSlug: handles https / scp / ssh / custom-host-alias forms", () => {
  assert.equal(parseGithubSlug("https://github.com/phdev/Depthfinder.git"), "phdev/Depthfinder");
  assert.equal(parseGithubSlug("git@github.com:owner/repo"), "owner/repo");
  assert.equal(parseGithubSlug("ssh://git@github.com/owner/repo.git"), "owner/repo");
  // custom SSH host alias (real home-center remote shape) still yields the slug
  assert.equal(parseGithubSlug("git@github-home-center-openclaw:phdev/home-center.git"), "phdev/home-center");
  // trailing slash tolerated
  assert.equal(parseGithubSlug("https://github.com/owner/repo/"), "owner/repo");
});

test("parseGithubSlug: empty / unparseable → null (caller falls back to cwd)", () => {
  assert.equal(parseGithubSlug(""), null);
  assert.equal(parseGithubSlug(null), null);
  assert.equal(parseGithubSlug(undefined), null);
});
