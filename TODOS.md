# TODOS

## V1.5: Scan-history store (user cache dir)

**What:** Per-repo scan history under the user's cache dir
(`~/.cache/depthfinder/<repo-hash>/`), recording each run's claims + score.

**Why:** The V1.0 default run deliberately writes NOTHING to the scanned repo
(eng-review D6/5A — read-only posture, demo-clean). That deferred the
baseline V1.5's score deltas need ("Honesty 64 → 71 since last run").

**Pros:** Prebuilds the V1.5 delta baseline; keeps scanned repos pristine;
cheap (one JSON per run).

**Cons:** Hidden per-user state to document and version; repo-identity
hashing has edge cases (moved repos, multiple remotes).

**Context:** Deltas are already designed (design doc, V1.5). The store must
live OUTSIDE scanned repos per the 5A posture. Open design bits: XDG vs
win32 cache path handling, retention policy, repo identity key (toplevel
path vs origin URL hash). See eng review 2026-06-12, decision D19.

**Depends on / blocked by:** Nothing until V1.5; intentionally blocked until
the Stage-1/Stage-2 validation gates pass (kill criterion could moot it).
