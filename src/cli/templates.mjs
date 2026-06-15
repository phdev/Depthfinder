// Consequence templates — the ONLY inferential sentence in the render
// (eng review 6A; design doc Open Question 2).
//
// CUT-RULE (enforced by review + exact-match test): a template may state
// only what follows from the predicate's LITERAL meaning. Slots are literal
// values from the claim (paths, names, numbers). Any template that needs a
// leap beyond the predicate — guessing intent, topic, or severity — gets
// cut, not softened. The render must use these verbatim (templates.test).
export const TEMPLATES = {
  path: "an agent following this reference will find nothing at {path}, and guess",
  dependency: "an agent will write code against {name}, which isn't installed",
  symbol: "an agent will call {symbol} expecting it to be exported; it isn't",
  count: 'an agent reasoning about "{n} {noun}" will plan against a structure that has {actual}',
};

export function consequence(claim) {
  const t = TEMPLATES[claim.oracle];
  if (!t) return null;
  const a = claim.predicate.args;
  return t
    .replace("{path}", a.path ?? "")
    .replace("{name}", a.name ?? "")
    .replace("{symbol}", a.symbol ?? "")
    .replace("{n}", String(a.n ?? ""))
    .replace("{noun}", a.noun ?? "")
    .replace("{actual}", claim.evidence.actual ? claim.evidence.actual.replace(/^= /, "") : "a different count");
}

// Suggested-action ("→ fix:") line per hotspot. DETERMINISTIC from the claim's
// oracle + literal args + evidence — same cut-rule as the consequence templates:
// no guessed intent. The path hint mentions --fix GENERICALLY (it auto-repoints
// only git-proven renames), never falsely promising it for a deletion/fabrication.
export const FIX_HINTS = {
  path: "repoint or remove this path — `npx depthfinder --fix --write` auto-repoints any git-proven rename",
  dependency: "remove the line, or add `{name}` to your dependencies",
  symbol: "remove or correct the reference to `{symbol}`",
  count: "update the count to {actual}",
};

export function fixHint(claim) {
  const t = FIX_HINTS[claim.oracle];
  if (!t) return null;
  const a = claim.predicate.args;
  // count "actual" reads like "3 in `router/config.js`" — keep just the number.
  const actual = claim.evidence?.actual
    ? claim.evidence.actual.replace(/^= /, "").replace(/\s+in\s+.*$/, "")
    : "the real value";
  return t
    .replace("{name}", a.name ?? "")
    .replace("{symbol}", a.symbol ?? "")
    .replace("{actual}", actual);
}

// Criticality of a rotted claim — how badly a wrong claim of this shape misleads
// an agent. A dead PATH the agent will try to open is the worst; a wrong COUNT
// the least. A never-existed path (false) outranks a moved/deleted one (stale):
// stale leaves a git trail and `--fix` can auto-repoint a rename. Pure; returns
// one of CRIT / HIGH / MED / LOW — same cut-rule as the templates (no guessed
// intent, only the claim's oracle + whether git proves it once existed).
export const CRITICALITY_RANK = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 };
export function criticality(claim) {
  switch (claim.oracle) {
    case "path":
      return claim.evidence?.stale ? "HIGH" : "CRIT";
    case "dependency":
      return "HIGH";
    case "symbol":
      return "MED";
    case "count":
      return "LOW";
    default:
      return "MED";
  }
}
