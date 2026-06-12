// Top-3 finding selection (design doc ordering, confirmed eng review T1):
// confidence tier (high before med) → oracle priority (path > dependency >
// symbol > count) → source line. Low-confidence claims are never rendered.
const TIER = { high: 0, med: 1, low: 2 };
const ORACLE = { path: 0, dependency: 1, symbol: 2, count: 3 };

export function selectFindings(claims, cap = 3) {
  return claims
    .filter((c) => c.verdict === "false" && TIER[c.extraction.confidence] <= 1)
    .sort(
      (a, b) =>
        TIER[a.extraction.confidence] - TIER[b.extraction.confidence] ||
        ORACLE[a.oracle] - ORACLE[b.oracle] ||
        a.source.line - b.source.line ||
        a.source.file.localeCompare(b.source.file),
    )
    .slice(0, cap);
}
