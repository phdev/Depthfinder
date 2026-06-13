// Transitive discovery — follow "read this first" pointers, ONE HOP.
//
// A convention file that says "before changes, read the project brain docs"
// and links them is *instructing the agent to load that surface*. Those
// linked docs are context too — and convention-only discovery misses them
// (corpus-proven: home-center's CLAUDE.md is a thin pointer to five docs/*
// brain docs holding ~75 claims the front-door scan never saw).
//
// Conservative + deterministic, matching the tool's posture:
//   - inline markdown links only — `[text](target)`
//   - target must be a relative .md file (no schemes, no anchors-only)
//   - the link must sit under a heading whose text signals required reading
//   - resolution to the repo index + the one-hop/cap/dedupe policy live in
//     the caller (bin) — this module is pure (no fs, no path resolution).
import { isSchemePrefixed } from "./extract/shared.mjs";

// Heading text that marks its section as "the agent should read this".
// Breadth is safe: a directive heading contributes nothing unless it ALSO
// contains in-repo .md links, so the (heading ∧ links) combination is the
// real signal — a "## Context" of pure prose pulls nothing.
const DIRECTIVE =
  /\b(read|reading|start|first|required?|must|brain|context|primer|onboard\w*|orient\w*|guide|guides|docs?|documentation|reference|consult|essential|overview)\b/i;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/;
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

// Pure: a convention file's lines -> [{ target, line }] for every inline
// markdown link to a relative .md file that appears under a directive
// heading. Caller resolves `target` against the file's dir + the git index.
export function directiveLinks(lines) {
  const out = [];
  let inDirective = false;
  for (const line of lines) {
    if (line.long) continue; // ReDoS guard parity with extraction (7A)
    const h = line.text.match(HEADING);
    if (h) {
      // Any heading re-scopes: a new section is directive iff its own text
      // is. (A non-directive subheading under "Read First" ends the scope —
      // a known sharp edge; see the transitive-discovery TODO.)
      inDirective = DIRECTIVE.test(h[2]);
      continue;
    }
    if (!inDirective) continue;
    MD_LINK.lastIndex = 0;
    let m;
    while ((m = MD_LINK.exec(line.text))) {
      let t = m[1].trim();
      const hash = t.indexOf("#");
      if (hash !== -1) t = t.slice(0, hash); // drop #anchor
      if (!t || isSchemePrefixed(t)) continue;
      if (!/\.md$/i.test(t)) continue;
      out.push({ target: t, line: line.n });
    }
  }
  return out;
}
