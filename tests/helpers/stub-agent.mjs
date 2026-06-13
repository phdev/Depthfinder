#!/usr/bin/env node
// Deterministic stand-in for a real coding agent, for hermetic --burn tests.
// Reads the burn prompt (the final argv) and answers by "trusting" the rotten
// context line — it echoes back the first backticked path/name it sees, just
// as a real agent would treat the CLAUDE.md line as ground truth.
const prompt = process.argv[process.argv.length - 1] || "";
// The rotten target is the LAST backticked token on the quoted line (the
// claim's subject), not an incidental path earlier in the sentence.
const all = [...prompt.matchAll(/`([^`]+)`/g)];
const ref = all.length ? all[all.length - 1][1] : "the referenced module";
process.stdout.write(`To do that, use ${ref} and start from the main export there.\n`);
