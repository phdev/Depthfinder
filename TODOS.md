# TODOS

## V1.x: Transitive context discovery (follow "Read First" pointers)

**What:** When a convention file (CLAUDE.md etc.) links other in-repo docs
with read-this semantics ("Read First", "project brain", markdown links in
an opening section), scan those targets too — one hop, link-targets only,
capped.

**Why:** Corpus-proven gap (home-center, 2026-06-12): its post-cleanup
CLAUDE.md is a 99-line contract whose first section points agents at five
`docs/*` brain docs. Convention-only discovery scored the repo 100 · 37
claims while the de-facto agent context (brain docs) held 75 more claims —
and the full `docs/` tree held 3 genuinely dangling references that never
surfaced. The thing Depthfinder audits is "what the agent reads", and
pointer-style CLAUDE.md files are how big repos structure exactly that.

**Cons / open design:** Where to stop (one hop? markdown links only? a
heading heuristic?); claim attribution and render labels for non-convention
files; cap + dedupe to protect the 5s budget; users may consider linked
docs "documentation, not context" — maybe `--follow-links` opt-in first.

**Depends on:** Nothing technical (extract/evaluate already take arbitrary
file lists — the corpus measurement used them directly). Sequencing: after
Stage-1; candidate for V1.1 or V1.5.

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
