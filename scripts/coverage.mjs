// Eval coverage generator.
//
// Read-only: parses context/rules.yaml, openclaw/eval/results/*.json, and the
// GitHub workflows to build a rule × protecting-artifact × in-CI matrix.
// EXPECT GAPS — agentci:gate / eval:score / eval:taxonomy run in no workflow,
// and that is the point.
//
// runGate() additionally executes the (deterministic, offline) AgentCI gate —
// writing its report AND golden snapshot into .cache only (never the repo) —
// so the deterministic_slice_replayable row shows a real, live PASS/FAIL.
import {
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  REPO_ROOT,
  TOOL_DIR,
  CACHE_DIR,
  ensureCache,
  walk,
  readRepoText,
  repoExists,
  repoPath,
} from "../lib/repo.mjs";
import { parseYaml } from "../lib/yaml-mini.mjs";
import { redactDeep } from "../lib/redact.mjs";

const CACHE = join(CACHE_DIR, "coverage.json");
const GATE_CACHE = join(CACHE_DIR, "gate-result.json");

const GATE_FIXTURES = [
  "agentci/fixtures/school-updates-digest.json",
  "agentci/fixtures/school-updates-digest-with-agent.json",
  "agentci/fixtures/morning-runway.json",
  "agentci/fixtures/morning-school-priority.json",
  "agentci/fixtures/school-needs-action-with-suggestion.json",
];

// ── workflow (in-CI) parsing ───────────────────────────────────────────────
function parseCi() {
  const jobs = [];
  for (const rel of walk(".github/workflows", { exts: [".yml", ".yaml"] })) {
    const text = readRepoText(rel) || "";
    const wf = rel.split("/").pop();
    let inJobs = false;
    let cur = null;
    const push = () => cur && (jobs.push(cur), (cur = null));
    for (const line of text.split("\n")) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
        continue;
      }
      if (!inJobs) continue;
      const jm = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (jm) {
        push();
        cur = { id: jm[1], name: jm[1], wf, runText: "" };
        continue;
      }
      if (cur) {
        const nm = line.match(/^ {4}name:\s*(.+)$/);
        if (nm) cur.name = nm[1].replace(/^["']|["']$/g, "");
        cur.runText += line + "\n";
      }
    }
    push();
  }
  return jobs;
}

// ── reminder-timing assertion check (spec: confirm a case asserts it) ───────
function reminderTimingCheck() {
  const t = readRepoText("src/state/deriveState.test.js") || "";
  const lines = t.split("\n");
  const evidence = [];
  for (const line of lines)
    if (/bedtimeReminderActive/.test(line) && /toBe|toEqual|expect/.test(line))
      evidence.push(line.trim());
  const itNames = [
    ...t.matchAll(
      /it\(\s*["'`]([^"'`]*(?:bedtime|minutes? before|reminder|deterministic)[^"'`]*)["'`]/gi,
    ),
  ].map((m) => m[1]);
  return {
    asserted: evidence.length > 0 && itNames.length > 0,
    assertionCount: evidence.length,
    cases: itNames.slice(0, 6),
    sample: evidence.slice(0, 3),
  };
}

// ── existing eval results ───────────────────────────────────────────────────
function evalResults() {
  const out = [];
  for (const rel of walk("openclaw/eval/results", { exts: [".json"] })) {
    try {
      const j = JSON.parse(readRepoText(rel));
      out.push({
        file: rel,
        keys: Array.isArray(j) ? `array(${j.length})` : Object.keys(j || {}).slice(0, 8),
        generatedAt: j?.generatedAt || j?.timestamp || j?.date || null,
      });
    } catch {
      out.push({ file: rel, error: "parse error" });
    }
  }
  return out;
}

async function ollamaUp() {
  try {
    const r = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(800),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function pkgScripts() {
  try {
    return JSON.parse(readRepoText("package.json") || "{}").scripts || {};
  } catch {
    return {};
  }
}

// ── main read-only scan ─────────────────────────────────────────────────────
export async function generateCoverage() {
  const warnings = [];
  // rules.yaml is the tool's OWN authored config (it ships in this repo), not
  // a file in the analyzed repo.
  const rulesPath = join(TOOL_DIR, "context", "rules.yaml");
  const rulesDoc = existsSync(rulesPath)
    ? parseYaml(readFileSync(rulesPath, "utf8"))
    : { rules: [] };
  if (!rulesDoc.rules?.length) warnings.push(`no rules parsed from ${rulesPath}`);

  const jobs = parseCi();
  const allRun = jobs.map((j) => j.runText).join("\n");
  const testJobs = jobs
    .filter((j) => /\bnpm test\b|\bnpm run verify\b|\bvitest\b/.test(j.runText))
    .map((j) => ({ name: j.name, workflow: j.wf }));
  const gateInCI = /agentci/.test(allRun);
  const evalInCI = /eval:score|eval:taxonomy|eval\/runner/.test(allRun);
  const scripts = pkgScripts();

  const classify = (artifact) => {
    const isJob = !artifact.includes("/") && artifact.includes(":");
    if (isJob) {
      return {
        artifact,
        kind: "gate",
        exists: !!scripts[artifact],
        inCI: gateInCI,
        ciJobs: [],
      };
    }
    return {
      artifact,
      kind: "test",
      exists: repoExists(artifact),
      inCI: testJobs.length > 0,
      ciJobs: testJobs.map((t) => t.name),
    };
  };

  const rules = (rulesDoc.rules || []).map((r) => {
    const protects = (r.protects || []).map(classify);
    const allExist = protects.every((p) => p.exists);
    const allInCI = protects.every((p) => p.inCI);
    const anyInCI = protects.some((p) => p.inCI);
    let status = "protected-in-ci";
    if (!allExist) status = "missing-artifact";
    else if (!anyInCI) status = "not-in-ci";
    else if (!allInCI) status = "partially-in-ci";
    return {
      id: r.id,
      description: r.description,
      severity: r.severity || null,
      asserts: r.asserts || null,
      protects,
      allExist,
      allInCI,
      anyInCI,
      status,
    };
  });

  const results = evalResults();
  const gate = existsSync(GATE_CACHE)
    ? JSON.parse(readFileSync(GATE_CACHE, "utf8"))
    : null;

  const availability = {
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    openaiKey: !!process.env.OPENAI_API_KEY,
    groqKey: !!process.env.GROQ_API_KEY,
    ollamaUp: await ollamaUp(),
  };
  availability.anyLiveTier =
    availability.anthropicKey ||
    availability.openaiKey ||
    availability.groqKey ||
    availability.ollamaUp;

  const ciGaps = [];
  for (const s of ["agentci:gate", "eval:score", "eval:taxonomy"])
    if (!allRun.includes(s)) ciGaps.push(s);

  return redactDeep({
    generatedAt: new Date().toISOString(),
    rules,
    ci: { testJobs, gateInCI, evalInCI, gaps: ciGaps },
    evalResults: results,
    evalResultsEmpty: results.length === 0,
    evalAvailability: availability,
    reminderTiming: reminderTimingCheck(),
    gate,
    warnings,
  });
}

export async function writeCoverage() {
  ensureCache();
  const data = await generateCoverage();
  writeFileSync(CACHE, JSON.stringify(data, null, 2));
  return data;
}

// ── real gate run (writes ONLY to .cache) ───────────────────────────────────
export async function runGate() {
  // gate.js reads fixtures + scans src/core/agentci with RELATIVE paths, so it
  // must run from the repo root. We redirect its report + golden snapshot into
  // .cache via absolute paths, so the repo is never written.
  process.chdir(REPO_ROOT);
  ensureCache();
  const cacheRuns = join(CACHE_DIR, "agentci-runs");
  const cacheReports = join(CACHE_DIR, "agentci-reports");
  mkdirSync(cacheRuns, { recursive: true });
  mkdirSync(cacheReports, { recursive: true });
  // copy committed goldens in so golden comparison still happens (read-only)
  for (const rel of walk("agentci/runs", { exts: [".json"] })) {
    try {
      copyFileSync(repoPath(rel), join(cacheRuns, basename(rel)));
    } catch {}
  }

  const { runAgentCiGate } = await import(
    pathToFileURL(repoPath("src/core/agentci/gate.js")).href
  );

  const fixtures = [];
  for (const fx of GATE_FIXTURES) {
    if (!repoExists(fx)) {
      fixtures.push({ fixture: fx, missing: true, passed: false });
      continue;
    }
    try {
      const r = await runAgentCiGate(fx, {
        reportPath: join(cacheReports, `${basename(fx, ".json")}.md`),
        runsDir: cacheRuns,
      });
      const total = r.assertions.length;
      const passedCount = r.assertions.filter((a) => a.passed).length;
      fixtures.push({
        fixture: fx,
        scenarioId: r.snapshot?.metadata?.scenarioId || basename(fx, ".json"),
        passed: r.passed,
        assertions: { total, passed: passedCount },
        replayMatches: r.replay?.matches ?? null,
        forbiddenCalls: r.forbiddenCalls?.length ?? 0,
        reportPath: r.reportPath,
      });
    } catch (e) {
      fixtures.push({ fixture: fx, passed: false, error: String(e?.message || e) });
    }
  }

  const result = {
    ran: true,
    at: new Date().toISOString(),
    passed: fixtures.every((f) => f.passed),
    fixtures,
    note: "Deterministic offline replay. Report + goldens written to .cache only (never the analyzed repo).",
  };
  writeFileSync(GATE_CACHE, JSON.stringify(result, null, 2));
  return redactDeep(result);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--run-gate")) {
    runGate()
      .then((r) => process.stdout.write(JSON.stringify(r)))
      .catch((e) => {
        process.stdout.write(JSON.stringify({ ran: false, error: String(e?.message || e) }));
        process.exitCode = 1;
      });
  } else {
    writeCoverage().then((d) => {
      process.stderr.write(`coverage → ${CACHE}\n`);
      for (const r of d.rules)
        process.stderr.write(`  ${r.status.padEnd(18)} ${r.id}\n`);
      process.stderr.write(
        `  CI gaps: ${d.ci.gaps.join(", ") || "none"} | eval results: ${d.evalResults.length} | live tier: ${d.evalAvailability.anyLiveTier}\n`,
      );
    });
  }
}
