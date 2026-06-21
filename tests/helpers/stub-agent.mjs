#!/usr/bin/env node
// Deterministic stand-in for a real coding agent, for hermetic --burn tests.
// Reads the burn prompt (the final argv) and answers by "trusting" the rotten
// context line — it echoes back the first backticked path/name it sees, just
// as a real agent would treat the CLAUDE.md line as ground truth.
const prompt = process.argv[process.argv.length - 1] || "";

// --judge mode: the prompt carries the Semantic Honesty rubric. Emit a canned
// strict JSON verdict array + summary line so judge tests parse a real shape
// without making any model call. DEPTHFINDER_STUB_JUDGE=garbage emits
// unparseable prose to exercise the parser's error path.
if (/Semantic Honesty|model tier of Depthfinder/.test(prompt)) {
  if (process.env.DEPTHFINDER_STUB_JUDGE === "garbage") {
    process.stdout.write("I looked at the repo and everything seems fine, no JSON for you.\n");
    process.exit(0);
  }
  const findings = [
    {
      location: "CLAUDE.md:1",
      claim: "WebGPU backend is a skeleton, not yet wired into the build",
      verdict: "false",
      evidence: "RenderBackend_WebGPU.cpp is a 4k-line working backend and is the default renderer.",
      severity: "CRIT",
      fix: "Rewrite status: WebGPU is the shipped primary renderer.",
    },
    {
      location: "CLAUDE.md:2",
      claim: "Zero runtime dependencies",
      verdict: "holds",
      evidence: "package.json dependencies: {}.",
      severity: "LOW",
      fix: "none",
    },
  ];
  process.stdout.write(
    JSON.stringify(findings) +
      "\nSemantic Honesty: 2 state-claims · 1 hold · 0 stale · 1 false · 0 unknown.\n",
  );
  process.exit(0);
}

// The rotten target is the LAST backticked token on the quoted line (the
// claim's subject), not an incidental path earlier in the sentence.
const all = [...prompt.matchAll(/`([^`]+)`/g)];
const ref = all.length ? all[all.length - 1][1] : "the referenced module";
// DEPTHFINDER_STUB_DETOUR=1 makes the stub "catch" the lie and propose checks,
// exercising the verification-detour tax path.
const detour = process.env.DEPTHFINDER_STUB_DETOUR
  ? " That file may be stale though — I'd grep and find to confirm it exists before editing."
  : "";
process.stdout.write(`To do that, use ${ref} and start from the main export there.${detour}\n`);
