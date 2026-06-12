// SYMBOL oracle extraction (design doc patterns).
//
//   exports `X`            (+ optional `file` delimited on the same line)
//   `X()` in `file`
// Confidence: high when a file is named on the line, med when repo-wide.
import { backtickSpans, makeClaim } from "./shared.mjs";

const PATH_LIKE = /^[\w.-]+(\/[\w.-]+)+\.\w{1,8}$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;

export function extractSymbolClaims(file, lines) {
  const claims = [];
  const seen = new Set();
  const add = (symbol, target, line, pattern) => {
    const key = `${line.n}:${symbol}:${target || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(
      makeClaim({
        oracle: "symbol",
        text: line.text.trim(),
        file,
        line: line.n,
        predicate: { type: "symbol_exported", args: { symbol, file: target } },
        pattern,
        confidence: target ? "high" : "med",
      }),
    );
  };

  for (const line of lines) {
    if (line.long) continue;
    const spans = backtickSpans(line.text);
    const pathOnLine = spans.find((s) => PATH_LIKE.test(s)) || null;

    // exports `X`
    let m = line.text.match(/\bexports?\s+`([^`]+)`/i);
    if (m && IDENT.test(m[1])) add(m[1], pathOnLine, line, "exports_backtick");

    // `X()` in `file`
    m = line.text.match(/`([A-Za-z_$][\w$]*)\s*\(\s*\)`\s+in\s+`([^`]+)`/);
    if (m && PATH_LIKE.test(m[2])) add(m[1], m[2], line, "call_in_file");
  }
  return claims;
}
