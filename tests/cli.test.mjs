// End-to-end CLI behavior: exit codes, write-nothing default, stream
// discipline, redaction, precision gate, --out atomicity, [path] arg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { materialize, makeRepo, runCli, hashTree, cleanup, STUB_AGENT } from "./helpers/fixture.mjs";

test("exit 2: not a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "df-norepo-"));
  const r = runCli(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not a git repository/);
  assert.equal(r.stdout, "");
  rmSync(dir, { recursive: true, force: true });
});

test("exit 2: usage error on unknown flag", () => {
  const r = runCli(process.cwd(), ["--nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage/);
});

test("--version / --help: informational, stdout only, exit 0 (no repo needed)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const flag of ["--version", "-v"]) {
    const r = runCli(process.cwd(), [flag]);
    assert.equal(r.code, 0, `${flag} exits 0`);
    assert.equal(r.stdout, `${pkg.version}\n`, `${flag} prints the package version to stdout`);
    assert.equal(r.stderr, "", `${flag} writes nothing to stderr (8A)`);
  }
  for (const flag of ["--help", "-h"]) {
    const r = runCli(process.cwd(), [flag]);
    assert.equal(r.code, 0, `${flag} exits 0`);
    assert.match(r.stdout, /^usage: depthfinder/, `${flag} prints usage to stdout`);
    assert.equal(r.stderr, "", `${flag} writes nothing to stderr (8A)`);
  }
});

test("--convention: snippet to stdout (append-safe), how-to to stderr, exit 0 (no repo needed)", () => {
  const r = runCli(process.cwd(), ["--convention"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Context honesty \(depthfinder\)/, "stdout carries the snippet heading");
  assert.match(r.stdout, /npx depthfinder/, "snippet tells the agent to run the CLI");
  assert.ok(r.stdout.startsWith("\n"), "leads with a blank line so `>> CLAUDE.md` separates cleanly");
  // the how-to + CI pointer must NOT pollute stdout — stdout has to stay clean for `>>`
  assert.doesNotMatch(r.stdout, /Append the snippet|CI gate|--strict/, "how-to stays out of stdout");
  assert.match(r.stderr, /CLAUDE\.md|AGENTS\.md/, "stderr explains where to paste it");
  assert.match(r.stderr, /--strict/, "stderr points at the CI gate");
});

test("--install-skill: writes the /depthfinder SKILL.md into each DETECTED harness; matches the committed registry copy", () => {
  const home = mkdtempSync(join(tmpdir(), "df-home-"));
  mkdirSync(join(home, ".claude"), { recursive: true }); // Claude Code present
  mkdirSync(join(home, ".codex"), { recursive: true }); // Codex present
  try {
    const r = runCli(process.cwd(), ["--install-skill"], { HOME: home });
    assert.equal(r.code, 0);
    const claudeSkill = join(home, ".claude", "skills", "depthfinder", "SKILL.md");
    const codexSkill = join(home, ".agents", "skills", "depthfinder", "SKILL.md"); // Codex uses ~/.agents/skills
    assert.ok(existsSync(claudeSkill), "Claude Code skill written");
    assert.ok(existsSync(codexSkill), "Codex skill written");
    const content = readFileSync(claudeSkill, "utf8");
    assert.ok(content.startsWith("---\nname: depthfinder\n"), "valid SKILL.md frontmatter");
    assert.match(content, /npx depthfinder/);
    // no-drift invariant: the CLI-written skill MUST equal the committed copy that
    // registry installers (hermes skills install / npx skills add) pull from this repo.
    const committed = readFileSync(new URL("../skills/depthfinder/SKILL.md", import.meta.url), "utf8");
    assert.equal(content, committed, "CLI skill == committed skills/depthfinder/SKILL.md");
    assert.match(r.stderr, /hermes skills install|npx skills add/, "stderr points at the registry installs");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--install-skill: no harness detected → defaults to the Claude Code path, exit 0", () => {
  const home = mkdtempSync(join(tmpdir(), "df-home2-"));
  try {
    const r = runCli(process.cwd(), ["--install-skill"], { HOME: home });
    assert.equal(r.code, 0);
    assert.ok(existsSync(join(home, ".claude", "skills", "depthfinder", "SKILL.md")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── Health dimensions + --warn-below soft-gate (CLI dimension model) ──
// A clean repo with ≥5 true path claims so the honesty score (and therefore the
// dimensions) render rather than suppress.
function dimRepo() {
  const f = { "package.json": '{"name":"t","version":"1.0.0"}' };
  for (const x of ["a", "b", "c", "d", "e", "f"]) f[`src/${x}.js`] = `// ${x}\n`;
  f["CLAUDE.md"] = "# T\nSee `src/a.js`, `src/b.js`, `src/c.js`, `src/d.js`, `src/e.js`, `src/f.js`.\n";
  return makeRepo(f);
}

test("--warn-below / --weight-budget: usage validation (exit 2, before repo work)", () => {
  for (const bad of [["--warn-below", "200"], ["--warn-below", "-1"], ["--warn-below", "x"], ["--weight-budget", "0"], ["--weight-budget", "x"]])
    assert.equal(runCli(process.cwd(), bad).code, 2, bad.join(" "));
});

test("dimensions render in --json when honesty is scored (≥5 definite)", () => {
  const root = dimRepo();
  try {
    const j = JSON.parse(runCli(root, ["--json"]).stdout);
    assert.ok(j.score.honesty != null, "fixture yields a real honesty score");
    assert.ok(j.dimensions, "dimensions present");
    assert.equal(j.dimensions.honesty, j.score.honesty); // Honesty dimension = Context Honesty score
    assert.equal(typeof j.dimensions.health, "number");
    assert.ok(["Critical", "Caution", "Healthy"].includes(j.dimensions.rating));
    assert.equal(j.gate, null); // no --strict
  } finally {
    cleanup(root);
  }
});

test("--warn-below advisory (no --strict): warns on a breach, exit stays 0", () => {
  const root = dimRepo();
  try {
    // a tiny budget forces Weight down so there's a real breach to warn about
    const r = runCli(root, ["--weight-budget", "1", "--warn-below", "90"]);
    assert.equal(r.code, 0, "advisory never changes the exit code");
    assert.match(r.stderr, /below --warn-below 90/);
    assert.match(r.stderr, /advisory/);
  } finally {
    cleanup(root);
  }
});

test("--strict --warn-below: a dimension breach fails the build (exit 20); no breach passes", () => {
  const root = dimRepo();
  try {
    const fail = runCli(root, ["--strict", "--weight-budget", "1", "--warn-below", "90"]);
    assert.equal(fail.code, 20, "breach under --strict → exit 20");
    assert.match(fail.stderr, /FAIL.*dimension/);
    const pass = runCli(root, ["--strict", "--warn-below", "10"]); // default budget → all 100
    assert.equal(pass.code, 0);
    assert.match(pass.stderr, /PASS/);
  } finally {
    cleanup(root);
  }
});

test("--strict --json: gate carries warnBelow + per-dimension scores + breached", () => {
  const root = dimRepo();
  try {
    const g = JSON.parse(runCli(root, ["--strict", "--weight-budget", "1", "--warn-below", "90", "--json"]).stdout).gate;
    assert.equal(g.warnBelow, 90);
    assert.ok(g.dimensions && typeof g.dimensions.health === "number");
    assert.ok(Array.isArray(g.breached) && g.breached.includes("weight"));
    assert.equal(g.failed, true);
  } finally {
    cleanup(root);
  }
});

test("dimensions suppressed (<5 definite) → null + no --warn-below breach", () => {
  const root = makeRepo({
    "package.json": '{"name":"t","version":"1.0.0"}',
    "src/a.js": "//a\n",
    "CLAUDE.md": "# T\nSee `src/a.js`.\n", // 1 claim < 5 → honesty null
  });
  try {
    const r = runCli(root, ["--warn-below", "90"]);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /below --warn-below/); // nothing to gate on
    assert.equal(JSON.parse(runCli(root, ["--json"]).stdout).dimensions, null);
  } finally {
    cleanup(root);
  }
});

test("--triage: gated — needs a TTY (errors in a pipe) and refuses --json", () => {
  const root = materialize("dirty");
  try {
    // the test harness pipes stdio, so stdout/stdin are not TTYs → usage error
    const r = runCli(root, ["--triage"]);
    assert.equal(r.code, 2, "non-TTY → exit 2");
    assert.match(r.stderr, /--triage needs an interactive terminal/);
    // mutually exclusive with --json (interactive vs machine output)
    const j = runCli(root, ["--triage", "--json"]);
    assert.equal(j.code, 2);
    assert.match(j.stderr, /can't be combined with --json/);
  } finally {
    cleanup(root);
  }
});

test("color: piped → plain by default; --color / FORCE_COLOR force it; --no-color / NO_COLOR win", () => {
  const root = materialize("dirty");
  try {
    // default (piped, non-TTY) → plain bytes, so CI / --json / the golden snapshot stay stable
    assert.doesNotMatch(runCli(root).stdout, /\x1b\[/, "piped (non-TTY) is plain by default");
    // --color / FORCE_COLOR force it on even through a pipe (tmux / a multiplexer / an AI shell)
    assert.match(runCli(root, ["--color"]).stdout, /\x1b\[/, "--color forces color through a pipe");
    assert.match(runCli(root, [], { FORCE_COLOR: "1" }).stdout, /\x1b\[/, "FORCE_COLOR=1 forces color");
    // OFF has the highest precedence (safest): --no-color and NO_COLOR beat --color
    assert.doesNotMatch(runCli(root, ["--color", "--no-color"]).stdout, /\x1b\[/, "--no-color wins over --color");
    assert.doesNotMatch(runCli(root, ["--color"], { NO_COLOR: "1" }).stdout, /\x1b\[/, "NO_COLOR wins over --color");
  } finally {
    cleanup(root);
  }
});

test("exit 3: repo with no context files", () => {
  const root = makeRepo({ "src/a.js": "x\n" });
  try {
    const r = runCli(root);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /no context files found/);
  } finally {
    cleanup(root);
  }
});

test("clean fixture: no-cry-wolf — 100, 0 false, ~0 dead tokens, exit 0", () => {
  const root = materialize("clean");
  try {
    const r = runCli(root);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /↳ Honesty\s+[█░]+\s+100\b/);
    assert.match(r.stdout, /Weight {3}~\d[\d,]* tokens load every turn/);
    assert.match(r.stdout, /0 false claims · 0 stale · ~0 tokens describe code that no longer exists/);
    assert.doesNotMatch(r.stdout, /✗/, "no findings invented on a clean repo");
  } finally {
    cleanup(root);
  }
});

test("dirty fixture: the moment — replay-led, top-3, score with denominator", () => {
  const root = materialize("dirty");
  try {
    const r = runCli(root);
    assert.equal(r.code, 0);
    // meters lead the card (Health hero), then the Hotspots replay
    assert.ok(r.stdout.indexOf("Health") < r.stdout.indexOf("✗"), "meters lead, hotspots follow");
    const findings = r.stdout.match(/✗/g) ?? [];
    assert.equal(findings.length, 3, "all three hotspots shown (uncapped)");
    assert.match(r.stdout, /src\/auth\/oauth\.ts/);
    assert.match(r.stdout, /openWakeWord/);
    assert.match(r.stdout, /tiers/);
    assert.match(r.stdout, /deleted at [0-9a-f]{7}/, "lazy git evidence on the dead path");
    assert.match(r.stdout, /↳ Honesty\s+[█░]+\s+\d+\b/, "Honesty meter renders the score");
    assert.match(r.stdout, /↳ Coverage\s+[█░]+\s+88\b/, "Coverage 88 reflects 7 checkable · 1 unchecked");
    assert.match(r.stdout, /Weight {3}~\d[\d,]* tokens load every turn/);
    // oauth.ts existed and was deleted -> stale; openWakeWord + tier count
    // were never true -> false. The breakdown line tells them apart.
    assert.match(r.stdout, /2 false claims · 1 stale · ~\d[\d,]* tokens describe code that no longer exists/);
    // UTF-16 AGENTS.md was skipped with a warning — on stderr, not stdout
    assert.match(r.stderr, /skipped AGENTS\.md: UTF-16/);
    assert.doesNotMatch(r.stdout, /skipped AGENTS/);
  } finally {
    cleanup(root);
  }
});

test("redaction (1A): planted secret never reaches stdout or JSON", () => {
  const root = materialize("dirty");
  try {
    const card = runCli(root);
    assert.doesNotMatch(card.stdout, /sk-test-aaaabbbbccccddddeeee/);
    assert.match(card.stdout, /«redacted/);
    const json = runCli(root, ["--json"]);
    assert.doesNotMatch(json.stdout, /sk-test-aaaabbbbccccddddeeee/);
  } finally {
    cleanup(root);
  }
});

test("write-nothing default (5A): scanned repo is byte-identical after a run", () => {
  const root = materialize("dirty");
  try {
    const before = hashTree(root);
    runCli(root);
    runCli(root, ["--json"]);
    assert.equal(hashTree(root), before);
  } finally {
    cleanup(root);
  }
});

test("stream discipline (8A): --json parses even when warnings fire", () => {
  const root = materialize("dirty"); // UTF-16 AGENTS.md guarantees a warning
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.code, 0);
    assert.ok(r.stderr.length > 0, "warning fired");
    const payload = JSON.parse(r.stdout); // throws = fail
    assert.equal(payload.schema, 0);
    assert.equal(payload.score.definite, 7);
    assert.equal(payload.score.false, 3);
    assert.equal(payload.score.stale, 1, "deleted oauth.ts classifies as stale");
    assert.equal(payload.score.unknown, 1);
    assert.ok(payload.weight.approxTokens > 0, "weight rides the payload");
    assert.ok(payload.meta.warnings.length > 0);
  } finally {
    cleanup(root);
  }
});

test("--out writes claims.json atomically; nothing else", () => {
  const root = materialize("clean");
  const out = mkdtempSync(join(tmpdir(), "df-out-"));
  try {
    const r = runCli(root, ["--out", out]);
    assert.equal(r.code, 0);
    const file = join(out, "claims.json");
    assert.ok(existsSync(file));
    const payload = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(payload.tool, "depthfinder");
    assert.ok(!existsSync(join(out, `.claims.json.tmp-${process.pid}`)), "no tmp residue");
  } finally {
    cleanup(root);
    rmSync(out, { recursive: true, force: true });
  }
});

test("[path] positional: run from elsewhere against the fixture", () => {
  const root = materialize("clean");
  try {
    const r = runCli(tmpdir(), [root]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /↳ Honesty\s+[█░]+\s+100\b/);
  } finally {
    cleanup(root);
  }
});

test("pathological 500KB line: completes fast, line excluded + counted", () => {
  const root = makeRepo({
    "src/a.js": "x\n",
    "CLAUDE.md": "see `src/a.js`\n\n" + "z".repeat(500_000) + "\n",
  });
  try {
    const t0 = Date.now();
    const r = runCli(root, ["--json"]);
    const ms = Date.now() - t0;
    assert.equal(r.code, 0);
    assert.ok(ms < 5000, `scan took ${ms}ms`);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.meta.skippedLines, 1);
  } finally {
    cleanup(root);
  }
});

test("precision gate (9A): zero false accusations on hand-labeled corpus", () => {
  const clean = materialize("clean");
  const dirty = materialize("dirty");
  try {
    const c = JSON.parse(runCli(clean, ["--json"]).stdout);
    assert.equal(c.score.false, 0, "HARD SHIP GATE: clean fixture must produce zero false verdicts");

    const d = JSON.parse(runCli(dirty, ["--json"]).stdout);
    const falseClaims = d.claims.filter((x) => x.verdict === "false");
    const labeled = new Set(["src/auth/oauth.ts", "openWakeWord", "tiers"]);
    for (const f of falseClaims) {
      const key = f.predicate.args.path ?? f.predicate.args.name ?? f.predicate.args.noun;
      assert.ok(labeled.has(key), `unlabeled false accusation: ${JSON.stringify(f.predicate)}`);
    }
    assert.equal(falseClaims.length, 3, "exactly the three planted lies");
  } finally {
    cleanup(clean);
    cleanup(dirty);
  }
});

test("transitive discovery: follows directive links one hop; --no-follow disables", () => {
  const root = makeRepo({
    "CLAUDE.md": [
      "# Proj",
      "",
      "## Project Brain - Read First",
      "",
      "Before changes, read:",
      "",
      "- [brain](docs/brain.md) - the model",
      "- [external](https://example.com/x.md)",
      "",
      "## Notes",
      "",
      "- [changelog](docs/changelog.md)",
      "",
    ].join("\n"),
    // linked doc: a clean present-tense true, a clean genuinely-dead false,
    // and a NARRATIVE line that the modality filter must drop (review fix:
    // linked docs are prose, so they get the docmode filter before scoring).
    "docs/brain.md": [
      "Core logic lives in `src/real.js`.",
      "The auth module is `src/gone.js`.",
      "Legacy support lived in `src/old.js`.",
      "",
    ].join("\n"),
    // linked ONLY from a non-directive section -> must not be scanned
    "docs/changelog.md": "Shipped `src/also-gone.js` last week.\n",
    "src/real.js": "export const real = 1\n",
  });
  try {
    const p = JSON.parse(runCli(root, ["--json"]).stdout);
    const files = new Set(p.claims.map((c) => c.source.file));
    assert.ok(files.has("docs/brain.md"), "directive-linked doc is scanned");
    assert.ok(!files.has("docs/changelog.md"), "non-directive-section link is NOT followed");
    assert.ok(p.linked.some((l) => l.file === "docs/brain.md" && l.from === "CLAUDE.md"));
    assert.ok(!p.linked.some((l) => String(l.file).includes("example.com")), "scheme links never followed");
    const claimPaths = new Set(p.claims.map((c) => c.predicate.args.path));
    // present-tense linked claims fold into the score
    const real = p.claims.find((c) => c.predicate.args.path === "src/real.js");
    const gone = p.claims.find((c) => c.predicate.args.path === "src/gone.js");
    assert.equal(real.verdict, "true");
    assert.equal(gone.verdict, "false");
    assert.equal(gone.source.file, "docs/brain.md", "the dead-path lie is attributed to the linked doc");
    // the narrative line is filtered — a linked brain doc can't false-accuse on prose
    assert.ok(!claimPaths.has("src/old.js"), "narrative 'legacy ... lived in' line filtered from the linked doc");

    const card = runCli(root).stdout;
    assert.match(card, /\(\+1 linked doc\)/);

    const off = JSON.parse(runCli(root, ["--json", "--no-follow"]).stdout);
    assert.ok(!new Set(off.claims.map((c) => c.source.file)).has("docs/brain.md"), "--no-follow disables it");
    assert.equal(off.linked.length, 0);
  } finally {
    cleanup(root);
  }
});

test("doc tier: Doc Honesty scores docs; every FP class is never accused", () => {
  const root = makeRepo({
    "CLAUDE.md": "Entry is `src/index.js`.\n", // convention, clean
    "src/index.js": "export const x = 1\n",
    "src/real.js": "export const r = 1\n",
    "src/helpers.js": "export const h = 1\n",
    "src/router.js": "export const r = 1\n",
    "src/state.js": "export const s = 1\n",
    "src/config.js": "export const c = 1\n",
    "docs/guide.md": [
      "# Guide",
      "",
      "Core logic lives in `src/real.js`.", // TRUE (present-tense)
      "Helpers live in `src/helpers.js`.", // TRUE
      "The router is `src/router.js`.", // TRUE
      "State is in `src/state.js`.", // TRUE
      "Config is `src/config.js`.", // TRUE  -> 5 true
      "Legacy code lived in `src/gone.js`.", // narrative (legacy) -> dropped
      "A gate that writes `out/report.md`.", // generated, no 'to' -> dropped
      "e.g. `src/sample.js`", // example -> dropped
      "Auth is `src/missing.js`.", // present-tense, genuinely dead -> FALSE
      "",
      "```markdown",
      "See `src/fenced.js` in the example below.", // fenced backtick path -> dropped
      "```",
    ].join("\n") + "\n",
    "CHANGELOG.md": "Removed `src/deleted.js`.\n", // skip-listed file -> not scanned
    "docs/notes-sample.md": "See `src/also-missing.js`.\n", // -sample.md -> not scanned
  });
  try {
    // docs are OPT-IN (--docs); the grammar isn't corpus-clean enough to
    // accuse by default. Without the flag the doc tier never runs.
    const p = JSON.parse(runCli(root, ["--json", "--docs"]).stdout);
    assert.equal(p.score.false, 0, "context tier clean");
    // exactly the one genuine present-tense dead reference, nothing else
    const docFalse = p.docClaims.filter((c) => c.verdict === "false").map((c) => c.predicate.args.path);
    assert.deepEqual(docFalse, ["src/missing.js"], "only the real dead ref is false");
    const docPaths = new Set(p.docClaims.map((c) => c.predicate.args.path));
    assert.ok(docPaths.has("src/real.js"), "present-tense ref extracted");
    for (const fp of ["src/gone.js", "out/report.md", "src/sample.js", "src/fenced.js", "src/deleted.js", "src/also-missing.js"])
      assert.ok(!docPaths.has(fp), `FP class not extracted: ${fp}`);
    assert.equal(p.docScore.honesty, 83, "5 true + 1 false over 6 definite");
    assert.match(runCli(root, ["--docs"]).stdout, /Doc Honesty\s+83 · 6 checkable claims · 1 doc · 1 dead ref/);
    assert.ok(p.weight.approxTokens < 60, "docs never inflate Weight (convention-only)");
    // default run (no --docs): doc tier is silent
    const off = JSON.parse(runCli(root, ["--json"]).stdout);
    assert.equal(off.docClaims.length, 0);
    assert.equal(off.docScore, null);
    assert.doesNotMatch(runCli(root).stdout, /Doc Honesty/);
  } finally {
    cleanup(root);
  }
});

test("doc tier: home-center FP shapes produce ZERO false (regression / precision gate)", () => {
  // The exact shapes that made the full-docs sweep cry wolf, hermetic.
  const root = makeRepo({
    "CLAUDE.md": "# t\n",
    "agentci/explainer.js": "export const e = 1\n",
    "docs/agentci_overview.md": "- A minimal gate that writes `agentci/reports/latest.md`\n",
    "docs/diff_and_replay.md": "The latest gate report is written to `agentci/reports/latest.md`.\n",
    "docs/devon-morning-brief-sample.md": "Latest artifact: `design_outputs/daily/2026-04-21-x.md`.\n",
  });
  try {
    const p = JSON.parse(runCli(root, ["--json", "--docs"]).stdout);
    const docFalse = p.docClaims.filter((c) => c.verdict === "false");
    assert.equal(docFalse.length, 0, `zero false accusations on honest narrative docs, got ${JSON.stringify(docFalse.map((c) => c.predicate.args.path))}`);
  } finally {
    cleanup(root);
  }
});

test("--burn (V1.1): shadows a local agent against the top finding; real output on the card", () => {
  const root = materialize("dirty");
  const env = { DEPTHFINDER_BURN_AGENT: `${process.execPath} ${STUB_AGENT}` };
  try {
    const r = runCli(root, ["--burn"], env);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /--burn: running/, "consent contract printed before the call");
    assert.match(r.stdout, /answered \(your context/, "real agent output framed on the card");
    assert.match(r.stdout, /src\/auth\/oauth\.ts/, "agent trusted the rotten line and named the dead path");
    assert.match(r.stdout, /stated as fact/, "the contradiction punchline replaces the template");
    // burn rides the JSON payload
    const p = JSON.parse(runCli(root, ["--json", "--burn"], env).stdout);
    const burned = p.claims.find((c) => c.burn && !c.burn.error);
    assert.ok(burned, "a finding carries a burn result");
    assert.match(burned.burn.output, /oauth\.ts/);
    // the planted secret is NEVER in the burn prompt (1A applies to the input)
    assert.doesNotMatch(burned.burn.prompt, /sk-test-aaaabbbbccccddddeeee/);
    assert.match(burned.burn.prompt, /«redacted/);
  } finally {
    cleanup(root);
  }
});

test("rot tax: the deterministic tax line shows when false>0, absent when clean", () => {
  const dirty = materialize("dirty");
  const clean = materialize("clean");
  try {
    assert.match(runCli(dirty).stdout, /the rot tax: your agent acts on those false lines, or stops trusting the file/);
    assert.doesNotMatch(runCli(clean).stdout, /rot tax/, "no tax line on an honest repo");
  } finally {
    cleanup(dirty);
    cleanup(clean);
  }
});

test("--burn: surfaces the verification-detour tax when the agent catches the lie", () => {
  const root = materialize("dirty");
  const env = { DEPTHFINDER_BURN_AGENT: `${process.execPath} ${STUB_AGENT}`, DEPTHFINDER_STUB_DETOUR: "1" };
  try {
    const r = runCli(root, ["--burn"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /caught the lie — but only after proposing \d+ checks? \(/, "names the detour count");
    assert.match(r.stdout, /grep|find/, "lists the verification steps");
    const p = JSON.parse(runCli(root, ["--json", "--burn"], env).stdout);
    const burned = p.claims.find((c) => c.burn && !c.burn.error);
    assert.ok(burned.burn.detours.length >= 1, "detours recorded on the payload");
  } finally {
    cleanup(root);
  }
});

test("--burn: no agent available degrades cleanly (warn, exit 0, no card change)", () => {
  const root = materialize("dirty");
  try {
    const r = runCli(root, ["--burn"], { DEPTHFINDER_BURN_AGENT: "/nonexistent/agent-xyz" });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /--burn:/);
    assert.doesNotMatch(r.stdout, /answered \(your context/, "no fabricated output when the agent fails");
  } finally {
    cleanup(root);
  }
});

test("score-history (V1.2): delta across runs; no-change; --no-history silent; suppressed skips", () => {
  const files = { "CLAUDE.md": "" };
  const lines = ["# svc", ""];
  for (const n of ["a", "b", "c", "d", "e"]) {
    files[`src/${n}.js`] = `export const ${n} = 1\n`;
    lines.push(`Module ${n} lives in \`src/${n}.js\`.`); // 5 true path claims → honesty 100, definite 5
  }
  files["CLAUDE.md"] = lines.join("\n") + "\n";
  const root = makeRepo(files);
  const cache = mkdtempSync(join(tmpdir(), "df-shared-cache-"));
  const env = { DEPTHFINDER_CACHE: cache };
  try {
    // run 1: records, no prior → no delta line
    assert.doesNotMatch(runCli(root, [], env).stdout, /since last run/, "first run: no delta");
    // run 2: nothing changed → "no change" (100 vs 100)
    assert.match(runCli(root, [], env).stdout, /↳ Honesty\s+[█░]+\s+100\b.*\(no change since last run\)/, "2nd run, same score");
    // mutate: +1 dead ref → 83 (5 true / 1 false); card shows the drop (83 vs 100)
    writeFileSync(join(root, "CLAUDE.md"), files["CLAUDE.md"] + "Auth is `src/gone.js`.\n");
    assert.match(runCli(root, [], env).stdout, /↳ Honesty\s+[█░]+\s+83\b.*\(▼17 since last run\)/, "3rd run shows the drop");
    // mutate again: +1 more dead ref → 71 (5/7); --json carries the numeric delta (71 vs 83)
    writeFileSync(join(root, "CLAUDE.md"), files["CLAUDE.md"] + "Auth is `src/gone.js`.\nConfig in `src/gone2.js`.\n");
    const p = JSON.parse(runCli(root, ["--json"], env).stdout);
    assert.equal(p.delta, -12, "numeric delta on the payload (71 − 83)");
    // --no-history: a fresh cache, no record, no delta
    const off = runCli(root, ["--no-history"], { DEPTHFINDER_CACHE: mkdtempSync(join(tmpdir(), "df-c2-")) });
    assert.doesNotMatch(off.stdout, /since last run/, "--no-history writes nothing, shows no delta");
    // suppressed score (<5 definite) never deltas
    const tiny = makeRepo({ "CLAUDE.md": "Entry `src/x.js`.\n", "src/x.js": "x\n" });
    try {
      assert.doesNotMatch(runCli(tiny, [], { DEPTHFINDER_CACHE: cache }).stdout, /since last run/, "suppressed: no delta");
    } finally {
      cleanup(tiny);
    }
  } finally {
    cleanup(root);
    rmSync(cache, { recursive: true, force: true });
  }
});

test("score-history: deltas are scoped to the branch (no cross-branch fake trend)", () => {
  const files = { "CLAUDE.md": "" };
  const lines = ["# svc", ""];
  for (const n of ["a", "b", "c", "d", "e"]) {
    files[`src/${n}.js`] = `export const ${n} = 1\n`;
    lines.push(`Module ${n} lives in \`src/${n}.js\`.`);
  }
  files["CLAUDE.md"] = lines.join("\n") + "\n";
  const root = makeRepo(files);
  const cache = mkdtempSync(join(tmpdir(), "df-branch-cache-"));
  const env = { DEPTHFINDER_CACHE: cache };
  try {
    runCli(root, [], env); // run on main → records honesty 100 @ main
    spawnSync("git", ["-C", root, "checkout", "-q", "-b", "feature"]);
    // first run on the new branch: nothing comparable yet → no delta
    assert.doesNotMatch(runCli(root, [], env).stdout, /since last run/, "no cross-branch delta on a fresh branch");
    // second run on the branch → comparable to the branch's own prior
    assert.match(runCli(root, [], env).stdout, /no change since last run/, "within-branch trend works");
  } finally {
    cleanup(root);
    rmSync(cache, { recursive: true, force: true });
  }
});

test("score-history: a cache path resolving inside the scanned repo is refused (5A guard)", () => {
  const root = materialize("dirty"); // false claims present → history block runs
  try {
    const before = hashTree(root);
    // a RELATIVE override resolves against the subprocess cwd (= the repo root)
    const r = runCli(root, [], { DEPTHFINDER_CACHE: "." });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /cache path resolves inside the scanned repo/);
    assert.equal(hashTree(root), before, "nothing was written into the scanned repo");
    assert.doesNotMatch(r.stdout, /since last run/, "no delta when history is skipped");
  } finally {
    cleanup(root);
  }
});

test("large --json payloads (>64KB) are not truncated by exit (pipe flush)", () => {
  // 200 true path claims -> payload well past the 64KB pipe buffer.
  const files = { "CLAUDE.md": "" };
  const lines = ["# big"];
  for (let i = 0; i < 200; i++) {
    files[`src/mod${i}.js`] = `export const m${i} = ${i}\n`;
    lines.push(`Module ${i} lives in \`src/mod${i}.js\`.`);
  }
  files["CLAUDE.md"] = lines.join("\n\n") + "\n";
  const root = makeRepo(files);
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.length > 64 * 1024, `payload only ${r.stdout.length} bytes — fixture too small`);
    const payload = JSON.parse(r.stdout); // truncation = parse failure
    assert.equal(payload.score.definite, 200);
  } finally {
    cleanup(root);
  }
});

// ── --strict CI gate (Phase A) ──────────────────────────────────────────────
test("--strict: clean passes (exit 0), dirty fails with the DISTINCT exit 20 (off Node's reserved range)", () => {
  const clean = materialize("clean");
  const dirty = materialize("dirty");
  try {
    const c = runCli(clean, ["--strict"]);
    assert.equal(c.code, 0, "clean repo passes the gate");
    assert.match(c.stderr, /strict: PASS/);

    const d = runCli(dirty, ["--strict"]);
    assert.equal(d.code, 20, "dirty repo fails with exit 20 — outside Node's reserved 1-13");
    assert.match(d.stderr, /strict: FAIL/);
    assert.match(d.stderr, /exit 20/);
  } finally {
    cleanup(clean); cleanup(dirty);
  }
});

test("--strict --max-false: boundary is > not >= (==N passes, N-1 fails); gates on TOTAL falseCount", () => {
  // Rot WITHOUT any skipped file, so within-budget genuinely PASSES (the dirty
  // fixture's UTF-16 AGENTS.md would otherwise trip the fail-closed path).
  const lines = ["# t", ""];
  for (let i = 0; i < 6; i++) lines.push(`Item ${i} is \`src/gone${i}.js\`.`); // 6 dead paths
  const root = makeRepo({ "CLAUDE.md": lines.join("\n") + "\n", "src/real.js": "export const x = 1\n" });
  try {
    const n = JSON.parse(runCli(root, ["--json"]).stdout).score.false;
    assert.ok(n >= 5, `expected several false claims, got ${n}`);
    assert.equal(runCli(root, ["--strict", "--max-false", String(n)]).code, 0, `budget ${n} == false ${n} → pass`);
    assert.equal(runCli(root, ["--strict", "--max-false", String(n - 1)]).code, 20, `budget ${n - 1} < false ${n} → fail`);
    assert.equal(runCli(root, ["--strict", "--max-false", "0"]).code, 20, "explicit --max-false 0 fails on rot");
  } finally {
    cleanup(root);
  }
});

test("--max-false: invalid values are a usage error (exit 2) BEFORE any repo work", () => {
  const clean = materialize("clean");
  try {
    for (const bad of ["abc", "1.5", "1e3", "Infinity", "NaN", "", " ", "0x4"]) {
      const r = runCli(clean, ["--strict", "--max-false", bad]);
      assert.equal(r.code, 2, `--max-false "${bad}" → exit 2`);
      assert.match(r.stderr, /max-false must be a non-negative integer/);
    }
    // negative (via = form so parseArgs keeps it as the value) is rejected, never silently 0
    assert.equal(runCli(clean, ["--strict", "--max-false=-1"]).code, 2, "--max-false=-1 → exit 2");
    // [F2, cross-model] a huge digit string passes /^\d+$/ but parseInt-overflows
    // to Infinity (or just exceeds 2^53) → `false > Infinity` is always false →
    // the gate would SILENTLY fail-open. Must be rejected (exit 2), never disable.
    const huge = runCli(clean, ["--strict", "--max-false", "1".padEnd(400, "0")]);
    assert.equal(huge.code, 2, "astronomically large --max-false → exit 2 (no silent fail-open)");
    assert.match(huge.stderr, /too large|disable the gate/);
    assert.equal(runCli(clean, ["--strict", "--max-false", "9007199254740993"]).code, 2, "> MAX_SAFE_INTEGER → exit 2");
  } finally {
    cleanup(clean);
  }
});

test("--strict + a >64KB FAILING payload: exits 20 without truncating the --json (process.exitCode, not exit())", () => {
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(`Module ${i} lives in \`src/gone${i}.js\`.`); // 200 dead paths
  const root = makeRepo({ "CLAUDE.md": lines.join("\n\n") + "\n", "src/real.js": "export const x = 1\n" });
  try {
    const r = runCli(root, ["--strict", "--json"]);
    assert.equal(r.code, 20, "gate fails on the large rotten payload");
    assert.ok(r.stdout.length > 64 * 1024, `payload only ${r.stdout.length} bytes — fixture too small`);
    const p = JSON.parse(r.stdout); // truncation = parse failure; the gate must NOT process.exit() mid-write
    assert.equal(p.gate.failed, true);
    assert.ok(p.score.false >= 200, "all 200 dead paths gated");
  } finally {
    cleanup(root);
  }
});

test("--strict --json: gate object + failed flag; stdout stays valid JSON; exit 20 (orthogonal to format)", () => {
  const dirty = materialize("dirty");
  try {
    const r = runCli(dirty, ["--strict", "--json"]);
    assert.equal(r.code, 20, "exit code is independent of --json");
    const p = JSON.parse(r.stdout); // verdict went to stderr → stdout is still valid JSON
    // dirty has rot AND a skipped UTF-16 AGENTS.md (unverifiedFiles: 1); both → failed
    assert.equal(p.gate.strict, true);
    assert.equal(p.gate.maxFalse, 0);
    assert.equal(p.gate.false, p.score.false);
    assert.equal(p.gate.tier, "context");
    assert.equal(p.gate.unverifiedFiles, 1);
    assert.equal(p.gate.degraded, false);
    assert.equal(p.gate.failed, true);
    // additive soft-gate fields (no --warn-below on this run)
    assert.equal(p.gate.warnBelow, null);
    assert.deepEqual(p.gate.breached, []);
    assert.ok(p.gate.dimensions === null || typeof p.gate.dimensions.health === "number");
    // a non-strict run has gate: null (additive, no inference forced on consumers)
    assert.equal(JSON.parse(runCli(dirty, ["--json"]).stdout).gate, null);
  } finally {
    cleanup(dirty);
  }
});

test("--strict does NOT alter stdout: the card is byte-identical to a non-strict run (verdict is stderr-only)", () => {
  const dirty = materialize("dirty");
  try {
    const plain = runCli(dirty, []);
    const strict = runCli(dirty, ["--strict"]);
    assert.equal(strict.stdout, plain.stdout, "rendered card unchanged by --strict (golden stays stable)");
    assert.equal(plain.code, 0, "a non-strict run is advisory: exit 0 even with false claims");
    assert.equal(strict.code, 20);
  } finally {
    cleanup(dirty);
  }
});

test("--strict gates the CONTEXT tier only: a doc-tier dead ref never fails the build (D2)", () => {
  const root = makeRepo({
    "CLAUDE.md": "# proj\n\nEntry point is `src/index.js`.\n",
    "src/index.js": "export const x = 1\n",
    "docs/runbook.md": "# runbook\n\nThe worker entry point is `src/worker/main.js`.\n",
  });
  try {
    const p = JSON.parse(runCli(root, ["--json", "--docs"]).stdout);
    assert.equal(p.score.false, 0, "context tier is clean");
    assert.ok(p.docScore && p.docScore.false > 0, "doc tier has a dead ref to gate-test against");
    const r = runCli(root, ["--strict", "--docs"]);
    assert.equal(r.code, 0, "doc-tier rot does NOT fail the gate — Context-only (D2)");
    assert.match(r.stderr, /Doc Honesty is advisory and was not gated/);
  } finally {
    cleanup(root);
  }
});

test("--strict gates on falseCount even when the score is SUPPRESSED (definite<5, honesty null)", () => {
  // One false path claim, far under MIN_DEFINITE_FOR_SCORE → honesty is null,
  // but the gate keys off falseCount, so it still fails. This is why D1 chose a
  // count budget over --min-honesty (which would be undefined here).
  const root = makeRepo({ "CLAUDE.md": "# t\n\nSee `src/gone.js` for details.\n", "src/real.js": "x\n" });
  try {
    const p = JSON.parse(runCli(root, ["--json"]).stdout);
    assert.equal(p.score.honesty, null, "score is suppressed (definite < 5)");
    assert.ok(p.score.false >= 1, "but there is a false claim");
    assert.equal(runCli(root, ["--strict"]).code, 20, "gate fails on the count despite the null score");
  } finally {
    cleanup(root);
  }
});

test("--strict --out: an --out write failure (exit 2) outranks the gate breach (exit 20)", () => {
  const dirty = materialize("dirty"); // would fail the gate (exit 20) on its own
  try {
    // --out into a path under a regular file → ENOTDIR on write → exit 2 wins
    const badOut = join(materializeFile(), "claims-dir");
    const r = runCli(dirty, ["--strict", "--out", badOut]);
    assert.equal(r.code, 2, "the requested --out artifact wasn't produced → exit 2, not the gate's 20");
    assert.match(r.stderr, /could not write --out/);
  } finally {
    cleanup(dirty);
  }
});

test("--strict fails CLOSED on oracle DEGRADATION: a fatal git check-ignore can't mask rot (F1)", { skip: process.platform === "win32" ? "POSIX git-shim" : false }, () => {
  // Clean-looking repo with one dead path. A `git` shim forces check-ignore to
  // fail (status 128) → the path oracle is blinded (the would-be-false path is
  // downgraded to unknown). The gate must NOT pass — it fails closed.
  const dir = makeRepo({ "CLAUDE.md": "# t\n\nEntry is `src/gone.js`.\n", "src/real.js": "export const x = 1\n" });
  const shimDir = mkdtempSync(join(tmpdir(), "df-gitshim-"));
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(shimDir, "git"), `#!/bin/sh\nif [ "$1" = "check-ignore" ]; then exit 128; fi\nexec ${realGit} "$@"\n`);
  spawnSync("chmod", ["+x", join(shimDir, "git")]);
  const withShim = { PATH: `${shimDir}:${process.env.PATH}` };
  try {
    // baseline (no shim): the dead path is a normal false → exit 20 (rot)
    assert.equal(runCli(dir, ["--strict"]).code, 20, "baseline: the dead path gates as rot");
    // with the shim: check-ignore fatal → the false is masked to unknown, but the
    // run is flagged degraded and the gate fails CLOSED rather than green-lighting.
    const p = JSON.parse(runCli(dir, ["--strict", "--json"], withShim).stdout);
    assert.equal(p.score.false, 0, "rot was masked to unknown by the blinded oracle");
    assert.equal(p.gate.degraded, true, "the run is flagged degraded (check-ignore blinded)");
    assert.equal(p.gate.failed, true, "gate fails closed despite 0 false");
    const r = runCli(dir, ["--strict"], withShim);
    assert.equal(r.code, 20, "exit 20: degradation can't green-light the build");
    assert.match(r.stderr, /COULD NOT VERIFY|check-ignore/i);
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
    cleanup(dir);
  }
});

test("--strict with no context files: exit 3 (unchanged) — 'nothing to check' is not a gate fail", () => {
  const root = makeRepo({ "src/a.js": "x\n" });
  try {
    assert.equal(runCli(root, ["--strict"]).code, 3, "no-context exit 3 is not conflated with the gate's 20");
  } finally {
    cleanup(root);
  }
});

test("--strict fails CLOSED when a context file is skipped/unread (F1): could-not-verify, not a false PASS", () => {
  // Clean CLAUDE.md (no rot) PLUS an AGENTS.md that can't be read (UTF-16 BOM) →
  // the gate can't certify the unread file, so it must FAIL (exit 20), not PASS.
  const dir = mkdtempSync(join(tmpdir(), "df-skip-"));
  const env = {
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  };
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { env: { ...process.env, ...env } });
  try {
    g("init", "-q", "-b", "main");
    writeFileSync(join(dir, "CLAUDE.md"), "# t\n\nEntry point is `index.js`.\n"); // clean: index.js exists
    writeFileSync(join(dir, "index.js"), "export const x = 1\n");
    // UTF-16LE AGENTS.md with BOM → readContextFile skips it (unread context file)
    writeFileSync(join(dir, "AGENTS.md"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# a\nSee `index.js`.\n", "utf16le")]));
    g("add", "-A"); g("commit", "-q", "-m", "i");
    const p = JSON.parse(runCli(dir, ["--strict", "--json"]).stdout);
    assert.equal(p.score.false, 0, "the readable context tier has no rot");
    assert.equal(p.gate.unverifiedFiles, 1, "one context file was skipped/unread");
    assert.equal(p.gate.failed, true, "gate.failed is true despite 0 false — fail-closed");
    const r = runCli(dir, ["--strict"]);
    assert.equal(r.code, 20, "a skipped context file → fail-closed (exit 20), not a false PASS");
    assert.match(r.stderr, /COULD NOT VERIFY|skipped/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── --fix safe-fix (rename-only) ────────────────────────────────────────────
// A two-commit repo: a file at src/old-auth.js, then renamed to src/new-auth.js
// with CLAUDE.md referencing the OLD path.
function makeRenameRepo(claimLine = "Auth lives in `src/old-auth.js`.") {
  const dir = mkdtempSync(join(tmpdir(), "df-rename-"));
  const E = {
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  };
  const g = (args, date) => spawnSync("git", ["-C", dir, ...args], { env: { ...process.env, ...E, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  g(["init", "-q", "-b", "main"], "2026-01-01T00:00:00Z");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "old-auth.js"), "export const auth = () => true;\n// distinctive content for rename detection\n");
  g(["add", "-A"], "2026-01-01T00:00:00Z"); g(["commit", "-q", "-m", "init"], "2026-01-01T00:00:00Z");
  g(["mv", "src/old-auth.js", "src/new-auth.js"], "2026-01-02T00:00:00Z");
  writeFileSync(join(dir, "CLAUDE.md"), `# t\n\n${claimLine}\n`);
  g(["add", "-A"], "2026-01-02T00:00:00Z"); g(["commit", "-q", "-m", "rename"], "2026-01-02T00:00:00Z");
  return dir;
}

test("--fix: dry-run previews + writes nothing; --write applies + closes the found→fixed loop", () => {
  const dir = makeRenameRepo();
  try {
    assert.ok(JSON.parse(runCli(dir, ["--json"]).stdout).score.false >= 1, "baseline: the old path is a false claim");
    const before = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    // dry run: preview names the rename, file UNCHANGED (5A holds without --write)
    const dry = runCli(dir, ["--fix"]);
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /src\/old-auth\.js/);
    assert.match(dry.stdout, /src\/new-auth\.js/);
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), before, "dry-run writes nothing");
    // --fix --json shape
    const j = JSON.parse(runCli(dir, ["--fix", "--json"]).stdout);
    assert.equal(j.mode, "fix");
    assert.deepEqual(j.fixes.map((f) => [f.oldPath, f.newPath]), [["src/old-auth.js", "src/new-auth.js"]]);
    // --write applies, then the loop is closed
    const w = runCli(dir, ["--fix", "--write"]);
    assert.equal(w.code, 0);
    assert.match(w.stderr, /repointed 1 renamed path/);
    const after = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    assert.match(after, /src\/new-auth\.js/);
    assert.doesNotMatch(after, /src\/old-auth\.js/);
    assert.equal(JSON.parse(runCli(dir, ["--json"]).stdout).score.false, 0, "found→fixed: re-scan is clean");
  } finally {
    cleanup(dir);
  }
});

test("--fix: rename-ONLY — declines deletions/fabrications (no safe target); --write no-ops", () => {
  const dir = makeRepo({ "CLAUDE.md": "# t\n\nSee `src/never-existed.js`.\n", "src/real.js": "x\n" });
  try {
    const r = runCli(dir, ["--fix"]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /nothing to fix|RENAMED/i);
    const before = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    runCli(dir, ["--fix", "--write"]);
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), before, "--write changes nothing when no fix is provable");
  } finally {
    cleanup(dir);
  }
});

// helper: a path that is a FILE, so writing a dir under it fails with ENOTDIR
function materializeFile() {
  const dir = mkdtempSync(join(tmpdir(), "df-outfail-"));
  const f = join(dir, "afile");
  writeFileSync(f, "x");
  return f;
}
