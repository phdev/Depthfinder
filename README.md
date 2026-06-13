# Depthfinder

**Keep your AI context honest.**

Your agent reads `CLAUDE.md`, `AGENTS.md`, and `.cursorrules` as ground
truth — and those files rot. Paths go dead, dependency claims go stale,
counts drift. Depthfinder scans the claims your context files make and
verifies them against the repo itself.

```
$ npx depthfinder

  Scanning CLAUDE.md against 1,204 tracked files…

  ✗ CLAUDE.md:67  "auth flows live in `src/auth/oauth.ts`"
      └ no such tracked file — deleted at a1b3f2e, 38 commits ago
      └ an agent following this reference will find nothing at src/auth/oauth.ts, and guess

  ✗ CLAUDE.md:41  "wake word handled by `openWakeWord`"
      └ not in any package.json (checked 3 manifests)
      └ an agent will write code against openWakeWord, which isn't installed

  ✗ CLAUDE.md:23  "model routing uses 4 tiers (see `router/config.js`)"
      └ router/config.js defines 3 tiers, not 4
      └ an agent reasoning about "4 tiers" will plan against a structure that has 3

  Context Honesty   64 · 22 checkable claims · 3 unchecked
  Weight   ~9,480 tokens load every turn
  5 false claims · 3 stale · ~4,210 tokens describe code that no longer exists

  Your agent reads all of this as ground truth, every call.
```

**Context Honesty** scores the files your agent auto-loads every turn
(`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and the docs they tell it to
read first). Run with **`--docs`** to also get a separate **Doc Honesty**
score over the wider repo docs your agent reads on demand — runbooks,
design notes, package READMEs:

```
  Context Honesty   64 · 22 checkable claims · 3 unchecked
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
your consent), it prints exactly what it's about to send before it runs, it
redacts the line first, and it sends only that one line — not your repo.
Override the agent with `--burn-agent "<cmd>"` or `DEPTHFINDER_BURN_AGENT`.

## Run

```bash
npx depthfinder            # scan the repo you're in
npx depthfinder ~/proj     # scan another repo
npx depthfinder --json     # machine-readable claims + score (stdout)
npx depthfinder --out dir  # also write claims.json (atomic; the ONLY write)
npx depthfinder --no-follow # don't follow "read first" links into repo docs
npx depthfinder --docs     # opt in to the wider-docs scan (Doc Honesty)
npx depthfinder --burn     # run your agent against the top false claim (opt-in; calls a model)
```

By default, when a context file links repo docs under a "read first" /
"project brain" heading, Depthfinder follows those links **one hop** and
scans the linked docs too — that pointed-to surface is context your agent
reads as well. Linked-doc claims count toward the score; they don't count
toward Weight (they don't load every turn). `--no-follow` turns this off.

Requires **Node ≥ 20** and **git** (evidence comes from git history;
shallow clones degrade gracefully). The default run writes **nothing** to
the scanned repo.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | ran (findings or not — the scan is advisory) |
| 1 | internal error |
| 2 | usage error · not a git repo · git missing · bad `--out` |
| 3 | no context files found |

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
