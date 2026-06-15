---
name: depthfinder
description: Verify this repo's AI context files (CLAUDE.md / AGENTS.md / .cursorrules) are still TRUE against the code. Surfaces false and stale claims — dead paths, missing dependencies, wrong counts, absent symbols — before you trust them. Use before relying on the project docs, or when the user asks about context rot, stale docs, or drift.
---

# depthfinder — keep your AI context honest

The files you read as ground truth (CLAUDE.md, AGENTS.md, .cursorrules, and the
docs they point to) rot: paths go dead, dependency claims go stale, counts drift.
depthfinder scans the factual claims those files make and verifies each against
the repo — deterministically, no model calls, nothing leaves the machine.

## When to use

- BEFORE you rely on a factual claim in the context files (a file path, a
  dependency, a count, an exported symbol).
- Whenever the user asks "is my context stale?", "what's rotted?", or anything
  about context honesty / drift.

## How

```bash
npx depthfinder            # scan the current repo; prints the honesty card
npx depthfinder --json     # structured: score + false/stale claims + dimensions + hotspots
npx depthfinder --strict   # CI gate: exit 20 if the context has any false claim
```

Read the **Context Honesty** score and the **Hotspots** (each false/stale claim
with a `→ fix:` line). Treat any claim flagged **false** (never matched the
repo) or **stale** (git proves the target moved or was deleted) as UNRELIABLE:
verify it against the code before acting, and prefer fixing the doc. Requires
Node >= 20 and git.
