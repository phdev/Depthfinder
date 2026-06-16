// Terminal card render (design doc "The render" — golden-snapshot locked).
//
// Render decisions: a dashboard-style Health hero LEADS the card as a stack of
// colored meters — Health (the composite) on top, then its three contributing
// dimensions (Honesty / Weight / Coverage) indented under it with a ↳, each
// with a one-line description and a 4-tier color (critical/caution/ok/great) on
// the bar + number. This reversed the original "no status word / honesty-led
// headline" tradeoff in view, 2026-06-15). Below the meters: ALL hotspots
// (uncapped), each tagged with a colored criticality level and the score it
// returns if fixed (Health first, then Honesty, in green). The old "Context
// Honesty N · …" summary line was removed (2026-06-15) — that number now lives
// in the Honesty meter, its delta rides the same line, unknowns are encoded in
// Coverage. Color is OPT-IN (`{color}`, default off) and applied only when the
// caller knows stdout is a TTY: piped output, tests, and the golden snapshot
// stay plain bytes. Stream discipline (8A): this module RETURNS strings; bin
// writes the card to stdout and ALL diagnostics to stderr. Redaction (1A) is
// applied by the caller at the stream/serializer boundary.
import { consequence, fixHint, criticality } from "./templates.mjs";
import { tierOf, computeFixGain } from "./dimensions.mjs";

const nf = new Intl.NumberFormat("en-US"); // locale-pinned for determinism

// Standard 16-color SGR — vivid and UNIVERSALLY supported. (The earlier soft
// 256-color palette rendered washed-out / near-white, or not at all, on some
// terminals — so the meters read as uncolored.) TTY-only; see `color` below.
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const TIER_COLOR = { critical: "\x1b[31m", caution: "\x1b[33m", ok: "\x1b[32m", great: "\x1b[92m" };
const CRIT_COLOR = { CRIT: "\x1b[91m", HIGH: "\x1b[33m", MED: "\x1b[36m", LOW: "\x1b[90m" };
const GAIN_COLOR = "\x1b[32m"; // green — a positive score gain
const BAR_W = 20;

const pad3 = (n) => String(n).padStart(3);

export function renderCard(model, { color = false } = {}) {
  const {
    scannedFiles, linkedFiles = [], trackedCount, findings, score, docScore, docFiles = [],
    delta, dead, weight, claimsTotal, dimensions,
  } = model;
  // paint(s, code): wrap in an SGR code when color is on; otherwise identity, so
  // every test/pipe/snapshot path is byte-for-byte the plain string.
  const paint = (s, code) => (color && code ? `${code}${s}${RESET}` : s);
  const bar = (n) => {
    const v = Math.max(0, Math.min(100, n));
    const filled = Math.round((v / 100) * BAR_W);
    return paint("█".repeat(filled), TIER_COLOR[tierOf(v)]) + paint("░".repeat(BAR_W - filled), DIM);
  };
  // The score returned by fixing rot (Health-first, green) — null when suppressed.
  const gain = computeFixGain({ score, weight, budget: dimensions?.budget });

  const L = [];
  L.push("");
  const linkNote = linkedFiles.length
    ? ` (+${linkedFiles.length} linked doc${linkedFiles.length === 1 ? "" : "s"})`
    : "";
  L.push(`  Scanning ${scannedFiles.join(", ")}${linkNote} against ${nf.format(trackedCount)} tracked files…`);
  L.push("");

  // Health meters — the composite on top, its three dimensions indented under it
  // (↳) as attributes, each colored by its own value and annotated with what it
  // means. Renders ONLY when scored (dimensions non-null); suppressed below 5
  // definite claims, same guard as the score (unknown-never-false).
  if (dimensions) {
    const d = dimensions;
    L.push(`  ${"Health".padEnd(13)}${bar(d.health)}  ${paint(pad3(d.health), TIER_COLOR[tierOf(d.health)])} · ${paint(d.rating, TIER_COLOR[tierOf(d.health)])}`);
    const kids = [
      ["Honesty", d.honesty, "share of checkable claims that still hold", deltaSuffix(delta)],
      ["Weight", d.weight, "tokens these files load into the agent every turn", ""],
      ["Coverage", d.coverage, "how much of the context is checkable vs unknown", ""],
    ];
    for (const [label, val, desc, suffix] of kids) {
      L.push(`    ↳ ${label.padEnd(8)} ${bar(val)}  ${paint(pad3(val), TIER_COLOR[tierOf(val)])}  — ${desc}${suffix}`);
    }
    L.push("");
  }

  // Hotspots — ALL the ranked findings (uncapped), each opened by a colored
  // criticality tag and closed by a "→ fix:" line carrying the score it returns
  // if fixed (Health first, then Honesty, green). The header carries the
  // all-fixed target so the per-hotspot gains have a ceiling to read against.
  if (findings.length) {
    const fab = score.falseCount - score.staleCount;
    let head = "  Hotspots";
    if (gain) {
      const counts = `${fab} false · ${score.staleCount} stale`;
      const allG = `fix all → Health ${gain.all.fromHealth}→${gain.all.toHealth} · Honesty ${gain.all.fromHonesty}→${gain.all.toHonesty}`;
      head += `   ${counts}   ·   ${paint(allG, GAIN_COLOR)}`;
    }
    L.push(head);
    L.push("");
  }
  let hotspotN = 0;
  for (const f of findings) {
    hotspotN++;
    const tag = criticality(f);
    L.push(`  ${hotspotN}. ${paint(`[${tag}]`, CRIT_COLOR[tag])} ✗ ${f.source.file}:${f.source.line}  "${truncate(f.text, 80)}"`);
    L.push(`      └ ${f.evidence.summary}`);
    if (f.burn && !f.burn.error) {
      // The moment, undeniable: a real agent's words, then the cost. Either it
      // took the bait (wrong turn) or it caught the lie and paid the detour
      // tax — both are the rot tax, and we name whichever happened.
      L.push(`      ▶ ${f.burn.agent} answered (your context, no repo to check):`);
      for (const ln of wrapText(f.burn.output, 60)) L.push(`           ${ln}`);
      const dt = f.burn.detours ?? [];
      if (dt.length)
        L.push(`      └ it caught the lie — but only after proposing ${dt.length} check${dt.length === 1 ? "" : "s"} (${dt.slice(0, 4).join(", ")}) to route around your line. That detour is the tax, every session.`);
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
    if (fix) {
      let line = `      → fix: ${fix}`;
      if (gain) line += `   ${paint(`fix gain → Health +${gain.perFix.health} · Honesty +${gain.perFix.honesty}`, GAIN_COLOR)}`;
      L.push(line);
    }
    L.push("");
  }

  // Score states with no headline meter (edge matrix). The normal "Context
  // Honesty N · …" line was intentionally removed — its number is the Honesty
  // meter above — but the no-score states still need to say SOMETHING.
  if (claimsTotal === 0) {
    L.push("  No checkable claims found in the scanned context files.");
  } else if (score.definite === 0) {
    L.push(`  ${nf.format(claimsTotal)} claims found, none decidable — see --json for details.`);
  } else if (score.suppressed) {
    L.push(`  Only ${score.definite} checkable claim${score.definite === 1 ? "" : "s"} — score withheld.`);
  }
  // Doc Honesty — the wider repo docs the agent reads on demand. Advisory,
  // separate from the contract score; its dead-refs never touch the score above.
  if (docFiles.length > 0 && docScore) {
    const docs = `${nf.format(docFiles.length)} doc${docFiles.length === 1 ? "" : "s"}`;
    if (docScore.honesty === null) {
      L.push(`  Doc Honesty   — · ${docs} · too few checkable claims`);
    } else {
      const refs = docScore.falseCount > 0 ? ` · ${nf.format(docScore.falseCount)} dead ref${docScore.falseCount === 1 ? "" : "s"}` : "";
      L.push(`  Doc Honesty   ${docScore.honesty} · ${nf.format(docScore.definite)} checkable claims · ${docs}${refs}`);
    }
  }
  L.push(`  Weight   ~${nf.format(weight)} tokens load every turn`);
  const fab = score.falseCount - score.staleCount;
  L.push(
    `  ${fab} false claim${fab === 1 ? "" : "s"} · ${score.staleCount} stale · ~${nf.format(dead)} tokens describe code that no longer exists`,
  );
  // The rot tax (deterministic, no model call): a false line costs the agent
  // either way — it acts on the lie, or it stops trusting the file and
  // re-derives the whole Weight by hand.
  if (score.falseCount > 0)
    L.push(`  → the rot tax: your agent acts on those false lines, or stops trusting the file and re-derives ~${nf.format(weight)} tokens by hand.`);
  L.push("");
  L.push("  Your agent reads all of this as ground truth, every call.");
  L.push("  npx depthfinder --triage to step through the fixes · --json for full results");
  L.push("  In a clone? npm start → http://127.0.0.1:4317 for the full dashboard");
  L.push("");
  return L.join("\n");
}

// "since last run" delta, now riding the Honesty meter line. Null (first run /
// suppressed score / --no-history) prints nothing, keeping the card byte-stable.
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
