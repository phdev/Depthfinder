// Shared extraction helpers. Extraction is conservative by design: anything
// not matching an explicit rule is deliberately ignored. A missed claim is
// acceptable; a false accusation is not (design doc, extraction rules).
import { createHash } from "node:crypto";

export function backtickSpans(text) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function linkTargets(text) {
  const out = [];
  const re = /\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function isSchemePrefixed(s) {
  return /^[a-z][a-z0-9+.-]*:/i.test(s); // http:, https:, mailto:, vscode:, …
}

// Host-like first segment: "docs.example.com" — a dot INSIDE the segment.
export function isHostLike(seg) {
  return /^[\w-]+(\.[\w-]+)+$/.test(seg);
}

export function makeClaim({ oracle, kind = "descriptive", text, file, line, predicate, pattern, confidence }) {
  const id =
    "clm_" +
    createHash("sha1")
      .update(`${file}:${line}:${JSON.stringify(predicate)}`)
      .digest("hex")
      .slice(0, 12);
  return {
    id,
    schema: 0,
    kind,
    text,
    source: { file, line },
    oracle,
    predicate,
    extraction: { pattern, confidence },
    verdict: "unknown",
    evidence: { summary: "", actual: null, checkedAt: null },
  };
}
