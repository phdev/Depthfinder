// Terminal card render (design doc "The render" — golden-snapshot locked).
//
// Render decisions (approved): replay-led (findings before score), findings
// cap 3, score always shows its denominator, NO status word, all token
// figures ~-prefixed, unknown count shown when > 0. Below the score: the
// Weight line (what these files load into the agent every turn) and the
// breakdown line — false (fabricated/never existed) · stale (was true once,
// git history proves it) · dead tokens. Stream discipline (8A): this module
// RETURNS strings; bin writes the card to stdout and ALL diagnostics to
// stderr. Redaction (1A) is applied by the caller at the stream/serializer
// boundary.
import { consequence } from "./templates.mjs";

const nf = new Intl.NumberFormat("en-US"); // locale-pinned for determinism

export function renderCard(model) {
  const {
    scannedFiles, linkedFiles = [], trackedCount, findings, score, docScore, docFiles = [],
    dead, weight, claimsTotal,
  } = model;
  const L = [];
  L.push("");
  const linkNote = linkedFiles.length
    ? ` (+${linkedFiles.length} linked doc${linkedFiles.length === 1 ? "" : "s"})`
    : "";
  L.push(`  Scanning ${scannedFiles.join(", ")}${linkNote} against ${nf.format(trackedCount)} tracked files…`);
  L.push("");

  for (const f of findings) {
    L.push(`  ✗ ${f.source.file}:${f.source.line}  "${truncate(f.text, 88)}"`);
    L.push(`      └ ${f.evidence.summary}`);
    if (f.burn && !f.burn.error) {
      // The moment, undeniable: a real agent's words, then the contradiction.
      L.push(`      ▶ ${f.burn.agent} answered (your context, no repo to check):`);
      for (const ln of wrapText(f.burn.output, 60)) L.push(`           ${ln}`);
      L.push(`      └ stated as fact — from a line your repo already contradicts.`);
    } else {
      if (f.burn?.error) L.push(`      ▶ burn skipped: ${f.burn.error}`);
      const why = consequence(f);
      if (why) L.push(`      └ ${why}`);
      // skip the actual line when the consequence already carries it (count)
      if (f.evidence.actual && !(why && why.includes(f.evidence.actual)))
        L.push(`      └ actual: ${f.evidence.actual}`);
    }
    L.push("");
  }

  // Score block (edge matrix from the design doc)
  if (claimsTotal === 0) {
    L.push("  No checkable claims found in the scanned context files.");
  } else if (score.definite === 0) {
    L.push(`  ${nf.format(claimsTotal)} claims found, none decidable — see --json for details.`);
  } else if (score.suppressed) {
    L.push(`  Only ${score.definite} checkable claim${score.definite === 1 ? "" : "s"} — score withheld.`);
  } else {
    const unchecked = score.unknownCount > 0 ? ` · ${nf.format(score.unknownCount)} unchecked` : "";
    L.push(`  Context Honesty   ${score.honesty} · ${nf.format(score.definite)} checkable claims${unchecked}`);
  }
  // Doc Honesty — the wider repo docs the agent reads on demand. Advisory,
  // separate from the contract score; its dead-refs never touch the line
  // below. Label padded to align under "Context Honesty".
  if (docFiles.length > 0 && docScore) {
    const pad = "Doc Honesty".padEnd("Context Honesty".length);
    const docs = `${nf.format(docFiles.length)} doc${docFiles.length === 1 ? "" : "s"}`;
    if (docScore.honesty === null) {
      L.push(`  ${pad}   — · ${docs} · too few checkable claims`);
    } else {
      const refs = docScore.falseCount > 0 ? ` · ${nf.format(docScore.falseCount)} dead ref${docScore.falseCount === 1 ? "" : "s"}` : "";
      L.push(`  ${pad}   ${docScore.honesty} · ${nf.format(docScore.definite)} checkable claims · ${docs}${refs}`);
    }
  }
  L.push(`  Weight   ~${nf.format(weight)} tokens load every turn`);
  const fab = score.falseCount - score.staleCount;
  L.push(
    `  ${fab} false claim${fab === 1 ? "" : "s"} · ${score.staleCount} stale · ~${nf.format(dead)} tokens describe code that no longer exists`,
  );
  L.push("");
  L.push("  Your agent reads all of this as ground truth, every call.");
  L.push("  npx depthfinder --json for full results");
  L.push("");
  return L.join("\n");
}

function truncate(s, max) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

// Word-wrap the burned agent reply to keep the card readable; cap at 6 lines
// (the full reply is in --json). A long single token is hard-split.
function wrapText(s, width) {
  const lines = [];
  let cur = "";
  for (const w of s.replace(/\s+/g, " ").trim().split(" ")) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > 6) { lines.length = 6; lines[5] = lines[5].slice(0, width - 1) + "…"; }
  return lines;
}
