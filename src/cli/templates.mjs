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
