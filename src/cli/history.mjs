// Score-history store (V1.2) — Depthfinder's first persistent user-state.
//
// Records each run's score under the USER CACHE DIR (never the scanned repo,
// so 5A holds) so the card can show a "since last run" delta. Writes by
// default; `--no-history` opts out; a failed cache write NEVER breaks the scan.
//
// Append-only JSONL via O_APPEND (`appendFileSync` is atomic for a sub-PIPE_BUF
// line) so two overlapping runs can't lose a record — pruning is separate and
// race-tolerant. Deltas compare ONLY against the last COMPARABLE record (same
// scoring schema + score-affecting flags); a --no-follow score is not a trend
// against a default-follow score.
//
// fs module, deliberately separate from the pure helpers (lib/text.mjs) and
// never imported by lib/. Every error path degrades to "no history" + a warn.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const MAX_RECORDS = 50; // keep the last N runs
const PRUNE_AT = 200; // only rewrite (rare) when the file grows well past N

// Stable repo identity: normalized origin URL when a remote exists (survives
// clones + moves — the common case for a real project), else the git toplevel
// path (local-only repos still get history). sha1 → a filesystem-safe key;
// `raw` is stored in each record so a future version can migrate.
export function repoIdentity(root) {
  const res = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const raw = res.status === 0 && res.stdout.trim()
    ? `origin:${normalizeOrigin(res.stdout.trim())}`
    : `path:${root}`;
  return { raw, key: createHash("sha1").update(raw).digest("hex").slice(0, 16) };
}

// github.com/owner/repo from https://user:pass@github.com/owner/repo.git or
// git@github.com:owner/repo.git — strip scheme, creds, .git, trailing slash;
// SCP colon → slash; lowercase the host only.
function normalizeOrigin(url) {
  let u = url.trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "") // scheme://
    .replace(/^[^@/]+@/, "")                  // user[:pass]@
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .replace(":", "/");                        // git@host:path SCP form
  const slash = u.indexOf("/");
  if (slash > 0) u = u.slice(0, slash).toLowerCase() + u.slice(slash);
  return u;
}

// The history file for a repo key. Honors DEPTHFINDER_CACHE (also the test
// isolation hook) > XDG_CACHE_HOME > per-OS default. Always under a
// `depthfinder/` subdir so we never litter the cache root.
export function cacheFile(key, env = process.env) {
  const base =
    env.DEPTHFINDER_CACHE ||
    env.XDG_CACHE_HOME ||
    (process.platform === "win32" && env.LOCALAPPDATA) ||
    (process.platform === "darwin" ? join(homedir(), "Library", "Caches") : join(homedir(), ".cache"));
  return join(base, "depthfinder", `${key}.jsonl`);
}

// A run is comparable to a prior one only if the scoring logic and the
// score-affecting flags match. toolVersion is recorded for display/migration
// but is NOT part of comparability (a version bump that changes scoring must
// bump scoringSchema instead).
function comparable(rec, cmp) {
  return !!rec
    && rec.scoringSchema === cmp.scoringSchema
    && rec.follow === cmp.follow
    && rec.docs === cmp.docs;
}

// Last comparable record, or null. Corrupt/mismatched lines are skipped; any
// read error → null (treated as "first run"), never throws.
export function readLast(file, cmp) {
  let lines;
  try {
    lines = readFileSync(file, "utf8").split("\n");
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (comparable(rec, cmp)) return rec;
  }
  return null;
}

// Append one record (O_APPEND, atomic). Returns true on success, false on any
// error (caller warns; the scan still exits 0). Prunes only when the file
// grows past PRUNE_AT — rare, so the read-rewrite race window is tiny and a
// lost prune merely leaves a few extra lines.
export function append(file, record) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(record) + "\n");
    maybePrune(file);
    return true;
  } catch {
    return false;
  }
}

function maybePrune(file) {
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    if (lines.length <= PRUNE_AT) return;
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, lines.slice(-MAX_RECORDS).join("\n") + "\n");
    renameSync(tmp, file);
  } catch {
    /* best-effort; a lost prune just leaves extra lines */
  }
}
