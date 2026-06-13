// Input ingestion policy (eng review 7A + 11A) — ONE choke point.
//
// If Depthfinder can't read or parse an input confidently it says so on
// stderr and degrades (skip / unknown). It never guesses, never crashes,
// never accuses. Per-case semantics:
//   UTF-16 / BOM        -> skip file + warn (regexes would silently mismatch)
//   > 2MB context file  -> skip file + warn
//   EACCES / read error -> skip file + warn
//   line > 1000 chars   -> excluded from extraction, counted in meta (ReDoS
//                          guard — prose claims live on prose-length lines)
// Paragraphs are blank-line-separated blocks (dead-token segmentation).
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_LINE_CHARS = 1000;

// -> { ok:true, lines:[{n,text,long}], paragraphs:[{start,end,text}],
//      skippedLines, chars }   (chars feeds the Weight line: chars/4 ≈ the
//      tokens this file loads into the agent every turn)
//  | { ok:false, reason }
export function readContextFile(root, rel) {
  const abs = join(root, rel);
  let buf;
  try {
    const st = statSync(abs);
    if (st.size > MAX_FILE_BYTES)
      return { ok: false, reason: `larger than ${MAX_FILE_BYTES / 1024 / 1024}MB` };
    buf = readFileSync(abs);
  } catch (e) {
    return { ok: false, reason: e.code === "EACCES" ? "permission denied" : `unreadable (${e.code || e.message})` };
  }

  // UTF-16 sniff: BOMs, or a NUL-heavy prefix (UTF-16 without BOM).
  if (buf.length >= 2) {
    const b0 = buf[0], b1 = buf[1];
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff))
      return { ok: false, reason: "UTF-16 encoding (BOM)" };
  }
  const probe = buf.subarray(0, Math.min(256, buf.length));
  let nuls = 0;
  for (const b of probe) if (b === 0) nuls++;
  if (probe.length > 16 && nuls / probe.length > 0.1)
    return { ok: false, reason: "non-UTF-8 encoding" };

  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM

  const rawLines = text.split(/\r?\n/);
  let skippedLines = 0;
  // Fenced-code tracking (CommonMark-ish): ``` or ~~~ (3+), indent ≤3. The
  // opener may carry an info string; the closer is the same char, length ≥
  // opener, no info string. `inFence` is computed for EVERY file but only the
  // doc-scan path consults it (Context Honesty stays byte-stable). Unclosed
  // fence at EOF leaves the tail fenced — a safe miss, never a false claim.
  let fence = null;
  const lines = rawLines.map((t, i) => {
    const long = t.length > MAX_LINE_CHARS;
    if (long) skippedLines++;
    let inFence;
    const m = t.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (m) {
      const ch = m[1][0], len = m[1].length, info = m[2].trim();
      if (!fence) { fence = { ch, len }; inFence = true; }
      else if (ch === fence.ch && len >= fence.len && info === "") { fence = null; inFence = true; }
      else inFence = true; // fence-like line inside a different fence = content
    } else {
      inFence = fence !== null;
    }
    return { n: i + 1, text: t, long, inFence };
  });

  // Blank-line paragraph segmentation with line ranges.
  const paragraphs = [];
  let start = null, bufText = [];
  for (const line of lines) {
    if (line.text.trim() === "") {
      if (start !== null) {
        paragraphs.push({ start, end: line.n - 1, text: bufText.join("\n") });
        start = null;
        bufText = [];
      }
    } else {
      if (start === null) start = line.n;
      bufText.push(line.text);
    }
  }
  if (start !== null)
    paragraphs.push({ start, end: lines.length, text: bufText.join("\n") });

  return { ok: true, lines, paragraphs, skippedLines, chars: text.length };
}
