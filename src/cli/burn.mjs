// Live Burn (V1.1) — the attribution moment, made undeniable.
//
// V1.0 renders a TEMPLATED consequence ("an agent following this reference
// will find nothing and guess"). Burn replaces the template with what a REAL
// agent actually says: feed it the rotten context line + a question it would
// answer using that line, run it in an EMPTY temp dir (so any tool use finds
// nothing and it must answer from the rotten ground truth), and capture the
// reply — which confidently names the dead path. That quote is the receipt.
//
// OQ4 (resolved): shadow a local agent CLI already on PATH (claude, else
// codex), overridable via DEPTHFINDER_BURN_AGENT / --burn-agent. Zero new
// deps, no API keys in Depthfinder, and it sends nothing the user's own agent
// doesn't already send. This is the FIRST path that calls a model — strictly
// opt-in (the --burn flag is consent), bounded by a timeout, redaction applied
// by the caller at the render/serializer seam.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "../../lib/redact.mjs";

// Known agents and how to invoke them non-interactively. The prompt is
// appended as the final argument.
const KNOWN = [
  { bin: "claude", cmd: ["claude", "-p"] },
  { bin: "codex", cmd: ["codex", "exec"] },
];

function onPath(bin) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [bin], { encoding: "utf8", windowsHide: true });
  return r.status === 0;
}

// Resolve the burn agent as an argv prefix (command minus the prompt), or null
// if none is available. Precedence: explicit override > env > PATH autodetect.
export function resolveAgent({ agentCmd, env = process.env } = {}) {
  const explicit = agentCmd || env.DEPTHFINDER_BURN_AGENT;
  if (explicit && explicit.trim()) return explicit.trim().split(/\s+/);
  for (const k of KNOWN) if (onPath(k.bin)) return k.cmd;
  return null;
}

// The question an agent would answer using a rotten claim of this kind.
function question(finding) {
  switch (finding.oracle) {
    case "path":
      return "Which file should I open to work on this, and what will I find in it?";
    case "dependency":
      return "Which package should I import or install for this, and how do I call it?";
    case "count":
      return `Exactly how many ${finding.predicate.args.noun} are there, and where are they defined?`;
    case "symbol":
      return "Which function should I call for this, and from which file?";
    default:
      return "Based on the line above, what should I do?";
  }
}

// A self-contained prompt: the rotten line as ground truth + the question.
// The line is REDACTED before it leaves the process — burn is the only path
// that sends context to a model, so secrets in the line must never go out
// (1A applies to the burn INPUT, not just its output).
export function buildBurnPrompt(finding) {
  return [
    "A project's CLAUDE.md — the file an AI coding assistant treats as ground",
    "truth — contains this line:",
    "",
    `    ${redact(finding.text.trim())}`,
    "",
    "Acting as that assistant, answer concisely (2-3 sentences), naming any",
    "specific files, paths, or packages you would use:",
    "",
    `    ${question(finding)}`,
  ].join("\n");
}

// Run the shadow agent against one finding. Returns
//   { agent, prompt, output }            on success
// | { agent?, error }                    on no-agent / timeout / failure
// Never throws; the caller treats any error as "burn skipped".
export function runBurn(finding, { agent, timeout = 60000 } = {}) {
  if (!agent) return { error: "no agent found (install claude or codex, or set DEPTHFINDER_BURN_AGENT)" };
  const label = agent.join(" ");
  const prompt = buildBurnPrompt(finding);
  const tmp = mkdtempSync(join(tmpdir(), "df-burn-"));
  try {
    const r = spawnSync(agent[0], [...agent.slice(1), prompt], {
      cwd: tmp, // empty dir: the agent can't explore a repo, so it answers from the rotten line
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    if (r.error)
      return { agent: label, error: r.error.code === "ETIMEDOUT" ? "agent timed out" : (r.error.code || r.error.message) };
    if (r.status !== 0)
      return { agent: label, error: `agent exited ${r.status}${r.stderr ? `: ${r.stderr.trim().slice(0, 120)}` : ""}` };
    const output = (r.stdout || "").trim();
    return output ? { agent: label, prompt, output } : { agent: label, error: "agent returned an empty response" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
