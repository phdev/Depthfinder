// DEPENDENCY oracle extraction (design doc, two explicit branches).
//
//  (a) phrase (uses|depends on|built with|powered by|handled by) + name -> high
//  (b) backticked npm-grammar name alone -> med
// Undelimited names without a phrase are ignored. Guards against false
// candidates: common-word stoplist, file-extension-looking names, paths.
import { backtickSpans, makeClaim } from "./shared.mjs";

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][a-z0-9._-]*$/; // no leading - or .
const FILE_EXT = /\.(json|md|mjs|cjs|js|ts|tsx|jsx|yml|yaml|txt|css|html|svg|png|sh|lock)$/i;
const STOPLIST = new Set([
  "test", "tests", "build", "start", "run", "node", "npm", "npx", "git",
  "main", "index", "app", "server", "config", "src", "lib", "docs", "bin",
  "dist", "public", "true", "false", "null", "dev", "prod", "ci", "api",
  "cli", "json", "yaml", "http", "https", "readme", "license", "todo",
  // pronouns/articles/verbs that follow phrase verbs in ordinary prose —
  // the self-scan caught "uses its" as a dependency claim. Never again.
  "its", "the", "this", "that", "it", "a", "an", "all", "any", "and", "are",
  "was", "were", "has", "have", "had", "can", "will", "your", "our", "her",
  "his", "their", "them", "these", "those", "one", "two", "some", "only",
]);
const PHRASE = /\b(uses|depends on|built with|powered by|handled by)\s+(`([^`]+)`|([a-z0-9@][\w@/.\-~]*))/gi;

// Names accepted as dependency claims must be unambiguously package-shaped.
// Plain hyphenated words appear constantly in prose as repo/tool/concept
// names (home-center, context-rot) — the self-scan false-accused them, so:
//   backticked + phrase  -> any name shape, mixed case allowed (the author
//                           wrote "handled by `X`" — intent is unambiguous;
//                           legacy npm names like openWakeWord have caps)
//   undelimited + phrase -> must contain @ or . chars (package-ish)
//   backtick alone       -> @scoped names only        (unambiguous npm shape)
const PHRASED_NAME = /^(@[\w.-]+\/)?[A-Za-z0-9][\w.-]*$/; // case-tolerant
// SCREAMING_SNAKE names are env vars / config knobs, never npm packages
// (the registry has been lowercase-only since 2014; legacy mixed-case names
// like openWakeWord still pass). Real-corpus FP: "speech mode uses
// `SPEECH_CANDIDATE_COOLDOWN_SECONDS`" became a dependency accusation.
const ENV_VAR = /^[A-Z][A-Z0-9_]*$/;
function validName(name, { delimited, phrase }) {
  if (!name || name.length < 3) return false;
  if (FILE_EXT.test(name)) return false;
  if (name.includes("/") && !name.startsWith("@")) return false; // path-like
  if (STOPLIST.has(name.toLowerCase())) return false;
  if (ENV_VAR.test(name)) return false;
  // npm names are lowercase-first; a PascalCase token after "uses `X`" is a
  // code TYPE/class, not a package (corpus gate: opencode AGENTS.md
  // "uses `ScopedCache`" / "`InstanceState`"). Legacy camelCase like
  // openWakeWord (lowercase-first) still passes.
  if (/^[A-Z]/.test(name.startsWith("@") ? name.split("/")[1] || "" : name)) return false;
  // Dotted non-@scoped names (`context.now`, `req.body`) are code
  // expressions far more often than packages; socket.io-style names are
  // the rare loss — a deliberate miss, never an accusation. Real-corpus
  // FP: "all time math uses `context.now`" became a dependency claim.
  if (!name.startsWith("@") && name.includes(".")) return false;
  if (phrase && delimited) return PHRASED_NAME.test(name);
  if (!NPM_NAME.test(name)) return false;
  if (phrase && !delimited) return name.includes("@");
  return name.startsWith("@"); // backtick alone
}

export function extractDependencyClaims(file, lines) {
  const claims = [];
  const seen = new Set();
  const add = (name, line, pattern, confidence) => {
    const key = `${line.n}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(
      makeClaim({
        oracle: "dependency",
        text: line.text.trim(),
        file,
        line: line.n,
        predicate: { type: "declared_dependency", args: { name } },
        pattern,
        confidence,
      }),
    );
  };

  for (const line of lines) {
    if (line.long) continue;
    PHRASE.lastIndex = 0;
    let m;
    const phraseNames = new Set();
    while ((m = PHRASE.exec(line.text))) {
      const delimited = m[3] !== undefined;
      const name = (m[3] || m[4] || "").trim();
      if (validName(name, { delimited, phrase: true })) {
        phraseNames.add(name);
        add(name, line, "phrase_dependency", "high");
      }
    }
    // branch (b): backticked name alone — @scoped only (see validName note).
    for (const span of backtickSpans(line.text)) {
      const name = span.trim();
      if (phraseNames.has(name)) continue;
      if (!validName(name, { delimited: true, phrase: false })) continue;
      add(name, line, "backtick_dependency", "med");
    }
  }
  return claims;
}
