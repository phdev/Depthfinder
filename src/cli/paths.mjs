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
