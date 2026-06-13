// Context-file discovery (design doc "Discovery" + eng review).
//
// Conventions scanned, exactly:
//   root: CLAUDE.md, AGENTS.md, .cursorrules          (disk check — a brand
//         new, not-yet-added context file must still be scanned)
//   .cursor/rules/**/*.mdc                            (index ∪ disk walk of
//         that one small dir)
//   nested **/CLAUDE.md and **/AGENTS.md              (tracked index only —
//         node_modules / gitignored excluded for free)
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toPosix } from "./paths.mjs";

const ROOT_NAMES = ["CLAUDE.md", "AGENTS.md", ".cursorrules"];

export function discover(root, index) {
  const found = new Set();

  for (const name of ROOT_NAMES) {
    if (index.has(name) || existsSync(join(root, name))) found.add(name);
  }

  for (const rel of index) {
    if (/^\.cursor\/rules\/.+\.mdc$/.test(rel)) found.add(rel);
    else if (/.+\/(CLAUDE|AGENTS)\.md$/.test(rel)) found.add(rel);
  }

  // .cursor/rules may hold not-yet-tracked .mdc files; the dir is small.
  const rulesDir = join(root, ".cursor", "rules");
  if (existsSync(rulesDir)) {
    const stack = [rulesDir];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.name.endsWith(".mdc"))
          found.add(toPosix(abs.slice(root.length + 1)));
      }
    }
  }

  return [...found].sort();
}

// Narrative-by-nature file kinds, excluded wholesale from the docs audit:
// changelogs and explicitly-named example/sample files are 100% historical or
// illustrative, so per-line filtering can't make them safe. (eng-review #2)
const DOC_SKIP =
  /(^|\/)(CHANGELOG|HISTORY|CHANGES)[^/]*$|-sample\.md$|\.example\.md$|(^|\/)(examples?|samples?|fixtures|testdata)\//i;

// Doc-tier discovery: every TRACKED .md that isn't already a Context-tier
// surface (convention file or one-hop linked doc) and isn't a narrative file
// kind. Index-only (no disk walk); gitignored files are absent for free.
export function discoverDocs(root, index, exclude) {
  const out = [];
  for (const rel of index) {
    if (!/\.md$/i.test(rel)) continue;
    if (exclude.has(rel)) continue;
    if (DOC_SKIP.test(rel)) continue;
    out.push(rel);
  }
  return out.sort();
}
