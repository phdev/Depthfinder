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

**Weight** is what these files cost on every single agent call.
**False** claims never matched the repo's history (fabricated or always
wrong); **stale** claims were once true — git proves the file existed
before it was deleted or moved. Both count against the score; the split
tells you whether your docs rot or lie.

Zero config. Sub-5 seconds. **No model calls — nothing leaves your
machine.** Deterministic checks only: if Depthfinder can't decide a claim
safely, it says `unknown` — it never guesses and never accuses.

## Run

```bash
npx depthfinder            # scan the repo you're in
npx depthfinder ~/proj     # scan another repo
npx depthfinder --json     # machine-readable claims + score (stdout)
npx depthfinder --out dir  # also write claims.json (atomic; the ONLY write)
```

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
