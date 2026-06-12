// Manual external-corpus run (eng review 9A) — the pre-tag ritual.
//
//   npm run corpus -- [repo-path ...]
//
// Defaults to the repos named in the design doc when present on this
// machine. CI never runs this (external repos aren't available there);
// hermetic fixtures gate every push instead.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { runCli } from "../tests/helpers/fixture.mjs";

const defaults = [
  resolve(homedir(), "home-center"),
  resolve(homedir(), "lavish-axi"),
];
const targets = (process.argv.slice(2).length ? process.argv.slice(2) : defaults)
  .map((p) => resolve(p))
  .filter((p) => existsSync(p));

if (targets.length === 0) {
  console.error("corpus: no target repos found (pass paths: npm run corpus -- /path/to/repo)");
  process.exit(2);
}

let falseTotal = 0;
for (const repo of targets) {
  console.log(`\n══ ${repo} ══`);
  const card = runCli(repo);
  process.stdout.write(card.stdout);
  if (card.stderr) process.stderr.write(card.stderr);
  const json = runCli(repo, ["--json"]);
  if (json.code === 0) {
    try {
      const p = JSON.parse(json.stdout);
      falseTotal += p.score.false;
      console.log(`   → definite ${p.score.definite} · false ${p.score.false} · unknown ${p.score.unknown}`);
    } catch { /* card already shown */ }
  }
}
console.log(`\ncorpus complete — ${falseTotal} false verdict(s) across ${targets.length} repo(s).`);
console.log("Hand-verify EVERY false verdict above before tagging a release —");
console.log("one false accusation in the wild is fatal to an honesty tool.");
