// claims.json payload + explicit file writes (eng review 5A + absorb #3).
//
// Default run writes NOTHING. --json prints the payload to stdout; --out
// writes claims.json into the named directory ATOMICALLY (tmp + rename).
// Output files are excluded from any future scan concern by living wherever
// the user pointed --out (never auto-inside scanned context conventions).
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export function buildPayload(model) {
  const { scannedFiles, linkedFiles = [], trackedCount, score, dead, claims, meta } = model;
  return {
    schema: 0,
    tool: "depthfinder",
    generatedAt: model.now,
    root: model.rootLabel,
    scanned: scannedFiles,
    linked: linkedFiles,
    trackedFiles: trackedCount,
    score: {
      honesty: score.honesty,
      suppressed: score.suppressed,
      definite: score.definite,
      true: score.trueCount,
      false: score.falseCount,
      stale: score.staleCount,
      unknown: score.unknownCount,
    },
    weight: { approxTokens: model.weight, method: "chars/4 over scanned context files — loads every turn" },
    deadTokens: { approx: dead, method: "chars/4 over paragraphs containing ≥1 false path/symbol claim" },
    meta,
    claims,
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
