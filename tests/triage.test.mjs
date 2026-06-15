// --triage pure helpers + the criticality tag. The interactive raw-mode loop
// (runTriage) is exercised by hand / the cli gating test; here we lock the pure
// pieces that build what it shows and what it hands to the harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFixPrompt, interactiveArgv, triageRows } from "../src/cli/triage.mjs";
import { criticality } from "../src/cli/templates.mjs";

const pathClaim = (over = {}) => ({
  source: { file: "CLAUDE.md", line: 67 },
  text: "auth flows live in `src/auth/oauth.ts`",
  oracle: "path",
  predicate: { args: { path: "src/auth/oauth.ts" } },
  evidence: { summary: "no such tracked file", stale: false },
  ...over,
});

test("criticality: dead path worst (CRIT), stale path HIGH, dep HIGH, symbol MED, count LOW", () => {
  assert.equal(criticality(pathClaim()), "CRIT"); // never existed
  assert.equal(criticality(pathClaim({ evidence: { stale: true } })), "HIGH"); // git-proven moved/deleted
  assert.equal(criticality({ oracle: "dependency" }), "HIGH");
  assert.equal(criticality({ oracle: "symbol" }), "MED");
  assert.equal(criticality({ oracle: "count" }), "LOW");
});

test("interactiveArgv: strips the headless subcommand for known agents, passes custom through", () => {
  assert.deepEqual(interactiveArgv(["claude", "-p"]), ["claude"]); // headless → interactive
  assert.deepEqual(interactiveArgv(["codex", "exec"]), ["codex"]);
  assert.deepEqual(interactiveArgv(["mytool", "run"]), ["mytool", "run"]); // custom → unchanged
  assert.deepEqual(interactiveArgv(["claude"]), ["claude"]); // already interactive
  assert.equal(interactiveArgv(null), null);
});

test("buildFixPrompt: grounded in claim + git evidence, redacts secrets, forbids inventing a target", () => {
  const p = buildFixPrompt(pathClaim({ evidence: { summary: "no such tracked file — deleted at a1b3f2e" } }));
  assert.match(p, /CLAUDE\.md:67/);
  assert.match(p, /src\/auth\/oauth\.ts/);
  assert.match(p, /deleted at a1b3f2e/);
  assert.match(p, /Do not invent a replacement/);
  assert.match(p, /Change only this claim/);
  // the rotted line is redacted before it can leave the process (triage spawns a
  // model, like --burn): a key-shaped token must not survive into the prompt.
  const withKey = buildFixPrompt(pathClaim({ text: "token sk-ant-api03-" + "A".repeat(80) }));
  assert.doesNotMatch(withKey, /sk-ant-api03-AAAAAAAA/);
});

test("triageRows: one row per finding, with tag + location + subject + honesty gain", () => {
  const countClaim = { oracle: "count", source: { file: "CLAUDE.md", line: 9 }, text: "4 tiers", predicate: { args: { n: 4, noun: "tiers" } }, evidence: {} };
  const rows = triageRows([pathClaim(), countClaim], { perFix: { honesty: 5, health: 2 } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tag, "CRIT");
  assert.equal(rows[0].loc, "CLAUDE.md:67");
  assert.equal(rows[0].subj, "src/auth/oauth.ts");
  assert.equal(rows[0].gain, "Honesty +5");
  assert.equal(rows[1].tag, "LOW");
  assert.equal(rows[1].subj, "4 tiers");
  assert.equal(triageRows([pathClaim()], null)[0].gain, ""); // suppressed score → no gain string
});
