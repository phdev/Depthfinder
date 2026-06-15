// CLI 3-dimension Health model (Honesty / Weight / Coverage → composite).
// Pure-function tests with synthetic inputs — deterministic, no repo. Mirrors
// tests/summary.test.mjs (the dashboard's computeDimensions) so the two agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCliDimensions,
  computeFixGain,
  HEALTH_WEIGHTS,
  DEFAULT_WEIGHT_BUDGET,
  rating,
  tierOf,
} from "../src/cli/dimensions.mjs";

test("clean signals → all 100, Health 100, Healthy", () => {
  const d = computeCliDimensions({ honesty: 100, definite: 10, unknownCount: 0, weight: 0 });
  assert.equal(d.honesty, 100);
  assert.equal(d.weight, 100);
  assert.equal(d.coverage, 100);
  assert.equal(d.health, 100);
  assert.equal(d.rating, "Healthy");
});

test("suppression: honesty null (< 5 definite) → null, render nothing", () => {
  assert.equal(computeCliDimensions({ honesty: null, definite: 3, unknownCount: 0 }), null);
  assert.equal(computeCliDimensions({}), null); // defaults: honesty null
});

test("Honesty = Context Honesty, clamped", () => {
  assert.equal(computeCliDimensions({ honesty: 55, definite: 9 }).honesty, 55);
  assert.equal(computeCliDimensions({ honesty: 200, definite: 9 }).honesty, 100); // clamp
});

test("Weight: 100 within budget, linear −50 per 100% over, no divide-by-zero", () => {
  // within budget → 100
  assert.equal(computeCliDimensions({ honesty: 100, definite: 9, weight: 5000, budget: 10000 }).weight, 100);
  // 2× budget → 100 − 1.0·50 = 50
  assert.equal(computeCliDimensions({ honesty: 100, definite: 9, weight: 20000, budget: 10000 }).weight, 50);
  // 3× budget → 0 (clamped)
  assert.equal(computeCliDimensions({ honesty: 100, definite: 9, weight: 40000, budget: 10000 }).weight, 0);
  // budget 0 must not divide-by-zero / NaN → no penalty
  assert.equal(computeCliDimensions({ honesty: 100, definite: 9, weight: 99999, budget: 0 }).weight, 100);
});

test("Coverage = definite / (definite + unknown), clamped", () => {
  assert.equal(computeCliDimensions({ honesty: 100, definite: 8, unknownCount: 2 }).coverage, 80);
  assert.equal(computeCliDimensions({ honesty: 100, definite: 9, unknownCount: 0 }).coverage, 100);
  assert.equal(computeCliDimensions({ honesty: 100, definite: 6, unknownCount: 6 }).coverage, 50);
});

test("Health = 0.4·Honesty + 0.3·Weight + 0.3·Coverage", () => {
  // honesty 100, weight 0 (3× over), coverage 0 → 0.4·100 = 40
  const d = computeCliDimensions({ honesty: 100, definite: 5, unknownCount: 0, weight: 40000, budget: 10000 });
  // coverage here is 100 (no unknowns), so recompute a true 40 case:
  const d2 = computeCliDimensions({ honesty: 100, definite: 0, unknownCount: 0, weight: 40000, budget: 10000 });
  // d2 has honesty 100 but definite 0 → coverage guard = 100; can't force coverage 0 with honesty!=null+real counts.
  // Assert the composite arithmetic directly with a mixed case instead:
  const m = computeCliDimensions({ honesty: 90, definite: 9, unknownCount: 1, weight: 20000, budget: 10000 });
  // honesty 90, weight 50, coverage 90 → 0.4·90 + 0.3·50 + 0.3·90 = 36 + 15 + 27 = 78
  assert.equal(m.health, 78);
  assert.deepEqual(m.weights, HEALTH_WEIGHTS);
  assert.deepEqual(HEALTH_WEIGHTS, { honesty: 0.4, weight: 0.3, coverage: 0.3 });
  assert.ok(d.health >= 0 && d2.health >= 0); // total, no throw
});

test("rating thresholds (<35 Critical, <70 Caution, else Healthy) — from the composite", () => {
  assert.equal(rating(34), "Critical");
  assert.equal(rating(35), "Caution");
  assert.equal(rating(69), "Caution");
  assert.equal(rating(70), "Healthy");
  // end-to-end: a low-honesty repo CAN read Healthy (the accepted dashboard-parity
  // tradeoff): honesty 55, weight 100, coverage 100 → Health 82 → Healthy.
  const d = computeCliDimensions({ honesty: 55, definite: 20, unknownCount: 0, weight: 1000, budget: 10000 });
  assert.equal(d.health, 82);
  assert.equal(d.rating, "Healthy");
});

test("budget defaults to the labeled heuristic constant", () => {
  const d = computeCliDimensions({ honesty: 100, definite: 9, weight: DEFAULT_WEIGHT_BUDGET });
  assert.equal(d.budget, DEFAULT_WEIGHT_BUDGET);
  assert.equal(d.weight, 100); // exactly at budget → no penalty
});

test("tierOf: 4 colored bands (critical <35, caution <70, ok <90, great ≥90)", () => {
  assert.equal(tierOf(0), "critical");
  assert.equal(tierOf(34), "critical");
  assert.equal(tierOf(35), "caution");
  assert.equal(tierOf(69), "caution");
  assert.equal(tierOf(70), "ok");
  assert.equal(tierOf(89), "ok");
  assert.equal(tierOf(90), "great");
  assert.equal(tierOf(100), "great");
});

test("computeFixGain: marginal per-fix + all-fixed target; null when nothing to fix", () => {
  // 9 true / 11 false over 20 definite → honesty 45. Fix one → 10/20 = 50 (+5).
  const score = { trueCount: 9, falseCount: 11, definite: 20, unknownCount: 0, honesty: 45 };
  const g = computeFixGain({ score, weight: 0, budget: 10000 });
  assert.equal(g.perFix.honesty, 5); // round(100·10/20) − 45 = 50 − 45
  assert.ok(g.perFix.health >= 0);
  assert.equal(g.all.fromHonesty, 45);
  assert.equal(g.all.toHonesty, 100); // every false claim fixed → honesty 100
  assert.ok(g.all.toHealth >= g.all.fromHealth);
  // nothing false → null; suppressed score (honesty null) → null
  assert.equal(computeFixGain({ score: { trueCount: 5, falseCount: 0, definite: 5, unknownCount: 0, honesty: 100 } }), null);
  assert.equal(computeFixGain({ score: { honesty: null, falseCount: 3, definite: 3 } }), null);
});
