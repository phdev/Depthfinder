// Doc-mode claim filter — the precision layer that lets Depthfinder scan
// general repo docs (runbooks, design notes, package READMEs) without
// false-accusing honest prose.
//
// Convention files (CLAUDE.md) are present-tense contracts; general docs mix
// tenses, examples, and generated-artifact descriptions. The 4 oracles assume
// present-tense assertion, so on docs we run ONLY the path oracle and then
// DROP any claim whose source line is narrative / example / generated-sink /
// fenced. A dropped line yields no claim at all (not even `unknown`) — it was
// never a checkable assertion. Posture: a missed doc claim is fine; a false
// accusation is fatal (the same reason doc-scanning was deferred in V1.0).
//
// Pure module (no fs, no path resolution) per the import-time-side-effects
// rule — same constraint as lib/text.mjs.

// Past/narrative cues — the doc is describing history, not current state.
// `was`/`were` are deliberately EXCLUDED: too broad ("if the repo was cloned,
// run X" is present-intent). (eng-review outside-voice absorb #9)
const NARRATIVE =
  /\b(removed|deleted|used to|formerly|previously|deprecated|no longer|renamed|migrated|legacy|obsolete|until recently)\b/i;

// Example / illustration markers — the path is a stand-in, not a real file.
const EXAMPLE =
  /\b(e\.g\.|i\.e\.|for example|for instance|such as|sample|examples?|hypothetical|placeholder|imagine|pretend|say)\b/i;

// Generated-artifact sinks — the path is an OUTPUT location, not a source file.
// Expanded well past "written to" (absorb #2): home-center's real FP was
// "a gate that writes `agentci/reports/latest.md`" — accurate prose about an
// uncommitted runtime artifact, with NO "to" after the verb. Strong output
// verbs match bare; weaker ones (created/available/...) need a preposition so
// they don't swallow ordinary prose. NOT included: "lives in" / "located in"
// without a sink — those are present-tense LOCATION claims we WANT to check.
const GEN_VERB =
  /\b(written|writes?|wrote|generates?|generated|emits?|emitted|saves?|saved|dumps?|dumped|publish(es|ed)?|downloads?|downloaded|caches?|cached|mounts?|mounted|serves?|served|outputs?|stores?|stored|commits?|committed)\b/i;
const GEN_PHRASE = /\b(created|available|placed|produced)\s+(at|in|under|by|to)\b/i;

// Imperative change-instructions about a file ("Remove `X`", "Delete `X`",
// "Port `X`") — spec/plan prose, not a present-tense existence claim; the
// file is often mid-removal and legitimately absent. Require the verb
// immediately before a backtick so ordinary prose ("remove the cache") is
// untouched. (corpus gate: sst/opencode specs false-accused dozens.)
const IMPERATIVE =
  /\b(remove|delete[sd]?|drops?|rename[sd]?|deprecates?|ports?|migrates?|moves?|replaces?)\s+`/i;

// A doc line yields NO checkable claims when it is fenced code or carries any
// narrative/example/generated cue. Conservative LINE-level drop (absorb #3):
// one cue kills every claim on the line — a safe miss, never a false
// accusation. Span-level precision is a deferred refinement.
export function isNarrativeLine(line) {
  if (!line) return false;
  if (line.inFence) return true;
  const t = line.text;
  return NARRATIVE.test(t) || EXAMPLE.test(t) || GEN_VERB.test(t) || GEN_PHRASE.test(t) || IMPERATIVE.test(t);
}

// Keep only the doc path claims that sit on checkable present-tense lines.
export function keepDocClaims(claims, linesByNum) {
  return claims.filter((c) => !isNarrativeLine(linesByNum.get(c.source.line)));
}
