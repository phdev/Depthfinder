// Score-history store (V1.2): identity, cache path, append/readLast, the
// comparability filter, and the degrade-never-throw write posture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoIdentity, cacheFile, readLast, append } from "../src/cli/history.mjs";
import { makeRepo, cleanup } from "./helpers/fixture.mjs";

const CMP = { scoringSchema: 1, follow: true, docs: false };

test("repoIdentity: origin normalized + stable across URL forms; no remote → path", () => {
  const root = makeRepo({ "CLAUDE.md": "# t\n", "a.js": "x\n" });
  try {
    assert.match(repoIdentity(root).raw, /^path:/, "no remote → toplevel-path fallback");
    spawnSync("git", ["-C", root, "remote", "add", "origin", "https://u:p@GitHub.com/Owner/Repo.git"]);
    assert.equal(repoIdentity(root).raw, "origin:github.com/Owner/Repo", "scheme/creds/.git stripped, host lowercased");
    spawnSync("git", ["-C", root, "remote", "set-url", "origin", "git@github.com:Owner/Repo.git"]);
    assert.equal(repoIdentity(root).raw, "origin:github.com/Owner/Repo", "SCP form normalizes identically (one identity)");
    assert.equal(repoIdentity(root).key.length, 16);
  } finally {
    cleanup(root);
  }
});

test("cacheFile: DEPTHFINDER_CACHE > XDG_CACHE_HOME; always under depthfinder/", () => {
  assert.equal(cacheFile("abc", { DEPTHFINDER_CACHE: "/tmp/x" }), join("/tmp/x", "depthfinder", "abc.jsonl"));
  assert.equal(cacheFile("abc", { XDG_CACHE_HOME: "/c", DEPTHFINDER_CACHE: "" }), join("/c", "depthfinder", "abc.jsonl"));
});

test("append + readLast: round-trip, comparability filter, corrupt lines skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "df-hist-"));
  const file = join(dir, "k.jsonl");
  try {
    assert.equal(readLast(file, CMP), null, "missing file → null (first run)");
    append(file, { schema: 0, ...CMP, honesty: 90, definite: 10 });
    append(file, { schema: 0, ...CMP, honesty: 80, definite: 10 });
    // a run under different flags (follow:false) must NOT count as comparable
    append(file, { schema: 0, scoringSchema: 1, follow: false, docs: false, honesty: 50, definite: 10 });
    assert.equal(readLast(file, CMP).honesty, 80, "last COMPARABLE record; the --no-follow record is skipped");
    writeFileSync(file, readFileSync(file, "utf8") + "not json\n");
    assert.equal(readLast(file, CMP).honesty, 80, "corrupt trailing line tolerated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("append: unwritable path → false, never throws (scan must still exit 0)", () => {
  const dir = mkdtempSync(join(tmpdir(), "df-hist-"));
  const notADir = join(dir, "afile");
  writeFileSync(notADir, "x");
  try {
    assert.equal(append(join(notADir, "k.jsonl"), { honesty: 1 }), false, "mkdir under a file → ENOTDIR, swallowed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
