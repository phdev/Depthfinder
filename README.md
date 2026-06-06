# Depthfinder

Private, local-only, **read-only** visualizer for how a repo (built for
[`home-center`](https://github.com/phdev/home-center)) uses its Markdown /
prompt / memory / eval surfaces. Five tabs:

0. **Summary** — live triage board: severity-ranked issues across all panels,
   each deep-linked to the tab that proves it, plus a health strip.
1. **Context graph** — typed graph of every context surface (nodes + edges +
   per-node token counts), with the deterministic boundary
   (`derivations` *decides*, `openclaw` *enhances*, tests *protect*), plus
   dangling-path and duplicate-block detection.
2. **Token budget** — repomix (o200k_base) token cost by path; CLAUDE.md
   (always-loaded, ≤ 4k target) and the read-first bundle (≤ 22k) vs budget.
3. **Eval coverage** — rule × protecting-artifact × in-CI matrix from
   `context/rules.yaml` + `openclaw/eval/results/` + workflow parsing, a **real
   offline AgentCI gate** run button, and live eval-tier availability.
4. **Drift** — cached Packmind context-evaluator result; manual, opt-in refresh
   only, because it sends file contents to an AI provider.

Zero runtime dependencies (Node built-ins only). The graph uses Cytoscape from
a CDN at page load (browser-side only).

## Setup

This tool lives in its own repo and reads a *separate* repo read-only. Point it
at that repo once:

```bash
cp .repo-root.example .repo-root
# edit .repo-root → the absolute path of the repo to analyze, e.g.
#   /Users/you/home-center
```

`.repo-root` is gitignored (machine-specific). Alternatively set `REPO_ROOT` in
the environment, which takes precedence.

## Run

```bash
npm start                 # → http://127.0.0.1:4317  (loopback only)
```

`REPO_ROOT=/path/to/repo npm start` overrides the analyzed repo; `PORT=...`
overrides the port.

### Phone / LAN access (opt-in)

The server binds **`127.0.0.1` only** by default. To reach it from another
device on your network (e.g. your phone), opt in explicitly:

```bash
LAN=1 npm start           # also listens on 0.0.0.0; prints your LAN URL
```

This serves the (redacted, unauthenticated) tool to **every device on your
network** — only do it on a trusted LAN, and the phone must be on the same
WiFi. For internet access, prefer a Cloudflare Tunnel over LAN exposure.

## Refresh / regenerate

```bash
npm run map               # regenerate the context graph → .cache/context-map.json
npm run tokens            # recompute the token budget (runs repomix)
npm run coverage          # rescan the eval-coverage matrix
npm run drift:refresh     # MANUAL Packmind run — sends repo contents to an AI agent
```

Endpoints: `GET /api/{summary,map,tokens,coverage,drift}`,
`POST /api/refresh/{map,tokens,coverage,drift}`, `POST /api/run/gate`.

## Security

- Binds `127.0.0.1` only unless `LAN=1` / `--lan` / `HOST=` is set. No auth, no DB.
- Secret/token/key patterns are redacted from every payload before it reaches
  the browser.
- `memory/household/*` contents are **never** rendered — only `populated` and a
  count.
- The only thing that sends analyzed-repo contents off-machine is the explicit,
  opt-in `npm run drift:refresh`.

## What it writes

**Read-only against the analyzed repo.** Everything this tool writes stays in
its own repo: this dir, its `.cache/` (generated artifacts, gitignored), and the
authored `context/rules.yaml`. The AgentCI gate run redirects its report and
golden snapshots into `.cache/` so the analyzed repo is never touched.
