#!/usr/bin/env node
// Deterministic stand-in for a real coding agent, for hermetic --burn tests.
// Reads the burn prompt (the final argv) and answers by "trusting" the rotten
// context line — it echoes back the first backticked path/name it sees, just
// as a real agent would treat the CLAUDE.md line as ground truth.
const prompt = process.argv[process.argv.length - 1] || "";
const m = prompt.match(/`([^`]+)`/);
const ref = m ? m[1] : "the referenced module";
process.stdout.write(`To do that, open ${ref} and start from the main export there.\n`);
