# TODOS

## ✅ V1.0 PUBLISHED to npm — 2026-06-13 (latest = 1.0.1; OIDC CI confirmed)

`depthfinder` is LIVE — `npx depthfinder` works; npmjs.com/package/depthfinder,
**latest 1.0.1**, deps:none, 25 files/96.9kB.
- **1.0.0** — first publish. The tag-triggered CI publish failed 4× with `EOTP` (the npm
  account's 2FA-for-writes demands an OTP CI can't supply; the granular token didn't bypass
  it, and classic Automation tokens weren't offered in the UI). Shipped via a **manual local
  publish** (`npm login` web flow → `npm publish --access public` → browser 2FA). No
  provenance badge (manual).
- **1.0.1** — first **OIDC trusted-publishing** auto-publish (adds homepage/bugs links).
  Verified via OIDC: `_npmUser` = `GitHub Actions <npm-oidc-no-reply@github.com>`,
  `trustedPublisher.id = github`, **provenance attestation present.**

**The OIDC pipeline is proven end-to-end.** publish.yml: no token (`id-token: write` +
trusted publisher), node 24 + `npm i -g npm@latest` (OIDC needs npm ≥11.5.1; runner had
11.17.0), `--provenance --access public`, plus a harmless `node/npm --version` echo.

**⚠️ HARD-WON GOTCHA:** OIDC publish failed `E404` **six** times after the trusted publisher
was added — provenance signed each time (OIDC available) but the publish PUT 404'd. Root
cause: the Trusted Publisher **Repository field was lowercase `depthfinder`, but GitHub's
OIDC `repository` claim is the canonical case `phdev/Depthfinder`, and npm matches it
CASE-SENSITIVELY** → OIDC identity rejected → fell back to setup-node's placeholder token
→ 404. **Fix: set Repository to exactly `Depthfinder` (capital D), name-only.** Ruled out
first (all fine): npm version, workflow correctness, publishing-access setting, allowed
actions. Lesson: npm Trusted Publisher org/repo must EXACTLY match GitHub's case; a
mismatch 404s in a way that looks like a permissions/2FA problem.

**Future releases:** bump version + `git tag vX.Y.Z && git push` → auto-publish with
provenance, no token, no manual step. Optional cleanup: delete the now-unused `NPM_TOKEN`
secret (`gh secret delete NPM_TOKEN --repo phdev/Depthfinder`).

## Roadmap — re-sequenced 2026-06-13 around durable value (acquisition vs retention)

Field-validating `--burn` on 6 real rotten repos showed frontier agents often
*catch* stale lines (and pay a verification tax) rather than crash. So the durable
value is the **rot tax** (paid by every agent, every call), not the crash demo.
ACQUISITION (burn, benchmark) = make pain felt, commoditizable, spend only enough.
RETENTION (tax-visible, tracked score, gate, memory) = where durable effort goes.
Full thesis: design doc "Durable Value & Commoditization" + premise P7.

Build priority:
1. **[RETENTION, next, cheap] Make the tax visible.** Card line: "~N tokens
   actively mislead; your agent re-verifies the whole file once it catches one."
   When `--burn` shows the agent proposing find/grep, count the detour steps.
2. **[RETENTION] Score-history store — PULLED FORWARD from V1.5 to V1.2** (below).
   The score as a TRACKED team metric ("honesty 95→78") is the first thing a
   harness can't emit. It's also the benchmark baseline.
3. **[ACQUISITION] Benchmark / `--share` card** — seed corpus already exists
   (`scripts/doc-corpus.mjs`). Percentile only after a population exists.
4. **[RETENTION] The gate** — `--strict` CI (exit 1 when false>0), then the
   blocking V2 gate. First workflow guarantee a model can't give.
5. **[RETENTION] Cross-agent memory loop (V2)** — capture→freshness→recall. The moat.

Reconsider: **safe-fix (rename-only diff)** — tabled earlier, but the durable
value is *keeping context honest*, and the fix is the action that closes
found→fixed. Stronger candidate now (close the loop); still rename-class only.

## V1.1 Live Burn (`--burn`) — SHIPPED 2026-06-13

`src/cli/burn.mjs`: shadows a local agent (claude/codex, override via
DEPTHFINDER_BURN_AGENT/--burn-agent) against the #1 false claim in an empty
temp cwd, renders the real reply + contradiction. Opt-in, consent contract on
stderr, prompt redacted (1A on input), hermetic stub-agent tests. Only path
that calls a model (invariant #4). 48 tests, golden unchanged.

**Remaining V1.1 polish (non-blocking):**
- **Burn redaction is best-effort (review finding, P3).** `buildBurnPrompt`
  redacts known secret shapes via `lib/redact.mjs`, but an exotic secret
  (e.g. `DATABASE_URL=postgres://user:pass@host/db`) on the top-finding line
  would reach the local agent under `--burn`. Mitigations to weigh: broaden
  redact patterns (connection strings, high-entropy `KEY=value`) without
  over-redacting; or surface the line in the consent notice so the user sees
  exactly what's sent. Bounded risk (opt-in, goes to the user's own agent).
- Burn only the #1 finding today (model calls are slow). Optional `--burn-all`
  / `--burn N` to burn more, with a per-call timeout budget.
- Question templates are one-per-oracle and generic; could tailor by claim
  topic (extract the subject from the surrounding paragraph) for sharper Qs.
- A real-agent E2E (behind an opt-in env, never in CI) to sanity-check that
  claude/codex print modes actually produce the expected "names the dead
  path" behavior — today only the stub is exercised.
- Validate `--burn-agent` parsing for commands with quoted/spaced args
  (current split is whitespace-only; fine for `claude -p` / `codex exec`).

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

## Score-history store — SHIPPED 2026-06-13 (V1.2, eng-reviewed)

`src/cli/history.mjs`: per-repo run history in the user cache dir (origin-else-
toplevel sha1 key, O_APPEND JSONL, XDG-respecting), delta on the card
("Context Honesty 95 ▼17 since last run"). Write-by-default, `--no-history` opt
out, failed write never breaks the scan, deltas only vs the last COMPARABLE run
(scoringSchema + follow/docs). Test cache isolated in runCli → golden byte-
stable. 58 tests. 5A reworded (out-of-repo cache write is the only new side effect).

## V1.2.5 Benchmark / `--share` / Worker — DEFERRED (own eng-review)

Split out of V1.2 on cross-model agreement (Step 0 + Codex): a benchmark shipped
without these HURTS an honesty tool's trust posture. Design deliberately:
- Privacy: call it aggregate/pseudonymous, NOT "anonymous" (Cloudflare logs
  IP/UA/ts/body); document logging/retention; submit only a score tuple
  {honesty, definite, tier, schema}; drop the nonce unless it earns an anti-abuse role.
- Egress consent: `--share` PRINTS the literal payload + y/N to STDERR (stdout
  stays card|JSON); `--share --yes` for non-TTY/CI; `DEPTHFINDER_SHARE_ENDPOINT`.
- Storage: aggregate histogram in a DURABLE OBJECT (KV has no atomic increment).
- Abuse: rate-limit/dedupe, minimum-N "benchmark warming up" state, schema-versioned distributions.
- Percentile wording: "at least as high as X% of shared runs" (not "better than", ties).
- Seeding: an actual task — seed-corpus generation/upload/reset/migration + min-N release gate.
- Worker in its OWN package (isolates miniflare/wrangler dev deps; CLI stays zero-dep) + wrangler deploy.
Design doc: ~/.gstack/projects/phdev-Depthfinder/peterhowell-main-design-v1.2-score-history-benchmark-20260613-091103.md (NOT-in-scope section).

## OKF (Google Open Knowledge Format) — WATCH + defensive probe (assessed 2026-06-13)

Evaluated OKF v0.1 draft (knowledge-catalog SPEC.md). **Decision: HOLD — don't
build OKF support.** It's a tailwind for the thesis (markdown agents trust as
ground truth, that rots) but a misfit for the engine: an OKF concept's ground
truth is an **external live system** (a BigQuery table, an API), not the git
tree — verifying it needs network + per-resource adapters + non-determinism,
which breaks invariant #4 and the offline contract. OKF's one git-checkable
surface (internal cross-links) is **spec-declared safe-when-broken** ("Consumers
MUST tolerate broken links… may simply represent not-yet-written knowledge"), so
applying the path oracle there is a guaranteed false accusation (violates
unknown-never-false). The valuable version (concept-vs-live-resource drift) is a
different product.

**The one actionable item — defensive, do before any publish that defaults
`--docs` ON:** a `--docs` scan of a repo CONTAINING an OKF bundle will likely
FALSE-ACCUSE on cross-links. Bundle-relative `/tables/x.md` resolves from the
*bundle* root, but our path oracle resolves `/`-rooted paths from the *repo*
root → target "missing" → false verdict. Action: add an OKF-bundle fixture to
`scripts/doc-corpus.mjs` and confirm zero false; teach the doc-tier skip-list /
modality filter to recognize a bundle (an `index.md`+`log.md` pair, or `.md`
files carrying OKF `type:` frontmatter) and treat its links as spec-tolerant
(downgrade to unknown, never false). ~an afternoon; pure ship-gate protection.

**Tripwire to re-evaluate building:** if OKF bundles start describing the
**codebase** (concepts whose `resource:`/body reference in-repo file paths or
code symbols) rather than external data assets, the path/symbol oracles light up
and there's a real, invariant-respecting OKF play. Until then it's a data
catalog — out of our git-grounded domain. Full reasoning: memory
`depthfinder-okf-assessment`.

## (reference) Original score-history notes

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
