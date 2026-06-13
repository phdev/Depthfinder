// Context Honesty score (design doc formula + edge matrix).
//
// honesty = round(100 × true / (true + false)) over definite verdicts.
// Score is SUPPRESSED below 5 definite claims — a 0-100 number over two
// claims is false precision, the exact sin this tool exists to catch.
export const MIN_DEFINITE_FOR_SCORE = 5;

export function computeScore(claims) {
  let trueCount = 0, falseCount = 0, unknownCount = 0, staleCount = 0;
  for (const c of claims) {
    if (c.verdict === "true") trueCount++;
    else if (c.verdict === "false") {
      falseCount++;
      // stale = false claim whose target verifiably existed in git history
      // (classified upstream via deletionEvidence) — rot, not fabrication.
      // Both count against honesty: the agent gets burned either way.
      if (c.evidence?.stale) staleCount++;
    } else unknownCount++;
  }
  const definite = trueCount + falseCount;
  const suppressed = definite > 0 && definite < MIN_DEFINITE_FOR_SCORE;
  const honesty = definite >= MIN_DEFINITE_FOR_SCORE ? Math.round((100 * trueCount) / definite) : null;
  return { trueCount, falseCount, unknownCount, staleCount, definite, honesty, suppressed };
}

// Dead-token line: ~chars/4 of every paragraph containing ≥1 false
// path/symbol claim (design doc). Paragraph = blank-line block (7A).
export function deadTokens(fileParagraphs, claims, tokchars) {
  const falseLines = new Map(); // file -> Set(lines)
  for (const c of claims) {
    if (c.verdict !== "false") continue;
    if (c.oracle !== "path" && c.oracle !== "symbol") continue;
    if (!falseLines.has(c.source.file)) falseLines.set(c.source.file, new Set());
    falseLines.get(c.source.file).add(c.source.line);
  }
  let total = 0;
  for (const [file, paragraphs] of fileParagraphs) {
    const lines = falseLines.get(file);
    if (!lines) continue;
    for (const p of paragraphs) {
      let hit = false;
      for (const n of lines) if (n >= p.start && n <= p.end) { hit = true; break; }
      if (hit) total += tokchars(p.text);
    }
  }
  return total;
}
