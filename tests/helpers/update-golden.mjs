// Regenerate the golden card (eng review 10A): npm run snapshot:update
// Run this ONLY when a render change is intentional — the diff is the review.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { materialize, runCli, cleanup } from "./fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "golden", "dirty-card.txt");

const root = materialize("dirty");
try {
  const r = runCli(root);
  if (r.code !== 0) {
    process.stderr.write(`depthfinder exited ${r.code}:\n${r.stderr}\n`);
    process.exit(1);
  }
  mkdirSync(dirname(GOLDEN), { recursive: true });
  writeFileSync(GOLDEN, r.stdout);
  process.stderr.write(`golden card updated: ${GOLDEN}\n`);
} finally {
  cleanup(root);
}
