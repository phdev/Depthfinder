// Drift panel — Packmind context-evaluator orchestration.
//
// SLOW + COSTLY + SENDS REPO CONTENTS OFF-MACHINE: context-evaluator drives an
// installed AI agent CLI over the repo (1–3 min, costs API tokens). So this is
// a SEPARATE, manual, opt-in job — never run on page load. It writes a
// timestamped JSON under .cache/; the panel only ever reads the cache.
//
// This is the ONLY part of the tool permitted to send repo contents off-box.
import {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT, CACHE_DIR, ensureCache } from "../lib/repo.mjs";
import { redactDeep } from "../lib/redact.mjs";

const RUNNING = join(CACHE_DIR, "drift-running.json");
const RESULT_RE = /^drift-\d{4}-\d{2}.*Z\.json$/; // drift-<ISO>.json only

export const INSTRUCTIONS = {
  summary:
    "Packmind context-evaluator drives your installed AI agent over the repo (1–3 min, costs API tokens). It is the only feature that sends repo contents off-machine, so it is manual and opt-in.",
  repoUrl: "https://github.com/PackmindHub/context-evaluator",
  options: [
    {
      label: "Binary (standalone)",
      steps: [
        "Download a release from github.com/PackmindHub/context-evaluator",
        "chmod +x ./context-evaluator-<platform>",
        "export CONTEXT_EVALUATOR_BIN=/abs/path/to/context-evaluator-<platform>",
      ],
    },
    {
      label: "Source (Node 22+ & Bun)",
      steps: [
        "git clone https://github.com/PackmindHub/context-evaluator",
        "cd context-evaluator && bun install",
        "export CONTEXT_EVALUATOR_DIR=$(pwd)",
      ],
    },
  ],
  thenRun: "Then click Run drift, or run: npm run drift:refresh",
};

function onPath(name) {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
function hasBun() {
  return spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;
}

// How can we invoke context-evaluator on this machine?
export function detectEvaluator() {
  const binEnv = process.env.CONTEXT_EVALUATOR_BIN;
  if (binEnv && existsSync(binEnv)) return { installed: true, method: "binary", bin: binEnv };
  const onp = onPath("context-evaluator");
  if (onp) return { installed: true, method: "binary", bin: onp };
  const dir = process.env.CONTEXT_EVALUATOR_DIR;
  if (dir && existsSync(join(dir, "package.json")) && hasBun())
    return { installed: true, method: "source", dir };
  return {
    installed: false,
    bun: hasBun(),
    hint: "set CONTEXT_EVALUATOR_BIN or CONTEXT_EVALUATOR_DIR",
  };
}

function latestResultFile() {
  ensureCache();
  const files = readdirSync(CACHE_DIR).filter((f) => RESULT_RE.test(f)).sort();
  return files.length ? join(CACHE_DIR, files[files.length - 1]) : null;
}

// Read-only status for the panel (GET /api/drift).
export function driftStatus() {
  ensureCache();
  if (existsSync(RUNNING)) {
    try {
      const m = JSON.parse(readFileSync(RUNNING, "utf8"));
      return {
        status: "running",
        startedAt: m.startedAt,
        elapsedMs: Date.now() - new Date(m.startedAt).getTime(),
      };
    } catch {}
  }
  const latest = latestResultFile();
  if (latest) {
    try {
      return JSON.parse(readFileSync(latest, "utf8"));
    } catch {}
  }
  const det = detectEvaluator();
  return {
    status: "empty",
    installed: det.installed,
    method: det.method || null,
    message: det.installed
      ? "context-evaluator is installed, but no drift run is cached yet."
      : "Packmind context-evaluator is not installed.",
    instructions: INSTRUCTIONS,
  };
}

// The actual run (manual, opt-in). Writes ONLY into .cache.
export async function runDrift() {
  ensureCache();
  const det = detectEvaluator();
  if (!det.installed)
    return { status: "not-installed", checkedAt: new Date().toISOString(), instructions: INSTRUCTIONS };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outRaw = join(CACHE_DIR, `drift-raw-${ts}.json`);
  writeFileSync(RUNNING, JSON.stringify({ startedAt: new Date().toISOString(), method: det.method }));
  const started = Date.now();

  let cmd, args, opts;
  const common = ["cli", "evaluate", "--path", REPO_ROOT, "--report", "json", "-o", outRaw];
  if (det.method === "binary") {
    cmd = det.bin;
    args = [...common];
    opts = { encoding: "utf8", timeout: 1000 * 60 * 8, maxBuffer: 256 * 1024 * 1024 };
  } else {
    cmd = "bun";
    args = ["run", "evaluate", "--path", REPO_ROOT, "--report", "json", "-o", outRaw];
    opts = { cwd: det.dir, encoding: "utf8", timeout: 1000 * 60 * 8, maxBuffer: 256 * 1024 * 1024 };
  }
  if (process.env.CONTEXT_EVALUATOR_AGENT) args.push("--agent", process.env.CONTEXT_EVALUATOR_AGENT);

  try {
    const res = spawnSync(cmd, args, opts);
    let result = null;
    let parseNote = null;
    if (existsSync(outRaw)) {
      const txt = readFileSync(outRaw, "utf8");
      try {
        result = JSON.parse(txt);
      } catch {
        parseNote = "evaluator output was not valid JSON; captured raw head";
        result = { raw: txt.slice(0, 8000) };
      }
      try {
        unlinkSync(outRaw);
      } catch {}
    }
    const ok = res.status === 0 && result != null;
    const record = redactDeep({
      status: ok ? "ok" : "error",
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      method: det.method,
      command: `${cmd} ${args.join(" ")}`,
      exitCode: res.status,
      error: ok ? null : res.error?.message || (res.stderr || "").slice(-1500) || "evaluator failed",
      parseNote,
      result,
    });
    writeFileSync(join(CACHE_DIR, `drift-${ts}.json`), JSON.stringify(record, null, 2));
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
    process.stdout.write(JSON.stringify(driftStatus(), null, 2) + "\n");
  } else {
    const det = detectEvaluator();
    if (!det.installed) {
      process.stderr.write("Packmind context-evaluator is not installed.\n\n");
      process.stderr.write(INSTRUCTIONS.summary + "\n\n");
      for (const o of INSTRUCTIONS.options) {
        process.stderr.write(`• ${o.label}:\n`);
        for (const s of o.steps) process.stderr.write(`    ${s}\n`);
      }
      process.stderr.write(`\n${INSTRUCTIONS.thenRun}\n`);
      process.exitCode = 0;
    } else {
      process.stderr.write(
        "Running context-evaluator — sends repo contents to your AI agent (1–3 min, costs tokens)…\n",
      );
      runDrift().then((r) =>
        process.stderr.write(`drift ${r.status}${r.durationMs ? ` in ${Math.round(r.durationMs / 1000)}s` : ""} → .cache/\n`),
      );
    }
  }
}
