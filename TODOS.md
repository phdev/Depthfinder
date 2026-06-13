# TODOS

## Docs audit / Doc Honesty — corpus gate (core SHIPPED 2026-06-13)

Core landed (eng-reviewed): second advisory **Doc Honesty** score over all tracked
`.md` beyond the Context set, path-oracle-only + `src/cli/docmode.mjs` modality
filter (fenced/narrative/example/generated-sink drop), monorepo-relative resolution,
filename skip-list, 200-doc cap, `--no-docs`. home-center: Doc Honesty 100 · 143
claims · 55 docs, zero false. 46 tests.

**Remaining before npm publish (P1, blocks the tag — Tension 1 ship gate):**
- `scripts/doc-corpus.mjs` — clone/scan ~8–10 diverse public repos with CLAUDE/docs,
  print every false verdict for hand-verification. Default-on doc accusations are
  only validated against home-center (one corpus, self-authored); a first-run FP on
  a stranger's repo is the fatal error. If a real FP survives, harden the filter (add
  the cue) or fall back to `--docs` opt-in until clean. This is the publish gate.

**Deferred doc-tier refinements (post-validation):**
- Span-level modality (multiple paths on one line with different modality) — today's
  filter is conservative line-level (drops the whole line; safe miss).
- "lived in"/bare past-tense location without another cue — corpus gate will surface
  if it's a real FP source; add to the narrative lexicon then.
- Doc findings as replay cards (today doc dead-refs are a count on the Doc Honesty
  line, not ✗ cards — keeps the attribution moment Context-focused).

## Transitive discovery — refinements (core SHIPPED 2026-06-13)

Core landed in `src/cli/follow.mjs` (one hop, directive-heading-gated,
tracked-`.md` only, cap 25, folds into honesty, excluded from Weight,
`--no-follow` to disable). home-center: 37 → 112 claims, still 100 · 0 false.
Residual sharp edges, deferred:

- **Lead-in detection without a heading.** Some files write "Before
  changes, read:" then a bare list with no directive *heading*. Current
  gating is heading-only, so those are missed. Add: a link is eligible if
  the nearest preceding non-empty prose line carries a reading cue.
- **Non-directive subheading closes the scope.** "## Read First" followed
  by "### Caveats" ends the directive scope at the subheading even though
  it's nested under Read First. Track heading level to keep scope open
  until a same-or-higher-level non-directive heading.
- **Multi-hop / config-pointer discovery.** Only convention-file links are
  followed; a brain doc that points at further docs stops at one hop (by
  design, for now). Revisit if corpus shows deep pointer chains.

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
