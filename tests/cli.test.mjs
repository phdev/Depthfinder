// End-to-end CLI behavior: exit codes, write-nothing default, stream
// discipline, redaction, precision gate, --out atomicity, [path] arg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    assert.match(r.stdout, /Context Honesty {3}100 · \d+ checkable claims/);
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
    // replay-led: first ✗ appears before the score line
    assert.ok(r.stdout.indexOf("✗") < r.stdout.indexOf("Context Honesty"));
    const findings = r.stdout.match(/✗/g) ?? [];
    assert.equal(findings.length, 3, "findings cap at three");
    assert.match(r.stdout, /src\/auth\/oauth\.ts/);
    assert.match(r.stdout, /openWakeWord/);
    assert.match(r.stdout, /tiers/);
    assert.match(r.stdout, /deleted at [0-9a-f]{7}/, "lazy git evidence on the dead path");
    assert.match(r.stdout, /Context Honesty {3}\d+ · 7 checkable claims · 1 unchecked/);
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
    assert.match(r.stdout, /Context Honesty {3}100/);
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
