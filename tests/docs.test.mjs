// Doc-tier audit — fence detection (ingest), modality filter (docmode),
// doc discovery (discover). The precision layer that lets Depthfinder scan
// general repo docs without false-accusing honest prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readContextFile } from "../src/cli/ingest.mjs";
import { isNarrativeLine, keepDocClaims } from "../src/cli/docmode.mjs";
import { discoverDocs } from "../src/cli/discover.mjs";
import { makeRepo, cleanup } from "./helpers/fixture.mjs";

const L = (text, extra = {}) => ({ n: 1, text, long: false, inFence: false, ...extra });

test("docmode: narrative/example/generated/fenced drop; present-tense survives", () => {
  // DROP — these are not present-tense assertions about current repo state
  assert.ok(isNarrativeLine(L("we removed `src/old.ts` last week")), "narrative: removed");
  assert.ok(isNarrativeLine(L("legacy code lived in `src/old.ts`")), "narrative: legacy");
  assert.ok(isNarrativeLine(L("e.g. see `src/example.ts`")), "example: e.g.");
  assert.ok(isNarrativeLine(L("a gate that writes `agentci/reports/latest.md`")), "generated, NO 'to' (the home-center FP)");
  assert.ok(isNarrativeLine(L("the report is written to `out/r.md`")), "generated: written to");
  assert.ok(isNarrativeLine(L("artifacts available at `dist/bundle.md`")), "generated phrase: available at");
  assert.ok(isNarrativeLine(L("see `src/x.ts`", { inFence: true })), "fenced code");
  // SURVIVE — real present-tense location claims we WANT to verify
  assert.ok(!isNarrativeLine(L("auth lives in `src/auth.ts`")), "present-tense: lives in");
  assert.ok(!isNarrativeLine(L("config is `src/config.ts`")), "present-tense: is");
  assert.ok(!isNarrativeLine(L("if the repo was cloned, run `scripts/setup.sh`")), "'was' is NOT a trigger (absorb #9)");
});

test("keepDocClaims: drops claims whose source line is narrative", () => {
  const lines = new Map([
    [1, L("auth lives in `src/auth.ts`")],
    [2, { ...L("we removed `src/old.ts`"), n: 2 }],
  ]);
  const claims = [
    { source: { line: 1 }, predicate: { args: { path: "src/auth.ts" } } },
    { source: { line: 2 }, predicate: { args: { path: "src/old.ts" } } },
  ];
  const kept = keepDocClaims(claims, lines);
  assert.deepEqual(kept.map((c) => c.predicate.args.path), ["src/auth.ts"]);
});

test("ingest: fenced code blocks flag line.inFence (``` and ~~~, unclosed-at-EOF)", () => {
  const root = makeRepo({
    "CLAUDE.md": "# t\n",
    "doc.md": ["before", "```bash", "node x.js", "```", "after", "~~~", "still fenced"].join("\n") + "\n",
  });
  try {
    const r = readContextFile(root, "doc.md");
    assert.deepEqual(
      r.lines.slice(0, 7).map((l) => l.inFence),
      [false, true, true, true, false, true, true],
      "fence delimiters + content fenced; text between not; unclosed tail stays fenced",
    );
  } finally {
    cleanup(root);
  }
});

test("discoverDocs: excludes convention/linked + skip-list, keeps plain docs", () => {
  const index = new Set([
    "CLAUDE.md", "docs/CLAUDE.md", "README.md", "docs/guide.md",
    "CHANGELOG.md", "docs/api-sample.md", "examples/demo.md", "src/x.js",
  ]);
  const exclude = new Set(["CLAUDE.md", "docs/CLAUDE.md", "docs/guide.md"]); // convention + 1 linked
  assert.deepEqual(
    discoverDocs("/root", index, exclude),
    ["README.md"],
    "CHANGELOG/-sample/examples skipped; .js ignored; convention+linked excluded",
  );
});
