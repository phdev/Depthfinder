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
3. **The console (`console/`, in-repo tooling, unpublished):** a public,
   zero-install web demo — paste any public GitHub repo, the server shallow-
   clones it, runs the local CLI (`bin/depthfinder.mjs … --json`), renders the
   honesty card in the browser, and shreds the clone. `npm run console`
   (loopback :4319); expose via a Cloudflare quick tunnel (same pattern as the
   dashboard). Safety: host hard-coded to github.com + strict `owner/repo` regex
   via a spawn args-array (no shell/SSRF), shallow clone + timeouts + concurrency
   cap, `--burn` never invoked, temp clone always deleted. The headline demo is
   `All-Hands-AI/OpenHands` → Context Honesty 60 with 12 dead refs (verified
   2026-06-15 at HEAD `f941ba5`: 6 never-existed false + 6 git-proven stale =
   12; `--strict` → exit 20). The landing page (`docs/index.html`) date-stamps
   this number on purpose so it can't silently rot. See `console/README.md`.

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

**Health meters (CLI dimension model, `src/cli/dimensions.mjs`).** The card LEADS
with a stack of colored meters: the composite **Health** (`Health N · <Healthy|
Caution|Critical>`) on top, then its three dimensions indented under it with a `↳`
— **Honesty / Weight / Coverage** (each 0-100, with a one-line description after
the number). `computeCliDimensions()` is a pure transform over data the CLI already
computes: **Honesty** = Context Honesty (RENAMED from "Coherence" 2026-06-15 — it
was always literally the honesty score, so the new name is the accurate one);
**Weight** = `clamp(100 − over-budget penalty)` vs `--weight-budget` (default
`DEFAULT_WEIGHT_BUDGET`, a labeled HEURISTIC not a derived constant); **Coverage** =
`definite/(definite + unknown)` (CLI-native — deliberately DIFFERENT from the
dashboard's rules-in-CI Coverage); **Health** = `0.4·Honesty + 0.3·Weight +
0.3·Coverage` (matches the dashboard's `computeDimensions`). The old dedicated
`Context Honesty N · …` summary line below the hotspots was REMOVED (2026-06-15):
that number IS the Honesty meter, its since-last-run delta rides that meter line,
and the unknown count is encoded in Coverage. Suppressed as a unit (renders
nothing) when the honesty score is suppressed (< 5 definite) — the
unknown-never-false guard, no fabricated 0.

**COLOR (vivid 16-color, AUTO-detected — `src/cli/color.mjs` `resolveColor`).**
Bars + numbers + criticality tags + fix-gains colorize on a 4-tier band (`tierOf`:
critical <35 / caution <70 / ok <90 / great ≥90) in **standard 16-color SGR**
(switched from soft 256-color, which rendered washed-out / unsupported — "white
meters"). `renderCard(model, {color})` defaults `color` **false**; bin passes the
`resolveColor({flags, env, isTTY})` decision. The ladder (OFF wins): `--no-color` /
`NO_COLOR` → off; `--color` / `FORCE_COLOR` → on; `CI` → off; `isTTY` → on; **else a
color-capable display advertised without a pty (`COLORTERM` / `TERM_PROGRAM` /
`TMUX` / `STY`) → on**; else off. That last rung is what makes color "just work"
in terminal apps / multiplexers / AI shells that CAPTURE a command's output
instead of giving it a pty — **Cmux** (= ghostty; sets `COLORTERM=truecolor` +
`TERM_PROGRAM=ghostty`), tmux (`TMUX`), iTerm (`TERM_PROGRAM`) — where `isTTY` is
false even though a human is watching a color screen. Headless agents and
`> file` redirects don't set those vars, so they stay PLAIN (good: an agent
parsing the card, or a file, gets no escapes). `runCli` forces `NO_COLOR=1` so the
golden snapshot + content assertions are host-independent (the host terminal
advertises COLORTERM). `resolveColor` is unit-tested (`color.test.mjs`), the
end-to-end flags in `cli.test.mjs`. Also a top-level `process.stdout.on("error",
EPIPE → exit 0)` so `… | head` doesn't dump a trace.

**HEADLINE NOTE (reversed invariant, 2026-06-15):** the status word comes from the
COMPOSITE Health, by explicit user choice for dashboard parity — this REVERSED the
original "honesty-led headline, no status word" invariant, so a low-Honesty repo
CAN read `Health 79 · Healthy` (the dirty golden shows exactly this). Soft-gate:
`--warn-below N` warns (advisory, exit 0) when a dimension < N, GATES (exit 20)
under `--strict`; `gate{}` carries `warnBelow` + per-dimension scores + `breached[]`.
`dimensions` is an additive `--json` field — its key is now `honesty` (was
`coherence`), a JSON-contract change, hence the **1.3.0** minor bump.

**Hotspots + criticality + fix-gains.** Below the meters, ALL findings render
(UNCAPPED — `selectFindings(claims, Infinity)`, still med+ confidence false claims
only; low-confidence is never accused). Each opens with a colored **criticality**
tag (`criticality()` in `templates.mjs`: dead path = `CRIT`, stale path / missing
dep = `HIGH`, symbol = `MED`, count = `LOW`) and closes with a deterministic
**`→ fix:`** line (`fixHint()`, same cut-rule as `consequence`: literal slots, no
guessed intent) carrying the score it RETURNS if fixed — **Health first, then
Honesty, in green** (`computeFixGain()` in `dimensions.mjs`: the marginal per-fix
gain per hotspot + the all-fixed target in the Hotspots header). CLI hotspots are
the **honesty findings only**.

**`--triage` (interactive, `src/cli/triage.mjs`).** A HUMAN runs `npx depthfinder
--triage` in a real terminal: arrow-key (↑/↓) through the hotspots, Enter to pick
one, and it hands a targeted fix to the harness on PATH (`resolveAgent` from
`burn.mjs` — claude, else codex, else `$DEPTHFINDER_BURN_AGENT`). `interactiveArgv()`
strips the headless subcommand (`-p`/`exec`) so the harness opens an INTERACTIVE
session in the repo, seeded with a redacted, "don't-invent-a-target" fix prompt
(`buildFixPrompt()`). Same consent posture as `--burn`: prints the exact command +
prompt, asks y/N, then `spawn(..., {stdio:'inherit'})`. TTY-GATED in bin (usage
error exit 2 in CI / a pipe / with `--json`) so it can't wedge a script. Pure pieces
(`buildFixPrompt`/`interactiveArgv`/`triageRows`) are unit-tested; the raw-mode loop
takes injectable deps.

Card anatomy below the hero + findings: the `Context Honesty` score line (`N ·
M checkable claims · K unchecked`); the `Doc Honesty` line (`N · M checkable
claims · K docs · J dead refs`, or `— · K docs · too few checkable claims` when
suppressed; omitted when no docs); the **Weight** line (~chars/4 of the Context
files — what loads into the agent every turn); and the contract breakdown line
`N false claims · M stale · ~T tokens describe code that no longer exists`
(Context-tier only). **Stale** = a false path claim whose target verifiably
existed in git history (deleted/renamed — the doc rotted); **false** = no such
history (fabricated or never true). Both count against honesty identically; the
split is evidence, not forgiveness.

When `false > 0` the card adds the **rot tax** line (deterministic, no model
call): a false line costs the agent either way — it acts on the lie, or it
stops trusting the file and re-derives the whole Weight by hand. The tax is
not the false tokens; it's every token the agent can no longer take on faith.
Under `--burn`, the finding names whichever happened: the agent took the bait
(wrong turn) or it caught the lie but paid a **verification detour**
(`verificationDetours()` counts the grep/find/verify steps it proposed) — both
are the tax, surfaced as "the detour is the tax, every session."

- `bin/depthfinder.mjs` — orchestration, parseArgs, exit codes (0 ran /
  1 internal / 2 usage·no-git / 3 no context files / **20 `--strict` gate
  breach**), stream discipline (stdout = card|JSON only; diagnostics → stderr),
  redaction at both output seams via `lib/redact.mjs`. `--version`/`-v`,
  `--help`/`-h`, `--convention`, and `--install-skill` short-circuit before any
  repo work and exit 0.
  `--convention` prints a drop-in CLAUDE.md/AGENTS.md self-check snippet to
  **stdout** (clean markdown — `npx depthfinder --convention >> CLAUDE.md` is
  append-safe) with the how-to + `--strict` CI pointer to **stderr** (stream
  discipline). It's the deliberate, zero-surface alternative to a bundled MCP
  server: an MCP `depthfinder_scan` tool adds no capability over `npx depthfinder
  --json` for a shell-capable agent (only discoverability + a no-shell niche), so
  the convention line — the agent reads the context file every turn, so the file
  IS the discovery point — buys the discoverability at ~zero cost. MCP was held at
  eng-review (design doc in `~/.gstack/projects/phdev-Depthfinder/`).
- **`--install-skill` (agent-native packaging):** installs the `/depthfinder`
  **agent skill** — ONE `SKILL.md` (a string constant in `bin/depthfinder.mjs`)
  that works across harnesses, since Claude Code, Codex, OpenClaw, and Hermes all
  use the same skill format now. Detects which harnesses are present and writes to
  each: Claude Code → `~/.claude/skills/depthfinder/`, Codex → `~/.agents/skills/
  depthfinder/` (the open-agent-skills dir); defaults to the Claude Code path if
  neither is detected. Writes to the user's HOME, **never the scanned repo**
  (invariant 5 holds). The committed `skills/depthfinder/SKILL.md` (for REGISTRY
  installs — `hermes skills install phdev/Depthfinder/skills/depthfinder`, `npx
  skills add …`, clawhub) is **byte-identical** to what the flag writes — pinned by
  a no-drift test (`tests/cli.test.mjs`). `skills/` is NOT in the npm tarball
  (registry installs pull from GitHub; npm users use the flag). MCP still NOT
  shipped — the skill is the discoverability layer the guide ranks #1; MCP is #3.
- **`--strict` CI gate (V1.5 / Phase A):** fails a build (**exit 20** — outside
  Node's reserved 1-13 range so a wrapper/Action tells rot from a crash) when the
  **Context tier** has more than `--max-false N` false claims (`N` default 0,
  a non-negative integer ratchet; rejects values past `Number.isSafeInteger` so a
  huge digit string can't `parseInt`→Infinity and silently disable the gate).
  Gates the **Context tier only** (convention files + nested + default-followed
  "read first" links, minus `--no-follow`); Doc Honesty is never gated
  (`--strict --docs` prints a stderr advisory when docs have ungated rot) since
  the doc grammar isn't corpus-clean. Gates on the full `score.falseCount` (not
  the 3 rendered findings, not the null-able `honesty` — so it fires even when
  the score is suppressed). **Fail-CLOSED:** a context file that couldn't be read
  (UTF-16/EACCES/oversize → 0 claims) also fails the gate (`gate.unverifiedFiles`)
  — "couldn't verify" must not read as "clean". Sets `process.exitCode` (never
  `process.exit()`, which truncates >64KB stdout). `--out` write failure (exit 2)
  outranks the gate. `--json` adds an additive
  `gate:{strict,maxFalse,false,tier,unverifiedFiles,degraded,failed}` object (null
  unless `--strict`; `failed` = rot OR unverified OR degraded). Also fail-closed on
  **oracle DEGRADATION** — a fatal `git check-ignore` (which blinds the path oracle,
  turning would-be-false paths into unknown) sets `ctx.degraded`/`gate.degraded` and
  fails the gate. Precedence 2 > 3 > 20 > 0. CI must **pin the version**
  (`npx depthfinder@1.3.0`) — `--max-false` is only stable against a pinned extractor.
  Still deferred: the symbol-search-timeout degradation (a NORMAL budget event on
  large repos — failing closed on it would break the gate for every big repo, so it
  needs a per-claim "cut off by the cap" signal, not a run-level flag); plus
  `--strict-docs` (until the doc corpus is zero-false).
- **Agent-loop gate (thin loop-fit):** the `--strict` exit code doubles as the
  termination signal for an agent that's *fixing* rot — `until npx depthfinder
  --strict --no-history; do <fix top claim>; done` stops exactly when the context
  is honest again (deterministic, so "0 false" is a real done-signal, not a
  "looks finished" guess). **NO new flag** — the loop reuses `--strict` (gate) +
  `--json` (per-pass fix targets) + `--no-history` (keeps inner passes out of the
  score-delta history). Shipped as a first-class recipe in the README ("Use it as
  an agent-loop gate") and the `/depthfinder` SKILL.md ("Fix it all (loop)"), so
  an installed agent already knows the pattern — docs-only, no version bump.
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
  inject `tests/helpers/stub-agent.mjs` via the env override (so CI/tests make
  NO real model call). Cost note: a real burn runs the user's agent headless
  (`claude -p` / `codex exec`), so it draws on that agent's usage quota — on
  Claude plans, the separate Agent SDK allotment (from 2026-06-15). One call
  per run; documented in the README `--burn` section.
- `src/cli/templates.mjs` — the ONLY inferential sentence per finding;
  templates are data with an exact-match test (cut-rule in header).
- `src/cli/history.mjs` (V1.2, score-history) — records each run's score to
  the USER CACHE DIR (origin-else-toplevel sha1 key; O_APPEND JSONL; honors
  `DEPTHFINDER_CACHE`/`XDG_CACHE_HOME`) so the card shows a "since last run"
  delta. Writes by default (`--no-history` opts out); a failed cache write
  warns and the scan still exits 0. Deltas compare only against the last
  record with the same `scoringSchema` + `follow`/`docs` flags.
- `src/cli/fix.mjs` (`--fix`, safe-fix) — closes found→fixed, **rename-only**:
  for a false PATH claim whose target git PROVES was renamed (`renameTarget` in
  git.mjs — find the removing commit, then `git show -M` for the `R old new`
  pair, since a path-filtered log reports a rename as a plain delete), repoint
  the stale path to its new location. **Dry-run by default** (prints the preview
  to stdout, writes nothing); `--fix --write` applies — the one opt-in write to
  the scanned repo. Deletions/fabrications are NEVER auto-fixed (no safe target;
  a model might guess, Depthfinder won't). Apply is drift-safe (only edits the
  claim's exact line, only the path token via a trailing-path-char guard, skips
  a line that no longer holds the old path). `--fix --json` emits the fix list
  for tooling (LSP, etc.). Context tier only.
- Default run **writes nothing to the scanned repo**; the only writes are
  `--out` (atomic, opt-in), **`--fix --write`** (opt-in safe-fix), and the
  **score-history line in the user cache dir** (out-of-repo, `--no-history` to
  skip). "Nothing leaves your machine" still holds — history is local.

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
   exception: it calls a local agent, sends ONE line (best-effort redacted —
   pattern-based, not airtight), prints the contract first, and never writes
   to the repo (runs in a temp cwd).
5. **Writes nothing to the SCANNED repo BY DEFAULT.** The only write to the
   scanned repo is **`--fix --write`** (opt-in, rename-only, reviewable). Other
   writes are out-of-repo: `--out` (opt-in) and the score-history cache line
   (`--no-history` to skip). A failed cache write never breaks the scan. The
   scanned repo is byte-identical after any run **without `--fix --write`**
   (enforced by the hashTree test, which runs the default scan).
6. **Pre-tag ritual:** `npm run corpus` against real external repos +
   hand-verification of every false verdict, before any release tag.

## Tests / bench

`npm test` — 70 tests (node:test; hermetic git fixtures with pinned
dates → deterministic SHAs; `--burn` tested via a stub agent, never a real
model call). `npm run bench` — per-phase timings + local
5s tripwire (never in CI). CI: 3 OS × node 20/22; publish on `v*` tags via
**OIDC trusted publishing** (no token/secret — `id-token: write` + a one-time
npm Trusted Publisher entry; provenance automatic). `depthfinder` is LIVE on
npm (v1.0.0, published 2026-06-13). v1.0.0 was published manually (a
token-based CI publish hit `EOTP` — account 2FA-for-writes blocks tokens CI
can't OTP); OIDC sidesteps that for every release after.

## Distribution (beyond the npm CLI)

- **`action.yml` (repo root) — reusable GitHub Action.** A composite action
  wrapping `npx depthfinder@<version> --strict` (inputs: path/max-false/warn-below/
  weight-budget/docs/version; passed via env + bash array, never string-interpolated
  → no shell injection). Consumers use `- uses: phdev/Depthfinder@v1`. NOT in
  the npm tarball (it's a GitHub artifact). To list on the GitHub Actions
  Marketplace: repo → a release → "Publish this Action to Marketplace" (a one-time
  UI step). Built to make "add `--strict` to CI" a one-liner — the Stage-1
  demand-validation adoption bar.
- **`docs/index.html` — one-page landing (GitHub Pages).** Static, zero-dep,
  on-brand (near-black + the `--pos` green), the dirty card as the hero + the
  All-Hands-AI/OpenHands "Context Honesty 60 · 12 dead refs" proof + install
  (CLI / `--install-skill` / the Action). LIVE at https://phdev.github.io/Depthfinder/
  (Pages source = `main` / `/docs`, legacy build; the API default had it on `/` +
  `workflow` build_type, which 404'd — fixed via `gh api -X PUT repos/phdev/Depthfinder/pages`
  setting `source[path]=/docs` + `build_type=legacy`). The grounding destination for
  the Stage-1 outreach. **Design-reviewed 2026-06-15** (Codex + Claude subagent +
  rendered screenshots): fixed a CRITICAL hero bug — `.card` was a `<div>` with no
  `white-space:pre`, so the example terminal output COLLAPSED to a run-on blob in
  every browser (source-read missed it; rendering caught it) → added `white-space:pre`;
  fixed a WCAG-AA contrast fail (`--ink3` #5d6878 = 3.53:1 on the bg → #7a8699, ≥4.9:1
  on every surface it's used on); mobile CTA 44px touch targets + 11px card font; a
  `# sample output` label so the card's fictional numbers aren't mistaken for the real
  OpenHands proof right below. Keep it ONE page (deliberately not a marketing site).
  NOT in the npm tarball.

Five tabs, each with a hash route for deep-linking:

| Tab | Hash | Backend |
|---|---|---|
| Summary (Project Health triage) | `#summary` | `scripts/summary.mjs` |
| Context (typed graph, 12 node / 7 edge types) | `#context` | `scripts/context-map.mjs` |
| Tokens (Token Currents: sources → destinations) | `#tokens` | `scripts/token-budget.mjs` |
| Evals (rule × test × in-CI matrix + live AgentCI gate) | `#evals` | `scripts/coverage.mjs` |
| Drift (Packmind context-evaluator, cached/opt-in) | `#drift` | `scripts/drift-refresh.mjs` |

**Design-ported Context page (`public/context.html`, 2026-06-16).** A handoff from
Claude Design (claude.ai/design — the bundle's `Simplicity.html`, renamed "Context"
in-UI) redesigned the Context tab: a Health hero + collapsible Dimensions cards + a
force-directed **Context Map** + a Hotspots table. Built as a STANDALONE page at
`/context.html` (decoupled from the SPA's 59KB `app.js`), **wired to REAL scan
data**: `public/context-graph.js` is the design's custom SVG force engine (ported
from the bundle's `simplicity-graph.js`) but fetches `/api/map` (the SAME generator
the Cytoscape tab uses — its 12 node / 7 edge types already match the design's
legend, so the adapter is a thin `agent_instruction→ai` type→key map) + `/api/summary`
(Health + Honesty/Weight/Coverage), instead of the prototype's hardcoded home-center
surface list. `public/context-base.css` + `public/context.css` are the design's CSS
(dark monochrome, Arimo/JetBrains-Mono; node-type grays in `--nt-*`). **DONE this
pass** (verified rendering on home-center, Health 83, no console errors): the 113-node
graph + select/fan/inspect/filter/pan/zoom + deterministic layout, the Health hero,
Dimensions cards, and the left-rail stats + type-legend — all from live data.
**Increment 2 (DONE, verified):** the in-map **Hotspots sidebar** is wired to the
REAL `/api/summary` issues — turned out NO `summary.mjs` change was needed because
each issue already carries `severity`, `title`, `detail`, `tab` (1 Honesty / 2
Weight / 3 Coverage / 4 Drift → "Improves X"), and **`healthGain`** ("+N health").
`buildHotspots()` fuzzy-matches each issue to its real graph node (`findAnchor`:
normalize + substring the title/detail against node ids) so clicking a hotspot
**highlights the real node + neighbours** and the inspect panel shows the real
severity/health/detail/action — nothing fabricated. Added the **rail show/hide
toggle** (`#sxRailToggle` — the design shipped the rail minimized with no control)
and wired the rail's **dangling-references** finding to real `map.danglingRefs`.
**Still pending (minor):** the rail's CI-gaps + duplicate-block findings are still
the design's placeholders (no single API field yet); the hidden full hotspots TABLE
+ its per-row mini-maps aren't rendered (the in-map sidebar replaces them); a nav
link from the SPA (reach it directly at `/context.html`). The bundle's other pages
(Home/Summary/Tokens/Drift/Evals) were out of scope — Context.html only.

**Summary Health model.** `scripts/summary.mjs` emits a composite `healthScore`
(0–100) decomposed into three **deterministic** dimensions: **Honesty** (docs
match code — from map dangling refs + duplicate drift; renamed from "Coherence"
2026-06-15 to match the CLI), **Weight** (load every
turn — from token budgets), **Coverage** (rules/evals enforced in CI — from the
coverage matrix), weighted 0.4 / 0.3 / 0.3. The design's 4th dimension
("Simplicity") was dropped as non-deterministic. The Summary tab renders a health
hero (rating: <35 Critical / 35–69 Caution / ≥70 Healthy) + 3 dimension cards + a
ranked Hotspots table, styled by `public/summary.css` (scoped under
`#panel-summary` so the other tabs are untouched). Every score is honest math over
real signals — no fabricated numbers; the unknown-never-false invariant applies to
the dashboard too.

- **Always-live, never stale-cache.** The Summary regenerates token budgets
  **live** on every load via `generateTokens()` (the full budget scan with
  `.callouts`, ~900ms) — it never reads the possibly-9-days-stale
  `.cache/tokens.json` for the Weight dimension. The map + coverage panels
  already regenerated live; this closes the last cache-staleness hole, so
  Health always reflects the live repo. `POST /api/refresh/tokens` calls
  `writeTokens` (which actually persists the recomputed cache — the prior
  first-choice `generateCurrents` returned fresh data without writing, so the
  refresh button silently no-op'd).
- **Per-hotspot health radial.** Each Hotspot row shows a projected
  `+N health` gain — the honest, bounded share of its dimension's *recoverable*
  health (`dimWeight × (100 − dimScore)`, severity-weighted within the
  dimension). It self-zeroes when a dimension is already maxed and is omitted
  (no radial) when the gain rounds to 0 — never a fabricated constant. The
  `maxHealthGain` field scales the radial fill.
- **Pull-to-refresh.** On touch devices, pulling down at the top of the active
  panel (scrollTop ≤ 0) triggers the existing `#globalRefresh` action — same
  live-regeneration path as the header refresh button.
- The old "Working" positives footnote was removed from the Summary (front-end
  render, `.df-healthy` CSS, and the backend `healthy[]` array) — the triage
  view is hotspots-only; "what's healthy" is implicit in the dimension scores.

**Suggested Actions.** Each hotspot's "Suggested action" expand carries, beyond
the terse `action` hint, a full **harness-neutral prompt** (`buildActionPrompt`,
pure + unit-tested): plain text (no Claude/Codex-specific syntax), grounded only
in the issue's real data, with NO fabricated target numbers in the verify step
(unknown-never-false applies — "confirm it improves", never "3/4 → 4/4"). Three
affordances; the dashboard server itself stays **read-only** and never executes:
- **Copy prompt** — copies the prompt for the user to paste into their OWN agent
  session (their quota, their approval). Universal; the only path on mobile.
  `navigator.clipboard` on secure contexts (localhost + the https tunnel), with a
  hidden-textarea `execCommand` fallback for LAN http (not a secure context).
- **Open in Claude Code** — a `claude-cli://open?…&q=<prompt>` deep link that
  opens a NEW Claude Code session with the prompt **pre-filled but inert until the
  user presses Enter** (per the verified deep-link spec — so a tunnel viewer can't
  auto-fire it; the OS + Claude Code do the work, not the server). The directory
  is targeted by **owner/repo slug** (`harnessTarget()` → `parseGithubSlug` of the
  origin remote) so no absolute path leaks over the tunnel; falls back to `cwd`
  only when there's no parseable remote. `q` is URL-encoded (`%0A` newlines) and
  the link is omitted above the scheme's 5,000-char cap.
- **Open in Terminal** — opens the user's own Terminal with `claude "<prompt>"`
  **PRE-TYPED** (you press Enter to run it). Routed through the **opt-in loopback
  helper** (`scripts/action-helper.mjs`, see below), so it's hidden unless that
  helper is up (`#panel-summary.df-helper`, set by `probeHelper()` hitting
  `/api/helper`). The button sends only `{issueId, titleHash}` — never the prompt
  text; the helper derives the prompt itself. First click shows a one-time consent.
- **Mobile handling.** The deep link and the terminal launch are desktop-only, so
  `@media (pointer: coarse) and (max-width: 720px)` hides `.ae-open` and `.ae-term`
  on phones (NOT width alone — a narrowed desktop window keeps them) and annotates
  the label "— copy into your agent"; Copy remains.
- **Next (not built):** an MCP-pull surface (a local `claude-cli`/Codex MCP server
  exposing hotspots + actions as read-only tools, so the harness reads & acts
  in-session) — slated for a separate `/plan-eng-review` (different transport from
  the terminal helper: stdio harness-pull vs HTTP dashboard-push).

**Terminal helper (`scripts/action-helper.mjs`) — opt-in, loopback, off by
default.** A SEPARATE process from the dashboard server, binding **127.0.0.1:4318
only** and **never forwarded by the tunnel** (cloudflared proxies only `:4317`).
Its one job: open the user's Terminal with a suggested-action prompt PRE-TYPED
(never executed). Defense in depth, eng-reviewed (see the design doc in
`~/.gstack/projects/phdev-Depthfinder/`):
- **L1 loopback isolation** (primary remote defense): a tunnel viewer's
  `fetch('127.0.0.1:4318')` hits THEIR own localhost, never the host's.
- **L2 Origin allowlist**: `POST /run-in-terminal` requires `Origin:
  http://127.0.0.1:4317`; rejects foreign/`null`.
- **L3 per-boot token**: minted by the helper, written `0600` to
  `.cache/helper.json`; the dashboard's `GET /api/helper` serves it same-origin
  (CORS withholds the body from cross-origin pages); the POST must echo it as
  `x-df-token`.
- **L4 issueId-only**: the request carries NO command text. The helper re-runs
  `generateSummary()` and derives the prompt from the `issueId` (+ a `titleHash`
  sanity check for a stale scan), so a forged request can't inject a command.
- **L5 Enter checkpoint**: `osascript` PRE-TYPES `claude "<prompt>"` via
  `keystroke` (no trailing return); the user reviews and runs it. Nothing
  auto-executes. macOS-only (refuses to start elsewhere); first use needs
  Accessibility permission. Security suite: `tests/action-helper.test.mjs`.

## Architecture

- `server.mjs` — built-in `http` server. Binds **127.0.0.1 only** by default;
  `LAN=1` / `--lan` / `HOST=` opts into LAN exposure. Endpoints:
  `GET /api/{summary,map,tokens,coverage,drift}`, `GET /api/helper` (terminal-
  helper handshake — serves the helper token same-origin, raw/un-redacted),
  `POST /api/refresh/{map,tokens,coverage,drift}`, `POST /api/run/gate`.
- `scripts/action-helper.mjs` — the opt-in **terminal helper** (separate process,
  loopback `:4318`, never tunneled). Documented under "Suggested Actions" above.
  Enable: `npm run helper:enable` (installs the `dev.depthfinder.helper` launchd
  job). This is the ONLY Depthfinder surface that can launch a process, and it
  only ever PRE-TYPES (never runs) — execution is the user's Enter press.
- `scripts/*.mjs` — one generator per panel; each writes its cache under
  `.cache/` (gitignored) and never writes to the analyzed repo.
- `lib/repo.mjs` — REPO_ROOT resolution (`$REPO_ROOT` env > `.repo-root` file >
  `../../`), path-traversal-safe reads. `.repo-root` is machine-specific and
  gitignored; see `.repo-root.example`.
- `lib/redact.mjs` — secret/token/key patterns are redacted from every API
  payload before it reaches the browser.
- `public/` — vanilla JS single page (`index.html`, `app.js`, `styles.css`,
  plus `summary.css` for the ported Summary redesign).
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
7. **The terminal helper binds 127.0.0.1 only, is never tunneled, is opt-in /
   off-by-default, derives its prompt from an `issueId` (never accepts command
   text), and only PRE-TYPES (never executes) — the user confirms every run with
   Enter.** A dashboard-initiated terminal launch must NEVER be a `:4317`
   (tunnel-exposed) execute endpoint — that would be an RCE through the no-auth
   tunnel. `server.mjs` stays read-only; execution lives only in the separate,
   isolated, consent-gated `:4318` helper.

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

A third, **opt-in** agent powers "Open in Terminal": `dev.depthfinder.helper`
(loopback `:4318`, **never tunneled**, logs in `helper.log`). It's OFF until you
run `npm run helper:enable` (writes + loads the plist; the enable script derives
machine paths at runtime, so nothing machine-specific is committed). Disable:
`launchctl bootout gui/$(id -u)/dev.depthfinder.helper && rm
~/Library/LaunchAgents/dev.depthfinder.helper.plist`. First click needs macOS
Accessibility permission (it `keystroke`s into Terminal). `.cache/helper.json`
(the per-boot token) is gitignored like the rest of `.cache/`.

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
