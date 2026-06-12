// Perf bench (eng review 12B + absorb #8): measure always, gate never in CI.
//
// Prints per-phase timings for the dirty fixture and a generated synthetic
// tree. LOCAL tripwire: exits 1 if the dirty-fixture scan exceeds 5s —
// this script never runs in CI, so the tripwire can't flake a build.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { materialize, runCli, cleanup, BIN } from "../tests/helpers/fixture.mjs";

const SYNTHETIC_FILES = 5000;

function timeRun(label, root) {
  const t0 = Date.now();
  const r = runCli(root);
  const ms = Date.now() - t0;
  console.log(`${label.padEnd(22)} ${String(ms).padStart(6)} ms   (exit ${r.code})`);
  return ms;
}

console.log("depthfinder bench — sub-5s promise, measured\n");

const dirty = materialize("dirty");
const dirtyMs = timeRun("dirty-fixture", dirty);
cleanup(dirty);

// synthetic wide tree: stresses ls-files Set + repo-wide symbol cap
const synth = materialize("clean");
for (let i = 0; i < SYNTHETIC_FILES; i++) {
  const dir = join(synth, "gen", `d${i % 50}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `f${i}.js`), `export const v${i} = ${i}\n`);
}
spawnSync("git", ["add", "-A"], { cwd: synth });
spawnSync("git", ["-c", "user.name=bench", "-c", "user.email=b@b.invalid", "commit", "-q", "-m", "synth"], { cwd: synth });
const synthMs = timeRun(`synthetic (${SYNTHETIC_FILES}f)`, synth);
cleanup(synth);

console.log(`\nbin: ${BIN}`);
if (dirtyMs > 5000) {
  console.error(`\nTRIPWIRE: dirty-fixture scan took ${dirtyMs}ms (> 5000ms budget)`);
  process.exit(1);
}
console.log("within budget ✓");
