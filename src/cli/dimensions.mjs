// CLI-native 3-dimension Health model — Coherence / Weight / Coverage → composite.
//
// Pure + deterministic. Mirrors the dashboard's `computeDimensions` math (same
// 0.4 / 0.3 / 0.3 weights, same <35 / <70 rating thresholds) so the `npx
// depthfinder` card and the web hero agree. Reuses the data the CLI already
// computes — the honesty score, the token weight, and the claim counts — so
// there are NO new oracles and NO new scans.
//
// Definitions (CLI-native; the Coverage one DIFFERS from the dashboard's
// "rules-in-CI" on purpose — documented so the divergence is conscious):
//   Coherence = Context Honesty            (round(100·true/(true+false)))
//   Weight    = 100 − over-budget penalty  (vs a HEURISTIC budget, configurable)
//   Coverage  = definite / (definite + unknown)   (how much of the context is checkable)
//   Health    = 0.4·Coherence + 0.3·Weight + 0.3·Coverage
//
// HONESTY DISCIPLINE (unknown-never-false): returns `null` — render nothing —
// when there is no Context Honesty score (< 5 definite claims). No false 0, no
// fabricated dimension. The Weight budget is a HEURISTIC placeholder (labeled as
// such in --help and the card), NOT a derived constant — override with
// --weight-budget.

export const HEALTH_WEIGHTS = { coherence: 0.4, weight: 0.3, coverage: 0.3 };
// Heuristic: ~tokens of always-loaded context before it's "heavy". A placeholder,
// not a derived constant — labeled as such wherever it surfaces, configurable.
export const DEFAULT_WEIGHT_BUDGET = 10000;

// Rating word from a 0-100 score (dashboard parity). The CLI headline uses this
// on the COMPOSITE Health per an explicit product decision (2026-06-15) that the
// card lead dashboard-style; the prior "no status word / honesty-led headline"
// invariant was deliberately reversed by the user with the tradeoff in view.
export const rating = (h) => (h < 35 ? "Critical" : h < 70 ? "Caution" : "Healthy");

export function computeCliDimensions({
  honesty = null,
  definite = 0,
  unknownCount = 0,
  weight = 0,
  budget = DEFAULT_WEIGHT_BUDGET,
} = {}) {
  // Suppression guard: no honesty score (< 5 definite) → no dimensions at all.
  if (honesty == null) return null;
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

  const coherence = clamp(honesty); // = Context Honesty, already 0-100

  // Weight: 100 within budget; linear penalty above (−50 points per 100% over).
  // Budget guarded against 0 so a misconfigured --weight-budget can't divide.
  const over = budget > 0 ? Math.max(0, (weight - budget) / budget) : 0;
  const weightScore = clamp(100 - over * 50);

  // Coverage: the share of claims that are decidable (definite) vs unknown.
  // With honesty != null, definite >= 5 so the denominator is never 0; the
  // guard keeps the function total for synthetic inputs.
  const denom = definite + unknownCount;
  const coverage = denom > 0 ? clamp((100 * definite) / denom) : 100;

  // Health: weighted composite. SECONDARY — never replaces the honesty score as
  // the contract; it is a triage number.
  const health = clamp(
    HEALTH_WEIGHTS.coherence * coherence +
      HEALTH_WEIGHTS.weight * weightScore +
      HEALTH_WEIGHTS.coverage * coverage,
  );

  return {
    coherence,
    weight: weightScore,
    coverage,
    health,
    rating: rating(health),
    budget,
    weights: HEALTH_WEIGHTS,
  };
}
