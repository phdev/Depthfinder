// COUNT oracle extraction (design doc — one shipped counting rule).
//
// "N <noun>" only when the same line carries a delimited anchor path.
// One rule: object/array-literal cardinality where the binding identifier
// matches the noun. Med confidence max; unanchored counts are ignored.
import { backtickSpans, makeClaim } from "./shared.mjs";

const NOUNS = /(\d+)\s+(tiers?|tabs?|panels?|services?|scripts?)\b/gi;
const PATH_LIKE = /^[\w.-]+(\/[\w.-]+)+\.\w{1,8}$/;

export function extractCountClaims(file, lines) {
  const claims = [];
  const seen = new Set();
  for (const line of lines) {
    if (line.long) continue;
    const anchor = backtickSpans(line.text).find((s) => PATH_LIKE.test(s));
    if (!anchor) continue;
    NOUNS.lastIndex = 0;
    let m;
    while ((m = NOUNS.exec(line.text))) {
      const n = parseInt(m[1], 10);
      const noun = m[2].toLowerCase();
      const key = `${line.n}:${n}:${noun}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push(
        makeClaim({
          oracle: "count",
          text: line.text.trim(),
          file,
          line: line.n,
          predicate: { type: "count_matches", args: { n, noun, anchor } },
          pattern: "anchored_count",
          confidence: "med",
        }),
      );
    }
  }
  return claims;
}
