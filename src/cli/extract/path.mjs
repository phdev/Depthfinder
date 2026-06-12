// PATH oracle extraction (design doc grammar, eng-review hardened).
//
// Delimited paths only — backtick-quoted strings or markdown link targets.
// Two branches: with-extension (high when backticked, med as link target)
// and extensionless (med, backtick only). Both require the first segment to
// be an existing repo directory. Excluded: scheme-prefixed targets,
// host-like first segments, bare prose paths.
import { backtickSpans, linkTargets, isSchemePrefixed, isHostLike, makeClaim } from "./shared.mjs";
import { firstSegment } from "../paths.mjs";

const WITH_EXT = /^[\w.-]+(\/[\w.-]+)+\.\w{1,8}$/;
const NO_EXT = /^[\w.-]+(\/[\w.-]+)+$/;

export function extractPathClaims(file, lines, ctx) {
  const claims = [];
  const seen = new Set();
  const consider = (candidate, line, pattern, confidence) => {
    if (isSchemePrefixed(candidate)) return;
    const seg = firstSegment(candidate);
    if (isHostLike(seg)) return;
    if (!ctx.dirExists(seg)) return; // first segment must be a repo dir
    const key = `${line.n}:${candidate}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(
      makeClaim({
        oracle: "path",
        text: line.text.trim(),
        file,
        line: line.n,
        predicate: { type: "file_exists", args: { path: candidate } },
        pattern,
        confidence,
      }),
    );
  };

  for (const line of lines) {
    if (line.long || !line.text.includes("/")) continue;
    for (const span of backtickSpans(line.text)) {
      if (WITH_EXT.test(span)) consider(span, line, "backtick_path", "high");
      else if (NO_EXT.test(span)) consider(span, line, "backtick_path_noext", "med");
    }
    for (const target of linkTargets(line.text)) {
      if (WITH_EXT.test(target)) consider(target, line, "link_target", "med");
    }
  }
  return claims;
}
