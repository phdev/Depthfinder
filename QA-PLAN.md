# QA Plan for Depthfinder

## CLI

### General Usage
- [ ] `npx depthfinder --version` should print the version number.
- [ ] `npx depthfinder --help` should display the usage instructions.
- [ ] `npx depthfinder --json` should output a JSON payload instead of the card.
- [ ] `npx depthfinder --out <dir>` should write claims.json into the specified directory.
- [ ] `npx depthfinder --no-follow` should not follow "read first" links from context files into repo docs.
- [ ] `npx depthfinder --docs` should also scan the wider repo docs for a Doc Honesty score.
- [ ] `npx depthfinder --strict` should exit 20 when Context Honesty has false claims or unread/unverified files.
- [ ] `npx depthfinder --max-false N` should allow up to N false Context claims before --strict fails.
- [ ] `npx depthfinder --warn-below N` should warn when a Health dimension scores below N.
- [ ] `npx depthfinder --weight-budget N` should set the token budget for the Weight dimension.
- [ ] `npx depthfinder --fix` should repoint stale path claims that git proves were RENAMED.
- [ ] `npx depthfinder --write` should apply rename-fixes to your context files.
- [ ] `npx depthfinder --triage` should interactively step through hotspots and hand a chosen fix.
- [ ] `npx depthfinder --burn` should run a local agent against the top false claim.
- [ ] `npx depthfinder --burn-agent <cmd>` should use the specified agent command for --burn.
- [ ] `npx depthfinder --no-history` should not record this run / show a "since last run" delta.

### Error Handling
- [ ] Running with an invalid path should return an error message.
- [ ] Running with a non-git repo should return an error message.
- [ ] Running with a git binary missing should return an error message.
- [ ] Running with no context files found should return an error message.
- [ ] Running with a skipped/unread file under --strict should fail closed.

## Web Dashboard

### General Usage
- [ ] The dashboard should display the honesty card when loaded.
- [ ] The dashboard should allow selecting between JSON payload and card view.
- [ ] The dashboard should allow specifying a custom path to scan.
- [ ] The dashboard should allow enabling/disabling doc scanning.
- [ ] The dashboard should allow setting strict mode with max-false limit.
- [ ] The dashboard should allow setting soft-gate thresholds for health dimensions.

### Interactivity
- [ ] The dashboard should display hotspots and allow selecting a fix to apply.
- [ ] The dashboard should display the burn preview and allow running the agent.
- [ ] The dashboard should display rename fixes and allow applying them.

## GitHub Action

### General Usage
- [ ] The action should fail the build when Context Honesty has false claims or unread/unverified files under --strict.
- [ ] The action should allow specifying a custom path to scan.
- [ ] The action should allow enabling/disabling doc scanning.
- [ ] The action should allow setting strict mode with max-false limit.
- [ ] The action should allow setting soft-gate thresholds for health dimensions.

### Error Handling
- [ ] The action should handle invalid inputs gracefully and return an error message.
- [ ] The action should handle non-git repos gracefully and return an error message.
- [ ] The action should handle missing git binary gracefully and return an error message.
- [ ] The action should handle no context files found gracefully and return an error message.

## Claude Skill

### General Usage
- [ ] The skill should be installed in the user's agent (Claude Code or Codex).
- [ ] The skill should self-check the context honesty using depthfinder CLI.
- [ ] The skill should surface false and stale claims to the user.
- [ ] The skill should allow fixing claims interactively.

### Error Handling
- [ ] The skill should handle missing depthfinder CLI gracefully and return an error message.
- [ ] The skill should handle invalid inputs gracefully and return an error message.
