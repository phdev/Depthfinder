// claims.json payload + explicit file writes (eng review 5A + absorb #3).
//
// Default run writes nothing to the SCANNED REPO (the score-history line goes
// to the user cache dir; see history.mjs). --json prints the payload to
// stdout; --out writes claims.json into the named directory ATOMICALLY.
// Output files are excluded from any future scan concern by living wherever
// the user pointed --out (never auto-inside scanned context conventions).
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const scoreShape = (s) => ({
  honesty: s.honesty,
  suppressed: s.suppressed,
  definite: s.definite,
  true: s.trueCount,
  false: s.falseCount,
  stale: s.staleCount,
  unknown: s.unknownCount,
});

export function buildPayload(model) {
  const {
    scannedFiles, linkedFiles = [], trackedCount, score, docScore, docFiles = [], docMeta,
    dead, claims, docClaims = [], meta,
  } = model;
  return {
    schema: 0,
    tool: "depthfinder",
    generatedAt: model.now,
    root: model.rootLabel,
    scanned: scannedFiles,
    linked: linkedFiles,
    trackedFiles: trackedCount,
    // Context tier — the surface the agent auto-loads every turn. `score` and
    // `claims` keep their exact V0 shape (additive change only).
    score: scoreShape(score),
    delta: model.delta ?? null, // Context Honesty change vs the last comparable run (null = first run / suppressed)
    gate: model.gate ?? null, // --strict gate verdict over the Context tier; null unless --strict (consumers read gate.failed)
    weight: { approxTokens: model.weight, method: "chars/4 over scanned context files — loads every turn" },
    deadTokens: { approx: dead, method: "chars/4 over paragraphs containing ≥1 false path/symbol claim" },
    // Doc tier — the wider repo docs read on demand. Advisory; NEW fields.
    docScore: docScore ? scoreShape(docScore) : null,
    docs: {
      files: docFiles,
      totalFound: docMeta?.totalFound ?? docFiles.length,
      scanned: docMeta?.scanned ?? docFiles.length,
      cappedAt: docMeta?.cappedAt ?? null,
    },
    meta,
    claims,
    docClaims,
  };
}

export function writeOut(outDir, payload) {
  mkdirSync(outDir, { recursive: true });
  const final = join(outDir, "claims.json");
  const tmp = join(outDir, `.claims.json.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
  renameSync(tmp, final);
  return final;
}
