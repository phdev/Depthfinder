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
