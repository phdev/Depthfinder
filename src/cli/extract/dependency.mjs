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
//   backticked + phrase  -> any valid npm name        (author's intent clear)
//   undelimited + phrase -> must contain @ or . chars (package-ish)
//   backtick alone       -> @scoped names only        (unambiguous npm shape)
function validName(name, { delimited, phrase }) {
  if (!name || name.length < 3) return false;
  if (!NPM_NAME.test(name)) return false;
  if (FILE_EXT.test(name)) return false;
  if (name.includes("/") && !name.startsWith("@")) return false; // path-like
  if (STOPLIST.has(name.toLowerCase())) return false;
  if (phrase && delimited) return true;
  if (phrase && !delimited) return /[@.]/.test(name);
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
