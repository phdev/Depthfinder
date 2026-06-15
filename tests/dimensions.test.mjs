// CLI 3-dimension Health model (Coherence / Weight / Coverage → composite).
// Pure-function tests with synthetic inputs — deterministic, no repo. Mirrors
// tests/summary.test.mjs (the dashboard's computeDimensions) so the two agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCliDimensions,
  HEALTH_WEIGHTS,
  DEFAULT_WEIGHT_BUDGET,
  rating,
} from "../src/cli/dimensions.mjs";

test("clean signals → all 100, Health 100, Healthy", () => {
  const d = computeCliDimensions({ honesty: 100, definite: 10, unknownCount: 0, weight: 0 });
  assert.equal(d.coherence, 100);
  assert.equal(d.weight, 100);
  assert.equal(d.coverage, 100);
  assert.equal(d.health, 100);
  assert.equal(d.rating, "Healthy");
});

test("suppression: honesty null (< 5 definite) → null, render nothing", () => {
  assert.equal(computeCliDimensions({ honesty: null, definite: 3, unknownCount: 0 }), null);
  assert.equal(computeCliDimensions({}), null); // defaults: honesty null
});

test("Coherence = Context Honesty, clamped", () => {
  assert.equal(computeCliDimensions({ honesty: 55, definite: 9 }).coherence, 55);
  assert.equal(computeCliDimensions({ honesty: 200, definite: 9 }).coherence, 100); // clamp
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

test("Health = 0.4·Coherence + 0.3·Weight + 0.3·Coverage", () => {
  // coherence 100, weight 0 (3× over), coverage 0 → 0.4·100 = 40
  const d = computeCliDimensions({ honesty: 100, definite: 5, unknownCount: 0, weight: 40000, budget: 10000 });
  // coverage here is 100 (no unknowns), so recompute a true 40 case:
  const d2 = computeCliDimensions({ honesty: 100, definite: 0, unknownCount: 0, weight: 40000, budget: 10000 });
  // d2 has honesty 100 but definite 0 → coverage guard = 100; can't force coverage 0 with honesty!=null+real counts.
  // Assert the composite arithmetic directly with a mixed case instead:
  const m = computeCliDimensions({ honesty: 90, definite: 9, unknownCount: 1, weight: 20000, budget: 10000 });
  // coherence 90, weight 50, coverage 90 → 0.4·90 + 0.3·50 + 0.3·90 = 36 + 15 + 27 = 78
  assert.equal(m.health, 78);
  assert.deepEqual(m.weights, HEALTH_WEIGHTS);
  assert.deepEqual(HEALTH_WEIGHTS, { coherence: 0.4, weight: 0.3, coverage: 0.3 });
  assert.ok(d.health >= 0 && d2.health >= 0); // total, no throw
});

test("rating thresholds (<35 Critical, <70 Caution, else Healthy) — from the composite", () => {
  assert.equal(rating(34), "Critical");
  assert.equal(rating(35), "Caution");
  assert.equal(rating(69), "Caution");
  assert.equal(rating(70), "Healthy");
  // end-to-end: a low-honesty repo CAN read Healthy (the accepted dashboard-parity
  // tradeoff): coherence 55, weight 100, coverage 100 → Health 82 → Healthy.
  const d = computeCliDimensions({ honesty: 55, definite: 20, unknownCount: 0, weight: 1000, budget: 10000 });
  assert.equal(d.health, 82);
  assert.equal(d.rating, "Healthy");
});

test("budget defaults to the labeled heuristic constant", () => {
  const d = computeCliDimensions({ honesty: 100, definite: 9, weight: DEFAULT_WEIGHT_BUDGET });
  assert.equal(d.budget, DEFAULT_WEIGHT_BUDGET);
  assert.equal(d.weight, 100); // exactly at budget → no penalty
});
