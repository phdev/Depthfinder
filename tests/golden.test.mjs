// Golden card (eng review 10A): the terminal render IS the product contract.
// Byte-compare the full card against the checked-in golden. Deterministic
// because fixture commits use pinned author/committer/date (stable SHAs)
// and the render pins en-US number formatting.
//
// Intentional render changes: npm run snapshot:update, review the diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { materialize, runCli, cleanup } from "./helpers/fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "golden", "dirty-card.txt");

test("golden card: dirty-fixture render is byte-identical to the approved card", () => {
  const root = materialize("dirty");
  try {
    const r = runCli(root);
    assert.equal(r.code, 0);
    const golden = readFileSync(GOLDEN, "utf8");
    assert.equal(r.stdout, golden, "render drifted — if intentional: npm run snapshot:update");
  } finally {
    cleanup(root);
  }
});

// Dashboard regression smoke (iron rule, eng review T2): the tokchars move
// must not break the dashboard generators. Run them against the clean
// fixture via REPO_ROOT (no dependence on this machine's .repo-root pin).
test("dashboard regression: generateMap + generateCurrents still run", async () => {
  const root = materialize("clean");
  try {
    process.env.REPO_ROOT = root;
    const { generateMap } = await import("../scripts/context-map.mjs?t=" + Date.now());
    const map = generateMap();
    assert.ok(map.summary.nodeCount >= 0);
    const { generateCurrents } = await import("../scripts/token-budget.mjs?t=" + Date.now());
    const currents = generateCurrents();
    assert.ok(typeof currents.metrics.totalTokens === "number");
  } finally {
    delete process.env.REPO_ROOT;
    cleanup(root);
  }
});

// Live-repo guarantee: the Summary must regenerate every dimension from the live
// repo each load, never an on-disk cache that can go silently stale. A 9-day-old
// token cache once reported CLAUDE.md at 8× its real size (Weight 100→23,
// Health 83→60). Lock the fix so a future edit can't reintroduce the cache read.
test("dashboard: summary regenerates tokens LIVE + refresh persists (no stale cache)", () => {
  const sum = readFileSync(join(HERE, "..", "scripts", "summary.mjs"), "utf8");
  assert.match(sum, /generateTokens/, "summary must regenerate tokens live via generateTokens()");
  assert.doesNotMatch(sum, /\breadTokens\b/, "summary must NOT read the token cache — it goes silently stale");
  const srv = readFileSync(join(HERE, "..", "server.mjs"), "utf8");
  const refresh = srv.slice(srv.indexOf("/api/refresh/tokens"), srv.indexOf("/api/refresh/tokens") + 260);
  assert.match(refresh, /writeTokens/, "the refresh-tokens endpoint must persist via writeTokens");
  assert.doesNotMatch(refresh, /generateCurrents/, "refresh must not call generateCurrents (returns without writing → no-op)");
});
