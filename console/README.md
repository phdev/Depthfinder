# Depthfinder Console

A public, **zero-install** web demo: paste a public GitHub repo, see whether its
AI context (`CLAUDE.md` / `AGENTS.md` / `.cursorrules`) is honest. The server
shallow-clones the repo, runs the local Depthfinder CLI against it
(deterministic, no model calls), renders the honesty card in the browser, and
deletes the clone.

This is **in-repo tooling**, not part of the npm package (the published tarball
is the CLI only). It is for *showing* Depthfinder to people; they run it on their
own (private) repos with `npx depthfinder`.

## Run locally

```bash
npm run console            # http://127.0.0.1:4319 (loopback only)
PORT=8080 npm run console  # custom port
```

Open the URL, paste e.g. `All-Hands-AI/OpenHands`, and you'll see Context Honesty
60 with the dead references called out.

## Make it public (show people without install)

The console binds to loopback; expose it with a **Cloudflare quick tunnel**
(same pattern as the dashboard — no account, a random `*.trycloudflare.com` URL):

```bash
npm run console &                                   # start the server
cloudflared tunnel --url http://localhost:4319      # prints a public URL
```

Share the printed URL. The quick-tunnel URL rotates when `cloudflared` restarts.

### Persistent setup (survives reboots, like the dashboard)

Mirror the dashboard's launchd agents — two plists under
`~/Library/LaunchAgents/`, one running `node console/server.mjs`, one running
`cloudflared tunnel --url http://localhost:4319`. Get the current URL the same
way the dashboard does (parse the tunnel log). For a **stable** URL, use a named
Cloudflare tunnel with a domain instead of a quick tunnel.

## Safety

A public server that runs a tool on arbitrary public repos. The model is small
because Depthfinder is read-only:

- **No code execution.** Depthfinder only reads/parses files (no eval, no build,
  no scripts); `git clone` does not run repo hooks. A hostile repo can't run code
  on the host.
- **No SSRF / injection.** The host is hard-coded to `github.com`; only a strict
  `owner/repo` regex is interpolated, via a spawn **args array** (never a shell).
- **Bounded.** Shallow clone (`--depth 1`, blob-size filter), hard clone/scan
  timeouts, a concurrency cap, a 4 KB request cap; the temp clone is always
  shredded; `--burn` (the only model-calling path) is never invoked.
- **Loopback by default.** Public exposure is opt-in via the tunnel.

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `4319` | listen port |
| `HOST` | `127.0.0.1` | bind address (leave loopback; tunnel handles exposure) |
