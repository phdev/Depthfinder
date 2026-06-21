// Semantic Honesty panel — the MODEL TIER, dashboard side.
//
// SLOW + COSTLY + CALLS A MODEL: --judge shadows a local agent (claude/codex)
// read-only over the repo to catch stale/inverted doc state-claims the
// deterministic pass can't. Like Drift, this is a SEPARATE, manual, opt-in job
// — never run on page load. It writes a timestamped JSON under .cache/; the
// panel only ever READS the cache (GET /api/judge). Same off-machine posture as
// Drift/--burn: it sends nothing the user's own agent doesn't already see.
//
// Implementation reuses the CLI wholesale: spawn `depthfinder --judge --json` in
// REPO_ROOT and cache `payload.judge`. No judge logic is duplicated here — the
// CLI owns discovery, ingest, redaction, agent resolution, and the consent
// contract (printed to stderr).
import {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, CACHE_DIR, ensureCache } from "../lib/repo.mjs";
import { resolveAgent } from "../src/cli/burn.mjs";

const BIN = fileURLToPath(new URL("../bin/depthfinder.mjs", import.meta.url));
const RUNNING = join(CACHE_DIR, "judge-running.json");
const RESULT_RE = /^judge-\d{4}-\d{2}.*Z\.json$/; // judge-<ISO>.json only

export const INSTRUCTIONS = {
  summary:
    "The Semantic Honesty judge runs your installed AI agent (claude, else codex) read-only over the repo (1–3 min, costs agent tokens) to catch doc claims that are stale or inverted even though every path resolves. Like Drift it calls a model, so it is manual and opt-in.",
  options: [
    {
      label: "Claude Code",
      steps: ["Install Claude Code so `claude` is on PATH", "npm i -g @anthropic-ai/claude-code  # or your usual install"],
    },
    {
      label: "Codex",
      steps: ["Install the Codex CLI so `codex` is on PATH", "Or set DEPTHFINDER_BURN_AGENT=\"<your agent cmd>\""],
    },
  ],
  thenRun: "Then click Run deep check, or run: npm run judge:run",
};

function latestResultFile() {
  ensureCache();
  const files = readdirSync(CACHE_DIR).filter((f) => RESULT_RE.test(f)).sort();
  return files.length ? join(CACHE_DIR, files[files.length - 1]) : null;
}

// Read-only status for the panel (GET /api/judge): running → cached → empty.
export function judgeStatus() {
  ensureCache();
  if (existsSync(RUNNING)) {
    try {
      const m = JSON.parse(readFileSync(RUNNING, "utf8"));
      return { status: "running", startedAt: m.startedAt, elapsedMs: Date.now() - new Date(m.startedAt).getTime() };
    } catch {}
  }
  const latest = latestResultFile();
  if (latest) {
    try {
      return JSON.parse(readFileSync(latest, "utf8"));
    } catch {}
  }
  const agent = resolveAgent();
  return {
    status: "empty",
    installed: !!agent,
    agent: agent ? agent.join(" ") : null,
    message: agent
      ? "An agent is installed, but no semantic-honesty run is cached yet."
      : "No local agent (claude/codex) found to run the semantic judge.",
    instructions: INSTRUCTIONS,
  };
}

// The actual run (manual, opt-in). Writes ONLY into .cache. Reuses the CLI's
// --judge path via a subprocess so all redaction/consent/discovery is shared.
export function runSemanticJudge() {
  ensureCache();
  const agent = resolveAgent();
  if (!agent)
    return { status: "not-installed", checkedAt: new Date().toISOString(), instructions: INSTRUCTIONS };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(RUNNING, JSON.stringify({ startedAt: new Date().toISOString(), agent: agent.join(" ") }));
  const started = Date.now();
  try {
    const res = spawnSync(
      process.execPath,
      [BIN, REPO_ROOT, "--judge", "--json", "--no-history"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 1000 * 60 * 8, maxBuffer: 64 * 1024 * 1024 },
    );
    let payload = null;
    let parseNote = null;
    try {
      payload = JSON.parse(res.stdout || "");
    } catch {
      parseNote = "CLI did not return valid JSON";
    }
    const judge = payload?.judge ?? null;
    const ok = res.status === 0 && judge && !judge.error;
    const record = {
      status: ok ? "ok" : judge?.error ? "error" : "empty",
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      agent: agent.join(" "),
      exitCode: res.status,
      error: judge?.error || (ok ? null : (res.stderr || "").slice(-1200) || "judge failed"),
      parseNote,
      // The verdict array + tallies (already redacted by the CLI's --json seam).
      judge: judge && !judge.error ? { findings: judge.findings, counts: judge.counts, summary: judge.summary } : null,
      health: payload?.dimensions?.health ?? null,
      scanned: payload?.scanned ?? [],
    };
    writeFileSync(join(CACHE_DIR, `judge-${ts}.json`), JSON.stringify(record, null, 2));
    return record;
  } finally {
    try {
      unlinkSync(RUNNING);
    } catch {}
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--status")) {
    process.stdout.write(JSON.stringify(judgeStatus(), null, 2) + "\n");
  } else {
    const agent = resolveAgent();
    if (!agent) {
      process.stderr.write("No local agent (claude/codex) found for the semantic judge.\n\n");
      process.stderr.write(INSTRUCTIONS.summary + "\n\n" + INSTRUCTIONS.thenRun + "\n");
      process.exitCode = 0;
    } else {
      process.stderr.write("Running the Semantic Honesty judge — your agent reads the repo (1–3 min, costs tokens)…\n");
      const r = runSemanticJudge();
      process.stderr.write(`judge ${r.status}${r.durationMs ? ` in ${Math.round(r.durationMs / 1000)}s` : ""} → .cache/\n`);
    }
  }
}
