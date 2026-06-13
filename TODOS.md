# TODOS

## Docs audit / Doc Honesty — corpus gate (core SHIPPED 2026-06-13)

Core landed (eng-reviewed): second advisory **Doc Honesty** score over all tracked
`.md` beyond the Context set, path-oracle-only + `src/cli/docmode.mjs` modality
filter (fenced/narrative/example/generated-sink/imperative-spec drop), monorepo-
relative resolution (all tiers), filename skip-list, 200-doc cap. **OPT-IN via
`--docs`** (default OFF as of the corpus-gate run). home-center: Doc Honesty 100 ·
142 · 55 docs, zero false. 46 tests + `scripts/doc-corpus.mjs` gate.

**Flip Doc Honesty back to DEFAULT-ON once the corpus gate is zero-false:**
- `npm run corpus:docs` currently surfaces ~18 FPs across 7 public repos (spec-dir
  delete-lists with no per-line cue, config-location tables, "files like X", local/
  uncommitted config paths). These are the bar. Each needs either a deterministic
  filter rule that doesn't over-drop, or acceptance that the doc grammar stays opt-in.
- Hardest residual: spec-dir bullet lists (the cue is the doc's PURPOSE, not the
  line) — may need a doc-purpose heuristic or a `specs/` convention, both fragile.
  Candidate: treat a doc as "spec/plan" if its title/heading carries remove/migrate/
  refactor intent and downgrade its path claims to unknown.
- The corpus gate is now ADVISORY (docs opt-in), not a publish blocker.

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
