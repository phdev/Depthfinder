// `--triage` — interactive hotspot selector that hands a fix to the harness.
//
// A HUMAN runs `npx depthfinder --triage` in a real terminal: arrow through the
// hotspots, Enter to pick one, and depthfinder detects the coding harness on
// PATH (claude, else codex, else $DEPTHFINDER_BURN_AGENT — the same resolver as
// --burn), PRINTS the exact command, asks y/N, then hands off to an INTERACTIVE
// harness session seeded with a targeted fix prompt, in the current repo.
//
// Posture: same as --burn. depthfinder spawns a tool the user already runs, with
// a prompt built from the (redacted) rotted line + git evidence; nothing is sent
// anywhere the user's own agent doesn't already send. It is TTY-gated by the
// caller (bin) — never runs in CI / pipes / --json, so it can't wedge a script.
//
// The pure pieces (buildFixPrompt / interactiveArgv / triageRows) are exported
// and unit-tested; runTriage is the raw-mode loop and takes injectable deps.
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { redact } from "../../lib/redact.mjs";
import { fixHint, criticality } from "./templates.mjs";
import { resolveColor } from "./color.mjs";

const RESET = "\x1b[0m";
// Standard 16-color SGR — vivid + universally supported (matches render.mjs).
const CRIT_COLOR = { CRIT: "\x1b[91m", HIGH: "\x1b[33m", MED: "\x1b[36m", LOW: "\x1b[90m" };
const GAIN_COLOR = "\x1b[32m";
const PTR_COLOR = "\x1b[92m";

// The fix instruction handed to the harness for one hotspot. The rotted line is
// REDACTED before it leaves the process (1A applies to the triage INPUT, like
// burn). Deterministic: claim + git evidence + the deterministic fix hint, with
// an explicit "don't invent a target" guard so the agent fixes the doc honestly.
export function buildFixPrompt(finding) {
  const loc = `${finding.source.file}:${finding.source.line}`;
  const ev = finding.evidence?.summary || "the repository contradicts it";
  const hint = fixHint(finding) || "correct or remove the claim";
  return [
    `A line in this project's AI context file (${loc}) is no longer true:`,
    "",
    `    ${redact(finding.text.trim())}`,
    "",
    `Evidence: ${ev}.`,
    `Fix it in ${finding.source.file}: ${hint}.`,
    "Do not invent a replacement — if the real target is unknown, remove the line",
    "rather than guess. Change only this claim.",
  ].join("\n");
}

// resolveAgent() returns the HEADLESS invocation (claude -p, codex exec). Triage
// wants an INTERACTIVE session, so drop the headless subcommand for the agents
// we know; pass a custom DEPTHFINDER_BURN_AGENT through unchanged.
const HEADLESS_SUB = { claude: "-p", codex: "exec" };
export function interactiveArgv(agent) {
  if (!Array.isArray(agent) || !agent.length) return agent;
  const [bin, ...rest] = agent;
  if (HEADLESS_SUB[bin] && rest[0] === HEADLESS_SUB[bin]) return [bin, ...rest.slice(1)];
  return agent;
}

function subjectOf(f) {
  const a = f.predicate?.args || {};
  if (a.path) return a.path;
  if (a.name) return a.name;
  if (a.symbol) return a.symbol;
  if (a.n != null) return `${a.n} ${a.noun || ""}`.trim();
  return (f.text || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// Pure list model for the selector — one row per hotspot, in render order.
export function triageRows(findings, gain = null) {
  return findings.map((f, i) => ({
    i,
    tag: criticality(f),
    loc: `${f.source.file}:${f.source.line}`,
    subj: subjectOf(f),
    gain: gain ? `Honesty +${gain.perFix.honesty}` : "",
    finding: f,
  }));
}

// Interactive loop. Resolves when the user quits or a fix is handed off. Deps are
// injectable for tests; defaults are the real stdin/stdout + spawnSync.
export function runTriage(findings, {
  gain = null,
  agent = null,
  repoRoot = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  spawn = spawnSync,
  env = process.env,
} = {}) {
  return new Promise((resolve) => {
    if (!findings.length) { output.write("  No hotspots to triage — your context is clean.\n"); resolve(); return; }
    const rows = triageRows(findings, gain);
    const color = resolveColor({ env, isTTY: output.isTTY });
    const paint = (s, code) => (color && code ? `${code}${s}${RESET}` : s);
    let idx = 0;
    let rendered = 0;

    const draw = () => {
      if (rendered) output.write(`\x1b[${rendered}A\x1b[0J`);
      const lines = [];
      lines.push(`  ${rows.length} hotspot${rows.length === 1 ? "" : "s"} · ↑/↓ move · enter to fix · q to quit`);
      lines.push("");
      for (const r of rows) {
        const sel = r.i === idx;
        const ptr = sel ? paint("›", PTR_COLOR) : " ";
        const tag = paint(`[${r.tag}]`, CRIT_COLOR[r.tag]);
        const g = r.gain ? `  ${paint(`(${r.gain})`, GAIN_COLOR)}` : "";
        lines.push(`  ${ptr} ${r.i + 1}. ${tag} ${r.loc}  ${r.subj}${g}`);
      }
      output.write(lines.join("\n") + "\n");
      rendered = lines.length;
    };

    const cleanup = () => {
      if (input.isTTY && input.setRawMode) input.setRawMode(false);
      input.removeListener("keypress", onKey);
    };

    const finish = (msg) => { cleanup(); if (msg) output.write(msg); input.pause?.(); resolve(); };

    const select = () => {
      const f = rows[idx].finding;
      const prompt = buildFixPrompt(f);
      cleanup();
      const indented = "\n" + prompt.split("\n").map((l) => `      ${l}`).join("\n") + "\n";
      if (!agent) {
        finish(`\n  No harness on PATH (install claude or codex, or set DEPTHFINDER_BURN_AGENT).\n  Paste this into your agent:\n${indented}`);
        return;
      }
      const argv = interactiveArgv(agent);
      output.write(`\n  Will run in ${argv[0]}, in this repo:\n${indented}`);
      const rl = readline.createInterface({ input, output });
      rl.question(`\n  run in ${argv[0]}? [y/N] `, (ans) => {
        rl.close();
        if (!/^y(es)?$/i.test(ans.trim())) { finish("  cancelled — nothing was run.\n"); return; }
        output.write(`\n  → handing off to ${argv.join(" ")} …\n\n`);
        try { spawn(argv[0], [...argv.slice(1), prompt], { cwd: repoRoot, stdio: "inherit", env }); }
        catch (e) { output.write(`  could not launch ${argv[0]}: ${e?.message || e}\n`); }
        finish("");
      });
    };

    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === "up" || key.name === "k") { idx = (idx - 1 + rows.length) % rows.length; draw(); }
      else if (key.name === "down" || key.name === "j") { idx = (idx + 1) % rows.length; draw(); }
      else if (key.name === "return" || key.name === "enter") select();
      else if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) finish("  done.\n");
    };

    readline.emitKeypressEvents(input);
    if (input.isTTY && input.setRawMode) input.setRawMode(true);
    input.resume?.();
    input.on("keypress", onKey);
    draw();
  });
}
