// 3-dimension Health model (Coherence / Weight / Coverage → composite).
// Pure-function tests with synthetic signals — deterministic, no live repo.
// Backfills the dimension math added in the Summary redesign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDimensions } from "../scripts/summary.mjs";

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
