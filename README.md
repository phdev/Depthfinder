# Depthfinder

**Keep your AI context honest.**

Your agent reads `CLAUDE.md`, `AGENTS.md`, and `.cursorrules` as ground
truth — and those files rot. Paths go dead, dependency claims go stale,
counts drift. Depthfinder scans the claims your context files make and
verifies them against the repo itself.

```
$ npx depthfinder

  Scanning CLAUDE.md against 1,204 tracked files…

  Health 67 · Caution
  Coherence 41 · Weight 80 · Coverage 88

  Hotspots

  1. ✗ CLAUDE.md:67  "auth flows live in `src/auth/oauth.ts`"
      └ no such tracked file — deleted at a1b3f2e, 38 commits ago
      └ an agent following this reference will find nothing at src/auth/oauth.ts, and guess
      → fix: repoint or remove this path — `npx depthfinder --fix --write` auto-repoints any git-proven rename

  2. ✗ CLAUDE.md:41  "wake word handled by `openWakeWord`"
      └ not in any package.json (checked 3 manifests)
      └ an agent will write code against openWakeWord, which isn't installed
      → fix: remove the line, or add `openWakeWord` to your dependencies

  3. ✗ CLAUDE.md:23  "model routing uses 4 tiers (see `router/config.js`)"
      └ router/config.js defines 3 tiers, not 4
      → fix: update the count to 3

  Context Honesty   41 · 22 checkable claims · 3 unchecked
  Weight   ~14,000 tokens load every turn
  10 false claims · 3 stale · ~8,100 tokens describe code that no longer exists

  Your agent reads all of this as ground truth, every call.
```

**Context Honesty** scores the files your agent auto-loads every turn
(`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and the docs they tell it to
read first). Run with **`--docs`** to also get a separate **Doc Honesty**
score over the wider repo docs your agent reads on demand — runbooks,
design notes, package READMEs:

```
  Context Honesty   41 · 22 checkable claims · 3 unchecked
  Doc Honesty       91 · 188 checkable claims · 34 docs · 4 dead refs
  ...
```

They're separate because they're different trust tiers; a dead link in a
runbook shouldn't drag down your contract score. Doc scanning is precision-
hardened (it ignores code examples, past-tense narration like "we removed
X", and generated-artifact paths). It's **opt-in for now** — the doc grammar
isn't yet validated across enough repos to accuse by default, which for an
honesty tool is a line we won't cross until it's earned.

**Weight** is what the Context files cost on every single agent call.
**False** claims never matched the repo's history (fabricated or always
wrong); **stale** claims were once true — git proves the file existed
before it was deleted or moved. Both count against the score; the split
tells you whether your docs rot or lie.

Zero config. Sub-5 seconds. **No model calls by default — nothing leaves
your machine** unless you explicitly opt in with `--burn` (below).
Deterministic checks only: if Depthfinder can't decide a claim safely, it
says `unknown` — it never guesses and never accuses.

### `--burn`: watch your agent get it wrong (opt-in)

The default card *tells* you a stale line would mislead your agent. `--burn`
*shows* you. It takes the top false claim, feeds the rotten line to a coding
agent you already have (`claude`, else `codex`), and prints what the agent
actually says — which confidently names the file that no longer exists:

```
$ npx depthfinder --burn

  ✗ CLAUDE.md:5  "Auth flows live in `src/auth/oauth.ts`."
      └ no such tracked file — deleted at fccd7c9, 1 commit ago
      ▶ claude -p answered (your context, no repo to check):
           To fix the auth bug, open src/auth/oauth.ts and check the
           token validation in the oauth handler first.
      └ stated as fact — from a line your repo already contradicts.
```

`--burn` is the **only** path that calls a model. It's opt-in (the flag is
your consent), it prints exactly what it's about to send before it runs, and
it sends only that one line — not your repo — to a coding agent you already
run (so it goes wherever your own `claude`/`codex` already sends prompts).
Known secret shapes (API keys, tokens) are redacted from the line first;
redaction is best-effort and pattern-based, so don't rely on it to scrub an
exotic secret. Override the agent with `--burn-agent "<cmd>"` or
`DEPTHFINDER_BURN_AGENT`.

Because `--burn` runs your agent in headless mode (`claude -p` / `codex exec`),
each burn counts against that agent's usage quota. On Claude subscription
plans (from 2026-06-15) that's the separate **Agent SDK** allotment, metered
apart from your interactive sessions. It's one call per run, but keep it in
mind before wiring `--burn` into CI or a loop.

## Run

```bash
npx depthfinder            # scan the repo you're in
npx depthfinder ~/proj     # scan another repo
npx depthfinder --json     # machine-readable claims + score (stdout)
npx depthfinder --out dir  # also write claims.json (atomic; the only write to the repo dir)
npx depthfinder --no-history # don't record this run / show a "since last run" delta
npx depthfinder --no-follow # don't follow "read first" links into repo docs
npx depthfinder --docs     # opt in to the wider-docs scan (Doc Honesty)
npx depthfinder --burn     # run your agent against the top false claim (opt-in; calls a model)
npx depthfinder --strict   # CI gate: exit 20 when your context has rotted (false claims)
npx depthfinder --strict --max-false 5  # ...allow up to 5 before failing (ratchet)
npx depthfinder --warn-below 80  # warn if a Health dimension scores < 80 (advisory; gates under --strict)
npx depthfinder --weight-budget 8000  # token budget for the Weight dimension (heuristic; default 10000)
npx depthfinder --fix      # repoint paths git proves were renamed (dry run — shows the diff)
npx depthfinder --fix --write  # ...actually apply the rename-fixes (the only write to your repo)
npx depthfinder --convention >> CLAUDE.md  # add a snippet so agents self-check this file
npx depthfinder --install-skill  # install the /depthfinder agent skill (Claude Code + Codex)
npx depthfinder --version  # print the version and exit (-v); --help (-h) for usage
```

By default, when a context file links repo docs under a "read first" /
"project brain" heading, Depthfinder follows those links **one hop** and
scans the linked docs too — that pointed-to surface is context your agent
reads as well. Linked-doc claims count toward the score; they don't count
toward Weight (they don't load every turn). `--no-follow` turns this off.

Requires **Node ≥ 20** and **git** (evidence comes from git history;
shallow clones degrade gracefully). The default run writes **nothing** to the
scanned repo. It does keep a small **score history** in your cache dir
(`~/.cache/depthfinder/…`, honoring `XDG_CACHE_HOME`) so the card can show a
delta — `Context Honesty 95 (▼17 since last run)`. That stays on your machine;
`--no-history` turns it off.

### Make your agent self-check — the convention line

The cheapest way to get an agent to *use* Depthfinder is to tell it to, right in
the context file it already reads every turn. `--convention` prints a drop-in
snippet for your `CLAUDE.md` / `AGENTS.md`:

```bash
npx depthfinder --convention >> CLAUDE.md   # stdout is the snippet; the how-to prints to stderr
```

It adds a short "before you trust the claims in this file, run `npx depthfinder`
and treat anything it flags as false or stale as unreliable" rule. Now any agent
reading the file knows to verify the docs against the code instead of trusting a
rotted line — no plugin and no MCP server, just the CLI it can already run. (An
agent with a shell can run `npx depthfinder --json` directly; this snippet is the
nudge that makes it *think* to.)

### Make it a first-class skill — `--install-skill`

For a more discoverable, invokable `/depthfinder` skill (vs the in-file
convention line), install the agent skill. It's **one `SKILL.md` that works across
harnesses** — Claude Code, Codex, OpenClaw, and Hermes all use the same format:

```bash
# Claude Code + Codex — local file install (writes ~/.claude/skills, ~/.agents/skills):
npx depthfinder --install-skill

# Hermes / Vercel open-agent-skills — install the SAME skill from this repo:
hermes skills install phdev/Depthfinder/skills/depthfinder
npx skills add phdev/Depthfinder/skills --skill depthfinder
```

`--install-skill` detects which harnesses you have and drops the skill into each.
The canonical skill lives at [`skills/depthfinder/SKILL.md`](skills/depthfinder/SKILL.md)
(byte-identical to what the flag writes — pinned by a test). MCP is deliberately
*not* shipped: for a shell-capable agent it adds nothing over `npx depthfinder
--json`; the skill is the discoverability layer, the CLI does the work.

### Fail CI when your context rots — `--strict`

The default scan is advisory (always exit 0). `--strict` turns it into a **gate**:
it exits **20** when your Context Honesty has any false claim — so a PR that lets
`CLAUDE.md` drift out of sync with the repo fails the build.

```yaml
# .github/workflows/context-honesty.yml
on: [pull_request]
jobs:
  depthfinder:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4   # fetch-depth:0 if you want stale/rename evidence
      - uses: phdev/Depthfinder@v1   # the reusable context-honesty gate
        with:
          max-false: 0     # ratchet down over time; warn-below / docs also supported
```

(Or run it directly without the Action: `- run: npx depthfinder@1.2.0 --strict`.)

- **Gates the Context tier only** (your convention files + nested + the "read
  first" links they follow, minus `--no-follow`). `--docs` (Doc Honesty) is
  advisory and never fails the build.
- **`--max-false N`** allows a budget of `N` false claims (default 0). Adopt on
  an already-rotten repo at a high `N`, then ratchet it down each sprint.
- **Pin the npm version** (`npx depthfinder@1.2.0`, not bare `npx depthfinder`).
  The false count is extractor-dependent; a future release could change it and
  turn your build red with zero repo changes. Pinning makes `--max-false` stable.
- **Fails closed.** If a context file can't be read (UTF-16, permissions), the
  gate fails rather than passing on a file it never checked — "couldn't verify"
  is not "clean."
- Exit **20** is outside Node's reserved range (1, 3–12 are Node's own internal
  failures), so a wrapper can tell "your context rotted" from "depthfinder
  broke." `--json` carries a
  `gate: { strict, maxFalse, false, tier, unverifiedFiles, failed }` object
  (`failed` = rot or couldn't-verify) for programmatic use.

### Use it as an agent-loop gate

The same exit code that gates CI also makes a clean **termination signal for an
agent loop**. Because the scan is deterministic, "0 false claims" is a real
done-signal — not a "looks finished" guess — so an agent fixing rot can loop
until depthfinder passes:

```bash
until npx depthfinder --strict --no-history >/dev/null 2>&1; do
  npx depthfinder --json --no-history   # the false/stale claims + each fix to apply
  # …fix the top claim (repoint the path, drop the dead dep, correct the count)…
done
```

`--strict` exits **0** once nothing is false and **20** while anything still is,
so the loop stops exactly when the context is honest again. `--no-history` keeps
the inner passes out of your score-delta history. This is the pattern the
`/depthfinder` agent skill ships, so an installed agent already knows it
(`--install-skill`).

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | ran (findings or not — the scan is advisory) |
| 1 | internal error |
| 2 | usage error · not a git repo · git missing · bad `--out` |
| 3 | no context files found |
| 20 | `--strict` gate breach: Context Honesty has > `--max-false` false claims, or a context file couldn't be verified (fail-closed) |

### What it checks

| Oracle | Claim shape | Verified against |
|--------|-------------|------------------|
| path | `` `src/auth/oauth.ts` `` (delimited) | `git ls-files` |
| dependency | "handled by `` `pkg` ``" | every package.json (workspaces, all 4 dep fields) |
| symbol | "exports `` `startEngine` ``" | ESM/TS export forms |
| count | "4 tiers (see `` `router/config.js` ``)" | literal cardinality |

Scanned conventions: root `CLAUDE.md` / `AGENTS.md` / `.cursorrules`,
`.cursor/rules/**/*.mdc`, nested `CLAUDE.md` / `AGENTS.md` (tracked).
Secrets matching common token patterns are redacted from all output.

## Dashboard (in-repo tooling, not part of the npm package)

The repo also contains a local-only web visualizer (five tabs: Summary,
Context graph, Token Currents, Evals, Drift) used to analyze a single repo
in depth. `npm start` → `http://127.0.0.1:4317` (loopback only; `LAN=1` to
opt into LAN). See `CLAUDE.md` for its architecture and invariants.

## Development

```bash
npm test               # 35 tests: precision gate, golden card, boundary…
npm run bench          # per-phase timings + local 5s tripwire
npm run corpus         # manual external-repo run (pre-tag ritual)
npm run snapshot:update  # re-approve the golden card after render changes
```

The hard ship gate: **zero false accusations** on the labeled fixture
corpus, on every push, on every OS lane. A missed lie is acceptable; a
false accusation is fatal.

MIT © Peter Howell
