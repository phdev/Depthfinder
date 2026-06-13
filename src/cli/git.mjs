// Git mechanics (eng review: 4A wrapper, lazy history, shallow degradation).
//
// One spawn for enumeration (ls-files -> Set); deep history evidence
// (log --follow) is computed lazily for the rendered top-3 only — never for
// the full claim set — protecting the sub-5s budget.
import { spawnSync } from "node:child_process";

export class GitMissingError extends Error {
  constructor() {
    super("git not found on PATH — Depthfinder needs git for evidence (install git, or run inside a git repo on a machine with git)");
    this.exitCode = 2;
  }
}
export class NotARepoError extends Error {
  constructor(dir) {
    super(`not a git repository: ${dir} — Depthfinder needs a git repo for evidence (run inside a repo or \`git init\`)`);
    this.exitCode = 2;
  }
}

function run(args, cwd, input) {
  const res = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error && res.error.code === "ENOENT") throw new GitMissingError();
  if (res.error) throw res.error;
  return res;
}

// Resolve the repo root from a starting directory; throws NotARepoError.
export function findRoot(startDir) {
  const res = run(["rev-parse", "--show-toplevel"], startDir);
  if (res.status !== 0) throw new NotARepoError(startDir);
  return res.stdout.trim();
}

// Tracked files as a Set of posix-relative paths (gitignore semantics free).
export function lsFiles(root) {
  const res = run(["ls-files", "-z"], root);
  if (res.status !== 0) throw new NotARepoError(root);
  const out = new Set();
  for (const p of res.stdout.split("\0")) if (p) out.add(p);
  return out;
}

// Which of these paths does gitignore deliberately exclude? One batch spawn
// for all index-and-disk misses (status 0 = some matched, 1 = none). Returns
// null when git can't answer (fatal status) — callers must treat null as
// undecidable, never as "not ignored": a glitch must not become an accusation.
export function checkIgnored(root, paths) {
  const res = run(["check-ignore", "--stdin", "-z"], root, paths.join("\0"));
  if (res.status !== 0 && res.status !== 1) return null;
  return new Set(res.stdout.split("\0").filter(Boolean));
}

export function isShallow(root) {
  const res = run(["rev-parse", "--is-shallow-repository"], root);
  return res.status === 0 && res.stdout.trim() === "true";
}

// Current branch (or "HEAD" when detached, "" if git can't say). Used to scope
// score-history deltas to a branch — a cross-branch "since last run" isn't a
// real trend.
export function currentBranch(root) {
  const res = run(["rev-parse", "--abbrev-ref", "HEAD"], root);
  return res.status === 0 ? res.stdout.trim() : "";
}

// Lazy, per-rendered-claim history evidence for a deleted/renamed path.
// Returns { kind: "deleted"|"renamed"|"unknown-history", sha?, commitsAgo?, to? }.
export function deletionEvidence(root, relPath, shallow) {
  // Rename trace: last status entry mentioning the path with R status.
  const follow = run(
    ["log", "--follow", "--diff-filter=DR", "--name-status", "--format=%h", "--", relPath],
    root,
  );
  if (follow.status === 0 && follow.stdout.trim()) {
    const lines = follow.stdout.split("\n").filter(Boolean);
    // Output alternates: <sha> then one or more status lines.
    let sha = null;
    for (const line of lines) {
      if (/^[0-9a-f]{7,40}$/.test(line.trim())) {
        sha = line.trim();
        continue;
      }
      const m = line.match(/^R\d*\t([^\t]+)\t([^\t]+)$/);
      if (m && m[1] === relPath) return { kind: "renamed", sha, to: m[2] };
      if (/^D\t/.test(line)) {
        const count = run(["rev-list", "--count", `${sha}..HEAD`], root);
        const commitsAgo =
          count.status === 0 ? parseInt(count.stdout.trim(), 10) + 1 : null;
        return { kind: "deleted", sha, commitsAgo };
      }
    }
  }
  if (shallow) return { kind: "unknown-history" }; // absorb #2: degrade gracefully
  return { kind: "unknown-history" };
}
