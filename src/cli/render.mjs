// Terminal card render (design doc "The render" — golden-snapshot locked).
//
// Render decisions (approved): replay-led (findings before score), findings
// cap 3, score always shows its denominator, NO status word, all token
// figures ~-prefixed, unknown count shown when > 0. Stream discipline (8A):
// this module RETURNS strings; bin writes the card to stdout and ALL
// diagnostics to stderr. Redaction (1A) is applied by the caller at the
// stream/serializer boundary.
import { consequence } from "./templates.mjs";

const nf = new Intl.NumberFormat("en-US"); // locale-pinned for determinism

export function renderCard(model) {
  const {
    scannedFiles, trackedCount, findings, score, dead, claimsTotal,
  } = model;
  const L = [];
  L.push("");
  L.push(`  Scanning ${scannedFiles.join(", ")} against ${nf.format(trackedCount)} tracked files…`);
  L.push("");

  for (const f of findings) {
    L.push(`  ✗ ${f.source.file}:${f.source.line}  "${truncate(f.text, 88)}"`);
    L.push(`      └ ${f.evidence.summary}`);
    const why = consequence(f);
    if (why) L.push(`      └ ${why}`);
    if (f.evidence.actual) L.push(`      └ actual: ${f.evidence.actual}`);
    L.push("");
  }

  // Score block (edge matrix from the design doc)
  if (claimsTotal === 0) {
    L.push("  No checkable claims found in the scanned context files.");
  } else if (score.definite === 0) {
    L.push(`  ${nf.format(claimsTotal)} claims found, none decidable — see --json for details.`);
  } else if (score.suppressed) {
    L.push(`  Only ${score.definite} checkable claim${score.definite === 1 ? "" : "s"} — score withheld.`);
  } else if (score.falseCount === 0) {
    L.push(`  Context Honesty   100 · ${nf.format(score.definite)} checkable claims · 0 false`);
  } else {
    const unchecked = score.unknownCount > 0 ? ` · ${nf.format(score.unknownCount)} unchecked` : "";
    L.push(`  Context Honesty   ${score.honesty} · ${nf.format(score.definite)} checkable claims${unchecked}`);
  }
  L.push(`  ~${nf.format(dead)} tokens describe code that no longer exists.`);
  L.push("");
  L.push("  Your agent reads all of this as ground truth, every call.");
  L.push("  npx depthfinder --json for full results");
  L.push("");
  return L.join("\n");
}

function truncate(s, max) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}
