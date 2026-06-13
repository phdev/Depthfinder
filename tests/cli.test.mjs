// End-to-end CLI behavior: exit codes, write-nothing default, stream
// discipline, redaction, precision gate, --out atomicity, [path] arg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materialize, makeRepo, runCli, hashTree, cleanup } from "./helpers/fixture.mjs";

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
