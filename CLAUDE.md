# CLAUDE.md — Depthfinder

## What this is

Depthfinder is a private, local-only, **read-only** visualizer for how a target
repo (built for `home-center`) uses its context surfaces — Markdown docs,
prompts, memory stores, evals, and CI. Zero runtime dependencies (Node
built-ins only); the graph view loads Cytoscape from a CDN in the browser.

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
