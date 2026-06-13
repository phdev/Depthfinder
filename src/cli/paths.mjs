// Path normalization (eng review 4A).
//
// git ls-files emits forward slashes on every platform; node:path emits
// backslashes on win32. Every comparison in the CLI happens in posix form —
// one normalize() at the seams kills the Windows false-accusation vector.
import { sep } from "node:path";

export function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

// First path segment of a posix-relative path ("src/a/b.js" -> "src").
export function firstSegment(rel) {
  const i = rel.indexOf("/");
  return i === -1 ? rel : rel.slice(0, i);
}

// Resolve a markdown link target relative to the linking file's directory,
// in posix space (4A: every comparison happens posix-side). Returns the
// repo-relative path, or null if it escapes the repo root (../ past the
// top) — an escape can't be a tracked file, and null keeps the caller from
// ever index-matching a traversal artifact.
export function resolveRelPosix(fromRel, target) {
  const baseDir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
  const stack = baseDir ? baseDir.split("/") : [];
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length === 0) return null; // escapes the repo root
      stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return stack.join("/") || null;
}
