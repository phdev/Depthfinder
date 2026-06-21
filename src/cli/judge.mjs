// Semantic Honesty judge (V1.6) — the MODEL TIER of Depthfinder.
//
// The deterministic core verifies paths, dependency names, and counts. It
// structurally CANNOT decide whether a doc's state-of-the-world narrative still
// matches the code: the failure where every path resolves but the prose is
// stale or inverted (describes shipped, default-on code as an unbuilt plan; or
// architecture A while the code uses B). A doc can have 100% valid paths and be
// 100% false. That judgment needs a model with repo access.
//
// So --judge is the SECOND consent-gated model path (alongside --burn): opt-in,
// it shadows a local agent CLI already on PATH (claude, else codex) and runs it
// INSIDE the repo with READ-ONLY tools (Read/Grep/Glob/Bash) so it can gather
// the grep/read/git_log evidence the rubric demands — then returns a strict
// JSON verdict array. Like --burn it sends nothing the user's own agent doesn't
// already see, prints a consent contract first, and redacts the doc text it
// embeds. Tests inject a stub agent (DEPTHFINDER_BURN_AGENT) so CI makes no real
// model call.
import { spawnSync } from "node:child_process";
import { redact } from "../../lib/redact.mjs";

// 16-color SGR, matching render.mjs (vivid + universally supported).
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
// Verdict → color: false is the worst (an agent acts on a lie), stale next,
// holds is good, unknown is neutral. Mirrors the deterministic tiers.
const VERDICT_COLOR = {
  false: "\x1b[91m", // bright red
  stale: "\x1b[33m", // amber
  holds: "\x1b[32m", // green
  unknown: "\x1b[90m", // gray
};
const SEV_COLOR = { CRIT: "\x1b[91m", HIGH: "\x1b[33m", LOW: "\x1b[90m" };

// The judge rubric. Kept close to a hand-authored prompt: it tells the model to
// gather concrete evidence before ruling, to prefer a missed finding over a
// false accusation (matching the deterministic core's unknown-never-false
// contract), and to emit ONLY a strict JSON array + one summary line so the
// output parses deterministically.
export const JUDGE_RUBRIC = `You are the model tier of Depthfinder. The deterministic pass already verified
paths, dependency names, and counts. Your job is the part it structurally
cannot do: decide whether a doc's STATE-OF-THE-WORLD claims still match the
actual code — including the failure mode where a doc is internally coherent and
every file reference resolves, but the narrative is stale or inverted (e.g. it
describes shipped, default-on code as an unbuilt plan; or describes architecture
A while the code uses architecture B). A doc can have 100% valid paths and still
be 100% false. Judge the MEANING, not the links.

REPO ACCESS: you are running inside the repository with read-only tools. Use
Grep, Read (with line ranges), Glob, and Bash (git log / git show only) as many
times as needed to gather evidence. Inspect the real code before ruling on any
claim. Do not rule from the doc alone.

Check ONLY load-bearing "current state" claims:
- Status / completeness: "X is done / not done / planned / a skeleton / stubbed
  / shipped / the default / removed".
- Architecture / mechanism: "uses A", "via B", "not yet wired in", "fails loud".
- Capability / behavior: "supports X", "X doesn't work", "default is Y", "N of M
  sites migrated".
- Quantitative state (sizes, call-site counts, feature counts) — but ONLY when
  you can actually open and inspect the code being counted.

Ignore (never accuse on these — precision over recall):
- Past-tense / historical narration: "we removed X", "originally we tried Y".
- Content explicitly marked plan / roadmap / future / superseded / appendix.
- Code examples, rationale, opinions, open design questions.
- Any claim whose ground truth is OUTSIDE inspectable tracked code — external
  services, or code that is gitignored / generated / only present in a build or
  patch tree you cannot read. These are unknown, not findings.

Per claim:
1. Quote the claim + its location (file:line).
2. Gather concrete evidence from the actual code. Cite it (file:line, grep hit,
   or git fact). No citation -> not a finding.
3. Verdict: holds (code confirms it) | stale (git/code shows it was once true,
   the system has moved past it) | false (inspectable code contradicts it and no
   evidence it was ever true) | unknown (cannot be verified from inspectable
   code — say so, do not guess).
4. Severity by how badly it would mislead an agent treating this doc as ground
   truth: CRIT (inverts the system's status or architecture) > HIGH > LOW.
5. One-line fix.

Hard rules:
- Evidence-first. If you would have to assume, output unknown.
- Prefer a missed finding to a false accusation. Never accuse without a citation.
- "Looks well-written / consistent" is not evidence it's true.

OUTPUT FORMAT — emit ONLY this, with NO preamble and NO markdown fences:
a single JSON array of objects, each
{"location","claim","verdict","evidence","severity","fix"}, followed by exactly
one line:
Semantic Honesty: <N> state-claims · <holds> hold · <stale> stale · <false> false · <unknown> unknown.`;

// Build the full prompt: the rubric + each DOC (path + REDACTED full text).
// Redaction applies to the INPUT here (1A) because --judge, like --burn, is a
// path that sends context to a model — secrets in the doc must never go out.
// The agent also reads the repo directly with its own tools; that is the same
// posture as the user's own agent (consent-gated), so it is not re-redacted.
export function buildJudgePrompt(docs) {
  const blocks = (docs || []).map(
    (d) => `DOC: ${d.path}\n${redact(String(d.text || "")).trimEnd()}`,
  );
  return `${JUDGE_RUBRIC}\n\n---\n\n${blocks.join("\n\n---\n\n")}\n`;
}

// Tally verdicts (for a summary line when the model omits one, and for the
// dashboard / --json consumers).
export function judgeCounts(findings) {
  const c = { total: 0, holds: 0, stale: 0, false: 0, unknown: 0 };
  for (const f of findings || []) {
    const v = String(f.verdict || "").toLowerCase();
    c.total++;
    if (v in c) c[v]++;
  }
  return c;
}

// Pull the strict JSON array out of an agent's stdout. Agents sometimes wrap it
// in a ```json fence or add a stray sentence despite instructions, so this is
// defensive: try the whole string, then a fenced block, then the widest
// bracket-balanced slice. Returns { findings, summary, raw } or { error, raw }.
export function parseJudgeOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { error: "agent returned an empty response", raw };
  const summaryMatch = text.match(/Semantic Honesty:[^\n]*/i);
  const summary = summaryMatch ? summaryMatch[0].trim() : null;

  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };

  // 1) whole thing  2) ```json fence  3) widest [ … ] slice
  let arr = tryParse(text);
  if (!arr) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) arr = tryParse(fence[1].trim());
  }
  if (!arr) {
    const first = text.indexOf("[");
    const last = text.lastIndexOf("]");
    if (first !== -1 && last > first) arr = tryParse(text.slice(first, last + 1));
  }
  if (!arr) return { error: "could not parse a JSON verdict array from the agent reply", raw };

  // Normalize verdict/severity casing; keep everything else as-is.
  const findings = arr
    .filter((f) => f && typeof f === "object")
    .map((f) => ({
      location: String(f.location || ""),
      claim: String(f.claim || ""),
      verdict: String(f.verdict || "unknown").toLowerCase(),
      evidence: String(f.evidence || ""),
      severity: String(f.severity || "").toUpperCase(),
      fix: String(f.fix || ""),
    }));
  return { findings, summary, raw };
}

// The known agents' read-only invocation. claude/codex need to be told they may
// use tools non-interactively; we scope them to READ-ONLY (no Write/Edit) so the
// judge can inspect but never mutate the repo. An explicit --judge-agent /
// DEPTHFINDER_JUDGE_AGENT override is passed through verbatim.
export function judgeAgentArgv(agent, { override } = {}) {
  if (override && override.trim()) return override.trim().split(/\s+/);
  const bin = agent[0];
  if (bin === "claude") {
    // -p headless; allow only read tools so it can grep/read/git without
    // prompting and without write capability.
    return ["claude", "-p", "--allowedTools", "Read Grep Glob Bash", "--permission-mode", "acceptEdits"];
  }
  if (bin === "codex") {
    // exec is non-interactive; read-only sandbox keeps it from mutating.
    return ["codex", "exec", "--sandbox", "read-only"];
  }
  return agent;
}

// Run the judge: spawn the agent IN the repo (cwd=repoRoot) with the prompt as
// the final arg; capture stdout; parse. Never throws — any failure is returned
// as { error } and the caller treats it as "judge skipped".
export function runJudge(docs, { agent, cwd, override, timeout } = {}) {
  if (!agent) return { error: "no agent found (install claude or codex, or set DEPTHFINDER_BURN_AGENT)" };
  // Default 5 min; large repos can need more — DEPTHFINDER_JUDGE_TIMEOUT (ms) overrides.
  timeout = timeout || Number(process.env.DEPTHFINDER_JUDGE_TIMEOUT) || 300000;
  const argv = judgeAgentArgv(agent, { override });
  const label = argv.join(" ");
  const prompt = buildJudgePrompt(docs);
  const r = spawnSync(argv[0], [...argv.slice(1), prompt], {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error)
    return { agent: label, error: r.error.code === "ETIMEDOUT" ? "agent timed out" : (r.error.code || r.error.message) };
  if (r.status !== 0)
    return { agent: label, error: `agent exited ${r.status}${r.stderr ? `: ${r.stderr.trim().slice(0, 160)}` : ""}` };
  const parsed = parseJudgeOutput(r.stdout);
  if (parsed.error) return { agent: label, error: parsed.error, raw: parsed.raw };
  return { agent: label, findings: parsed.findings, summary: parsed.summary, counts: judgeCounts(parsed.findings), raw: parsed.raw };
}

// Render the judge section for the terminal card. Verdict-colored, findings
// sorted worst-first (false > stale > unknown > holds). `color` defaults off so
// piped/redirected output is plain (same discipline as renderCard).
export function renderJudge(result, { color = false } = {}) {
  const paint = (s, code) => (color && code ? `${code}${s}${RESET}` : s);
  const lines = [];
  lines.push("");
  lines.push(paint("Semantic Honesty (model judge)", "\x1b[1m"));
  if (result.error) {
    lines.push(`  — judge skipped: ${result.error}`);
    return lines.join("\n");
  }
  const findings = result.findings || [];
  const order = { false: 0, stale: 1, unknown: 2, holds: 3 };
  const ranked = [...findings].sort(
    (a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9),
  );
  // Lead with the load-bearing findings (anything not "holds"); list holds
  // compactly so the section stays a triage view, not a wall.
  const issues = ranked.filter((f) => f.verdict !== "holds");
  const holds = ranked.filter((f) => f.verdict === "holds");
  if (!issues.length) lines.push(paint("  ✓ no stale or inverted state-claims found", VERDICT_COLOR.holds));
  for (const f of issues) {
    const tag = paint(f.verdict.toUpperCase(), VERDICT_COLOR[f.verdict]);
    const sev = f.severity ? " " + paint(f.severity, SEV_COLOR[f.severity] || DIM) : "";
    lines.push(`  ${tag}${sev}  ${f.location}`);
    if (f.claim) lines.push(`    “${truncate(f.claim, 100)}”`);
    if (f.evidence) lines.push(paint(`    ↳ ${truncate(f.evidence, 140)}`, DIM));
    if (f.fix) lines.push(paint(`    → fix: ${truncate(f.fix, 120)}`, "\x1b[32m"));
  }
  if (holds.length) lines.push(paint(`  ${holds.length} claim${holds.length === 1 ? "" : "s"} hold`, VERDICT_COLOR.holds));
  const c = result.counts || judgeCounts(findings);
  lines.push(
    `  Semantic Honesty: ${c.total} state-claim${c.total === 1 ? "" : "s"} · ${c.holds} hold · ${c.stale} stale · ${c.false} false · ${c.unknown} unknown`,
  );
  return lines.join("\n");
}

function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
