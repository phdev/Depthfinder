# CLAUDE.md — Depthfinder

## What this is

Depthfinder is two things in one repo:

1. **The product — `npx depthfinder` (V1.0 Replay CLI):** a zero-config,
   deterministic scanner that extracts checkable claims from AI context
   files (CLAUDE.md, AGENTS.md, .cursorrules, .cursor/rules/**.mdc, nested
   CLAUDE/AGENTS.md), verifies them against the repo, and renders an
   agent-failure replay card for the top-3 false claims. Published to npm;
   tarball = `bin/` + `src/cli/` + `lib/text.mjs` + `lib/redact.mjs` only.
2. **The dashboard (in-repo tooling, unpublished):** a local-only web
   visualizer for one repo's context surfaces.

Zero runtime dependencies everywhere (Node ≥20 built-ins; the dashboard's
graph view loads Cytoscape from a CDN in the browser).

## CLI architecture (V1.0)

```
cwd ─▶ git root ─▶ ls-files Set ─▶ discover (5 conventions)        ┐ Context tier
   ─▶ follow "read first" links ONE HOP into tracked repo docs     │ (4 oracles, auto-
   ─▶ ingest (7A: BOM/size/EACCES skip+warn, 1k cap, fence flag)   │  loaded every turn)
   ─▶ extract (4 oracles, conservative grammars)                   ┘
   ─▶ discoverDocs (all other tracked .md − skip-list)  ┐ Doc tier (path oracle
   ─▶ path oracle ─▶ docmode modality filter            ┘ ONLY, on-demand reads)
   ─▶ evaluate (unknown-never-false; doc claims resolve monorepo-relative too)
   ─▶ top-3 ─▶ lazy git evidence + stale classification (capped)
   ─▶ score×2 (Context + Doc Honesty, each +<5 suppression) ─▶ render
```

**Transitive discovery** (`src/cli/follow.mjs`): a convention file that
says "read the project brain docs first" and links them is instructing the
agent to load that surface, so those docs are context too. One hop only
(no cycles, bounded fan-out); inline markdown links to *tracked* `.md`
files under a directive heading (`read`/`brain`/`context`/…); capped at 25
with a stderr note. Linked-doc claims fold into the honesty score, but do
**not** count toward Weight (they don't load every turn). `--no-follow`
disables it. Corpus proof: home-center's CLAUDE.md is a thin pointer to
five `docs/*` brain docs — convention-only scanning saw 37 claims; with
follow, 112 (all true).

**Doc tier / Doc Honesty** (`src/cli/docmode.mjs`, `discoverDocs`): the wider
repo docs (runbooks, design notes, package READMEs) the agent reads on demand
also rot, so they get a SECOND, separate **Doc Honesty** score. Scanning them
naively false-accuses honest prose (proven: all 3 home-center doc "findings"
were FPs — generated-artifact paths + a `*-sample.md` example), so the doc tier
is precision-hardened: **path oracle only** (dependency/count/symbol are prose-FP
drivers), plus a modality filter that drops claims on lines that are fenced code
(`line.inFence`, detected in ingest, applied doc-only so Context Honesty is
byte-stable), narrative (`removed`/`legacy`/`used to`…), example (`e.g.`/`sample`),
or generated-artifact sinks (`writes`/`written to`/`available at`…). Doc paths also
resolve relative to their own dir (monorepo READMEs). Discovery = all tracked `.md`
minus the Context set minus a skip-list (`CHANGELOG*`/`*-sample.md`/`examples/`…),
capped at 200 (sorted, surfaced). Doc claims are advisory, **excluded from Weight**,
and never touch the contract breakdown. **OPT-IN via `--docs`** (default OFF): the
`scripts/doc-corpus.mjs` gate still surfaces repo-idiosyncratic FPs (spec-dir delete
lists, config-location tables) across public repos, so the doc grammar isn't yet
clean enough to accuse by default. Flip to default-on once the corpus gate runs zero-
false. Context-tier FPs the corpus already fixed: nested-monorepo path resolution
(applies to ALL tiers now) and PascalCase-type-as-dependency rejection.

Card anatomy below the findings: the `Context Honesty` score line (`N ·
M checkable claims · K unchecked`); the `Doc Honesty` line (`N · M checkable
claims · K docs · J dead refs`, or `— · K docs · too few checkable claims` when
suppressed; omitted when no docs); the **Weight** line (~chars/4 of the Context
files — what loads into the agent every turn); and the contract breakdown line
`N false claims · M stale · ~T tokens describe code that no longer exists`
(Context-tier only). **Stale** = a false path claim whose target verifiably
existed in git history (deleted/renamed — the doc rotted); **false** = no such
history (fabricated or never true). Both count against honesty identically; the
split is evidence, not forgiveness.

- `bin/depthfinder.mjs` — orchestration, parseArgs, exit codes (0 ran /
  1 internal / 2 usage·no-git / 3 no context files), stream discipline
  (stdout = card|JSON only; diagnostics → stderr), redaction at both
  output seams via `lib/redact.mjs`.
- `src/cli/extract/{path,dependency,symbol,count}.mjs` — grammars are
  deliberately conservative; the dependency grammar's guards exist because
  the self-scan false-accused `its`/`home-center`/`--lan` on day one, and
  the first real-corpus runs (home-center June-6 snapshot + brain docs)
  added `./`-prefix normalization (path), SCREAMING_SNAKE env-var rejection
  and dotted code-expression rejection — `context.now`, non-@ names with
  dots — at the deliberate cost of missing socket.io-style packages
  (dependency).
- `src/cli/evaluate.mjs` — monorepo-aware deps (nearest+workspaces, 4
  fields), ESM/TS symbol forms with unknown escapes (`export *`, default
  expressions, CJS), literal-cardinality counts with uncertainty escapes,
  and gitignored-but-absent paths → unknown (logs/local config/build output
  are machine-local state, not doc lies; batch `git check-ignore`). Doc-tier
  path claims (`tier:"doc"`) also resolve relative to their own file's dir
  (monorepo READMEs); `false` only when NEITHER repo-root nor doc-relative exists.
- `src/cli/docmode.mjs` — pure (no fs) modality filter for the doc tier:
  `isNarrativeLine`/`keepDocClaims` drop doc claims on fenced/narrative/example/
  generated-sink lines. Conservative line-level drop (a safe miss, never an FP).
- `src/cli/burn.mjs` (V1.1, `--burn`) — Live Burn: shadow a local agent CLI
  (`claude`, else `codex`; override `DEPTHFINDER_BURN_AGENT`/`--burn-agent`)
  against the #1 false claim, in an EMPTY temp cwd so the agent answers from
  the rotten line, and render its real reply in place of the template. The
  ONLY path that calls a model: opt-in, prints a consent contract first, and
  **redacts the prompt** (1A on the input, not just output). Hermetic tests
  inject `tests/helpers/stub-agent.mjs` via the env override.
- `src/cli/templates.mjs` — the ONLY inferential sentence per finding;
  templates are data with an exact-match test (cut-rule in header).
- Default run **writes nothing** to the scanned repo; `--out` is the sole
  write path (atomic tmp+rename).

## CLI invariants (do not break)

1. **Unknown-never-false.** A false accusation is fatal to an honesty
   tool. Ship gate: zero false verdicts on clean-fixture and zero
   unlabeled false verdicts on dirty-fixture — enforced per-push in CI.
   The doc tier extends this: zero false on the home-center FP shapes
   (regression test) and, before any publish tag, zero false across the
   multi-repo doc corpus (`scripts/doc-corpus.mjs`).
2. **The golden card is the contract.** `tests/golden/dirty-card.txt`
   byte-locks the render; intentional changes go through
   `npm run snapshot:update` and review of the diff.
3. **The CLI module graph never imports `lib/repo.mjs`** (import-time path
   resolution) — enforced by the boundary test.
4. **No model calls except `--burn`.** The default path is fully
   deterministic and offline. `--burn` is the single, consent-gated
   exception: it calls a local agent, sends ONE redacted line, prints the
   contract first, and never writes to the repo (runs in a temp cwd).
5. **Pre-tag ritual:** `npm run corpus` against real external repos +
   hand-verification of every false verdict, before any release tag.

## Tests / bench

`npm test` — 48 tests (node:test; hermetic git fixtures with pinned
dates → deterministic SHAs; `--burn` tested via a stub agent, never a real
model call). `npm run bench` — per-phase timings + local
5s tripwire (never in CI). CI: 3 OS × node 20/22; publish on `v*` tags
(needs `NPM_TOKEN` secret).

Five tabs, each with a hash route for deep-linking:

| Tab | Hash | Backend |
|---|---|---|
| Summary (Project Health triage) | `#summary` | `scripts/summary.mjs` |
| Context (typed graph, 12 node / 7 edge types) | `#context` | `scripts/context-map.mjs` |
| Tokens (Token Currents: sources → destinations) | `#tokens` | `scripts/token-budget.mjs` |
| Evals (rule × test × in-CI matrix + live AgentCI gate) | `#evals` | `scripts/coverage.mjs` |
| Drift (Packmind context-evaluator, cached/opt-in) | `#drift` | `scripts/drift-refresh.mjs` |

## Architecture

- `server.mjs` — built-in `http` server. Binds **127.0.0.1 only** by default;
  `LAN=1` / `--lan` / `HOST=` opts into LAN exposure. Endpoints:
  `GET /api/{summary,map,tokens,coverage,drift}`,
  `POST /api/refresh/{map,tokens,coverage,drift}`, `POST /api/run/gate`.
- `scripts/*.mjs` — one generator per panel; each writes its cache under
  `.cache/` (gitignored) and never writes to the analyzed repo.
- `lib/repo.mjs` — REPO_ROOT resolution (`$REPO_ROOT` env > `.repo-root` file >
  `../../`), path-traversal-safe reads. `.repo-root` is machine-specific and
  gitignored; see `.repo-root.example`.
- `lib/redact.mjs` — secret/token/key patterns are redacted from every API
  payload before it reaches the browser.
- `public/` — vanilla JS single page (`index.html`, `app.js`, `styles.css`).
  Monochrome design system (near-black bg, translucent panels, grayscale).
  Hash-based routing: tab clicks push history entries; back/forward work;
  unknown hashes normalize to `#summary`.

## Invariants (do not break)

1. **Read-only against the analyzed repo.** The only writes are this repo,
   its `.cache/`, and `context/rules.yaml` (the authored rules config). The
   AgentCI gate run redirects its report + golden snapshots into `.cache/`.
2. **Loopback by default.** Never bind beyond 127.0.0.1 unless explicitly
   opted in. No auth by design — remote access goes through a Cloudflare
   Tunnel, never auth code in this repo.
3. **Memory privacy.** `memory/household/*` contents are never rendered —
   only `populated` boolean + item counts.
4. **Off-machine is opt-in only.** The only feature that sends analyzed-repo
   contents off-machine is the manual `npm run drift:refresh`.
5. **No machine-specific values in git.** Tunnel URLs, LAN IPs, and absolute
   local paths stay out of committed files (`.repo-root` is gitignored).
6. **Bind data, don't fake it.** Panel numbers come from live analyzer
   output; anything unverifiable shows a "Not verified" state.

## Run

```bash
npm start                 # http://127.0.0.1:4317 (loopback only)
LAN=1 npm start           # + LAN exposure (trusted WiFi only)
npm run drift:refresh     # manual Packmind run (sends repo contents to an AI agent)
```

Point it at a repo once: `cp .repo-root.example .repo-root` and edit, or set
`REPO_ROOT=...`.

## Local ops (this machine, not in git)

Two launchd agents keep it running across reboots/sleep:
`dev.depthfinder.server` and `dev.depthfinder.tunnel`
(`~/Library/LaunchAgents/dev.depthfinder.*.plist`, logs in
`~/Library/Logs/Depthfinder/`). The tunnel is a Cloudflare **quick** tunnel —
the public URL is random and rotates when cloudflared restarts or Cloudflare
recycles it. Get the current URL with `~/bin/df-url`; if it's dead, kick it:
`launchctl kickstart -k gui/$(id -u)/dev.depthfinder.tunnel` (truncate
`tunnel.log` first so `df-url` doesn't read a stale URL).

## Workflow

- Commit and push to `main` (`phdev/Depthfinder`) after each change.
- Update this CLAUDE.md when behavior, endpoints, or invariants change.
- Verify UI changes in the headless browser (and on a phone-width viewport)
  before declaring done — both desktop (1440px) and mobile (~390px).

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
