// Per-oracle extraction grammar tables — the precision posture's first line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPathClaims } from "../src/cli/extract/path.mjs";
import { extractDependencyClaims } from "../src/cli/extract/dependency.mjs";
import { extractSymbolClaims } from "../src/cli/extract/symbol.mjs";
import { extractCountClaims } from "../src/cli/extract/count.mjs";
import { directiveLinks } from "../src/cli/follow.mjs";
import { resolveRelPosix } from "../src/cli/paths.mjs";

const L = (text, n = 1) => ({ n, text, long: false });
const ctx = { dirExists: (seg) => ["src", "router", "docs", ".cursor", "lib"].includes(seg) };

test("path oracle: extraction table", () => {
  const cases = [
    // [line, expected paths]
    ["see `src/auth/oauth.ts` for auth", ["src/auth/oauth.ts"]],
    ["see [auth](src/auth/oauth.ts)", ["src/auth/oauth.ts"]],
    ["config in `router/config.js` and `src/index.js`", ["router/config.js", "src/index.js"]],
    ["extensionless `src/cli` module dir", ["src/cli"]],
    // exclusions
    ["visit `https://docs.example.com/guide/setup.html`", []],
    ["see [docs](https://example.com/a.html)", []],
    ["host-like `docs.example.com/guide.html`", []],
    ["bare prose path src/auth/oauth.ts is undelimited", []],
    ["first segment not a repo dir: `vendor/x/y.js`", []],
    ["single segment `README.md` is not a path claim", []],
    // real-corpus FP class (home-center June-6 scan): ./-prefixed and
    // parent-relative candidates never match the git index verbatim.
    ["Build output goes to `./dist`.", []],
    ["entry point is `./src/index.js`", ["src/index.js"]], // ./ stripped, claim kept
    ["compare against `../sibling/file.js`", []],
  ];
  for (const [text, expected] of cases) {
    const got = extractPathClaims("CLAUDE.md", [L(text)], ctx).map((c) => c.predicate.args.path);
    assert.deepEqual(got, expected, `line: ${text}`);
  }
});

test("path oracle: confidence tiers", () => {
  const [withExt] = extractPathClaims("CLAUDE.md", [L("`src/a/b.js`")], ctx);
  assert.equal(withExt.extraction.confidence, "high");
  const [noExt] = extractPathClaims("CLAUDE.md", [L("`src/cli`")], ctx);
  assert.equal(noExt.extraction.confidence, "med");
  const [link] = extractPathClaims("CLAUDE.md", [L("[x](src/a/b.js)")], ctx);
  assert.equal(link.extraction.confidence, "med");
});

test("dependency oracle: extraction table (the self-scan FP class)", () => {
  const cases = [
    ["wake word handled by `openWakeWord`", ["openWakeWord"]], // delimited+phrase: any case
    ["depends on `@scope/pkg`", ["@scope/pkg"]],
    ["uses `node-fetch` for http", ["node-fetch"]],
    ["the `@picovoice/porcupine` engine", ["@picovoice/porcupine"]], // backtick alone: scoped ok
    // the false-accusation class — must extract NOTHING:
    ["repo (built for `home-center`) uses its context surfaces", []],
    ["`--lan` opts into LAN exposure", []],
    ["uses its own format", []],
    ["powered by magic", []], // undelimited plain word: ignored
    ["see `claims.json` for output", []], // file-ext name
    ["run `npm` to install", []], // stoplist
    // real-corpus FP class (home-center June-6 scan): env-var config knobs
    ["speech mode uses `SPEECH_CANDIDATE_COOLDOWN_SECONDS`, not the wake cooldown", []],
    ["uses `MAX_RETRIES` for backoff", []],
    // real-corpus FP class (home-center brain docs): dotted code expressions.
    // socket.io-style dotted packages are a deliberate miss, never a claim.
    ["all time math uses `context.now` so the function is testable", []],
    ["chat uses `socket.io` for transport", []],
  ];
  for (const [text, expected] of cases) {
    const got = extractDependencyClaims("CLAUDE.md", [L(text)]).map((c) => c.predicate.args.name);
    assert.deepEqual(got, expected, `line: ${text}`);
  }
});

test("symbol oracle: extraction table", () => {
  const withFile = extractSymbolClaims("CLAUDE.md", [L("`src/engine.js` exports `startEngine`")]);
  assert.equal(withFile.length, 1);
  assert.deepEqual(withFile[0].predicate.args, { symbol: "startEngine", file: "src/engine.js" });
  assert.equal(withFile[0].extraction.confidence, "high");

  const callIn = extractSymbolClaims("CLAUDE.md", [L("call `boot()` in `src/index.js` first")]);
  assert.equal(callIn.length, 1);
  assert.deepEqual(callIn[0].predicate.args, { symbol: "boot", file: "src/index.js" });

  const repoWide = extractSymbolClaims("CLAUDE.md", [L("the module exports `helper`")]);
  assert.equal(repoWide.length, 1);
  assert.equal(repoWide[0].predicate.args.file, null);
  assert.equal(repoWide[0].extraction.confidence, "med");

  assert.equal(extractSymbolClaims("CLAUDE.md", [L("it exports `not an ident!`")]).length, 0);
});

test("count oracle: anchored only", () => {
  const anchored = extractCountClaims("CLAUDE.md", [L("uses 4 tiers (see `router/config.js`)")]);
  assert.equal(anchored.length, 1);
  assert.deepEqual(anchored[0].predicate.args, { n: 4, noun: "tiers", anchor: "router/config.js" });

  assert.equal(extractCountClaims("CLAUDE.md", [L("uses 4 tiers everywhere")]).length, 0, "unanchored ignored");
  assert.equal(extractCountClaims("CLAUDE.md", [L("4 bananas (see `router/config.js`)")]).length, 0, "unknown noun");
});

test("long lines are excluded from extraction (ReDoS guard)", () => {
  const long = { n: 1, text: "`src/a.js` " + "x".repeat(2000), long: true };
  assert.equal(extractPathClaims("CLAUDE.md", [long], ctx).length, 0);
  assert.equal(extractDependencyClaims("CLAUDE.md", [long]).length, 0);
});

test("directiveLinks: .md links under a directive heading only", () => {
  const lines = [
    L("# Title", 1),
    L("## Project Brain - Read First", 2),
    L("- [a](docs/a.md) - state model", 3),
    L("- [ext](https://example.com/b.md)", 4), // scheme: excluded
    L("- [anchored](docs/c.md#section)", 5), // anchor stripped -> docs/c.md
    L("- [code](src/x.js)", 6), // not .md: excluded
    L("## Notes", 7), // non-directive: scope closes
    L("- [d](docs/d.md)", 8),
  ].map((x, i) => ({ ...x, n: i + 1 }));
  assert.deepEqual(directiveLinks(lines).map((x) => x.target), ["docs/a.md", "docs/c.md"]);

  // a directive heading with no in-repo .md links yields nothing
  assert.equal(directiveLinks([L("## Context", 1), L("plain prose, no links", 2)]).length, 0);
  // long line skipped (ReDoS parity)
  assert.equal(directiveLinks([L("## Read", 1), { n: 2, text: "[a](docs/a.md)", long: true }]).length, 0);
});

test("resolveRelPosix: relative resolution, ../ and root-escape", () => {
  assert.equal(resolveRelPosix("CLAUDE.md", "docs/a.md"), "docs/a.md");
  assert.equal(resolveRelPosix("CLAUDE.md", "./docs/a.md"), "docs/a.md");
  assert.equal(resolveRelPosix("school-updates/CLAUDE.md", "docs/a.md"), "school-updates/docs/a.md");
  assert.equal(resolveRelPosix("school-updates/CLAUDE.md", "../docs/a.md"), "docs/a.md");
  assert.equal(resolveRelPosix("CLAUDE.md", "../escape.md"), null, "escaping the root is null, never index-matched");
});
