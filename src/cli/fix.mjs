// Safe-fix (--fix): close the found→fixed loop, RENAME-ONLY.
//
// The only context-file edit Depthfinder makes is the one git can prove is
// correct: a path claim whose target was RENAMED. `git log --follow` knows
// exactly where the file went, so "src/old.ts → src/new.ts" is deterministic —
// not a guess. Deletions (no target) and fabrications (never existed) are NOT
// auto-fixable; a model might guess, but Depthfinder won't.
//
// Dry-run by default (preview, write NOTHING). `--fix --write` is the single,
// opt-in exception to "writes nothing to the scanned repo" (5A) — it rewrites
// the stale path on the claim's exact line and leaves a reviewable diff.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renameTarget } from "./git.mjs";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find rename-only fixes among false PATH claims. Each → {file, line, oldPath,
// newPath, sha}. Skips anything git can't prove is a rename (deleted, fabricated,
// or history unavailable in a shallow clone).
export function collectRenameFixes(claims, root, shallow) {
  const fixes = [];
  for (const c of claims) {
    if (c.verdict !== "false" || c.oracle !== "path") continue;
    const oldPath = c.predicate?.args?.path;
    if (!oldPath) continue;
    const rt = renameTarget(root, oldPath, shallow);
    if (rt && rt.to && rt.to !== oldPath) {
      fixes.push({ file: c.source.file, line: c.source.line, oldPath, newPath: rt.to, sha: rt.sha });
    }
  }
  return fixes;
}

// Apply fixes to the context files (the ONLY scanned-repo write; --fix --write
// only). Replaces oldPath with newPath on the claim's EXACT line, only when that
// line still contains the old path (drift-safe), and only the path token (a
// trailing path char guard stops `src/a.js` matching inside `src/a.js.bak`).
// Preserves the rest of the line (backticks, \r). Returns the fixes applied.
export function applyRenameFixes(root, fixes) {
  const byFile = new Map();
  for (const f of fixes) (byFile.get(f.file) ?? byFile.set(f.file, []).get(f.file)).push(f);
  const applied = [];
  for (const [file, fs] of byFile) {
    const abs = join(root, file);
    let text;
    try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const lines = text.split("\n");
    let changed = false;
    for (const f of fs) {
      const idx = f.line - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const re = new RegExp(escapeRegExp(f.oldPath) + "(?![\\w./-])");
      if (!re.test(lines[idx])) continue; // drifted / already fixed — skip safely
      lines[idx] = lines[idx].replace(re, f.newPath); // first occurrence on the line
      changed = true;
      applied.push(f);
    }
    if (changed) writeFileSync(abs, lines.join("\n"));
  }
  return applied;
}

// Human-readable dry-run preview (printed to stdout, like the card).
export function renderFixPreview(fixes) {
  const L = ["", `  ${fixes.length} safe rename-fix${fixes.length === 1 ? "" : "es"} — paths git proves were renamed:`, ""];
  for (const f of fixes) {
    L.push(`  ${f.file}:${f.line}`);
    L.push(`    - ${f.oldPath}`);
    L.push(`    + ${f.newPath}`);
    L.push("");
  }
  return L.join("\n") + "\n";
}
