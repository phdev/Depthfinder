// Terminal card render (design doc "The render" — golden-snapshot locked).
//
// Render decisions: a dashboard-style Health hero LEADS the card (Health N +
// status word + the Coherence/Weight/Coverage line) — a 2026-06-15 product
// decision that reversed the original "no status word / honesty-led headline"
// invariant (the user chose dashboard parity with the dishonest-headline tradeoff
// in view). Below the hero: replay (findings, cap 3), then the Context Honesty
// score (always shows its denominator), all token figures ~-prefixed, unknown
// count shown when > 0. The honesty score line stays the source of truth. Below it: the
// Weight line (what these files load into the agent every turn) and the
// breakdown line — false (fabricated/never existed) · stale (was true once,
// git history proves it) · dead tokens. Stream discipline (8A): this module
// RETURNS strings; bin writes the card to stdout and ALL diagnostics to
// stderr. Redaction (1A) is applied by the caller at the stream/serializer
// boundary.
import { consequence, fixHint } from "./templates.mjs";

const nf = new Intl.NumberFormat("en-US"); // locale-pinned for determinism

export function renderCard(model) {
  const {
    scannedFiles, linkedFiles = [], trackedCount, findings, score, docScore, docFiles = [],
    delta, dead, weight, claimsTotal, dimensions,
  } = model;
  const L = [];
  L.push("");
  const linkNote = linkedFiles.length
    ? ` (+${linkedFiles.length} linked doc${linkedFiles.length === 1 ? "" : "s"})`
    : "";
  L.push(`  Scanning ${scannedFiles.join(", ")}${linkNote} against ${nf.format(trackedCount)} tracked files…`);
  L.push("");

  // Health hero — dashboard-style headline (explicit product decision 2026-06-15,
  // reversing the earlier "no status word / honesty-led headline" invariant). The
  // STATUS WORD comes from the COMPOSITE Health per the user's dashboard-parity
  // choice: a low-honesty repo CAN read "Healthy" here — the accepted tradeoff —
  // and the Context Honesty line below still tells the unvarnished truth. Renders
  // ONLY when the honesty score is scored (dimensions non-null); suppressed below
  // 5 definite claims, same guard as the score (unknown-never-false).
  if (dimensions) {
    L.push(`  Health ${dimensions.health} · ${dimensions.rating}`);
    L.push(`  Coherence ${dimensions.coherence} · Weight ${dimensions.weight} · Coverage ${dimensions.coverage}`);
    L.push("");
  }

  // Hotspots — the ranked findings (top-3 by confidence+severity, select.mjs).
  // Numbered + headed, each closing with a deterministic "→ fix:" line.
  if (findings.length) {
    L.push("  Hotspots");
    L.push("");
  }
  let hotspotN = 0;
  for (const f of findings) {
    hotspotN++;
    L.push(`  ${hotspotN}. ✗ ${f.source.file}:${f.source.line}  "${truncate(f.text, 88)}"`);
    L.push(`      └ ${f.evidence.summary}`);
    if (f.burn && !f.burn.error) {
      // The moment, undeniable: a real agent's words, then the cost. Either it
      // took the bait (wrong turn) or it caught the lie and paid the detour
      // tax — both are the rot tax, and we name whichever happened.
      L.push(`      ▶ ${f.burn.agent} answered (your context, no repo to check):`);
      for (const ln of wrapText(f.burn.output, 60)) L.push(`           ${ln}`);
      const d = f.burn.detours ?? [];
      if (d.length)
        L.push(`      └ it caught the lie — but only after proposing ${d.length} check${d.length === 1 ? "" : "s"} (${d.slice(0, 4).join(", ")}) to route around your line. That detour is the tax, every session.`);
      else
        L.push(`      └ stated as fact, from a line your repo already contradicts. The tax is the wrong turn it just took.`);
    } else {
      if (f.burn?.error) L.push(`      ▶ burn skipped: ${f.burn.error}`);
      const why = consequence(f);
      if (why) L.push(`      └ ${why}`);
      // skip the actual line when the consequence already carries it (count)
      if (f.evidence.actual && !(why && why.includes(f.evidence.actual)))
        L.push(`      └ actual: ${f.evidence.actual}`);
    }
    const fix = fixHint(f);
    if (fix) L.push(`      → fix: ${fix}`);
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
    L.push(`  Context Honesty   ${score.honesty} · ${nf.format(score.definite)} checkable claims${unchecked}${deltaSuffix(delta)}`);
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
  // The rot tax (deterministic, no model call): a false line costs the agent
  // either way — it acts on the lie, or it stops trusting the file and
  // re-derives the whole Weight by hand. The cost isn't the false tokens, it's
  // every token the agent can no longer take on faith.
  if (score.falseCount > 0)
    L.push(`  → the rot tax: your agent acts on those false lines, or stops trusting the file and re-derives ~${nf.format(weight)} tokens by hand.`);
  L.push("");
  L.push("  Your agent reads all of this as ground truth, every call.");
  L.push("  npx depthfinder --json for full results");
  L.push("");
  return L.join("\n");
}

// "since last run" delta on the headline score. Null (first run / suppressed
// score / --no-history) prints nothing, keeping the card byte-stable in tests.
function deltaSuffix(delta) {
  if (delta == null) return "";
  if (delta > 0) return `  (▲${delta} since last run)`;
  if (delta < 0) return `  (▼${-delta} since last run)`;
  return "  (no change since last run)";
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
