// Summary / triage board (Tab 0).
//
// Aggregates the other four panels (map, tokens, coverage, drift), runs a
// small scoring pass, and emits a severity-ranked list of the highest-priority
// things to resolve — each deep-linked to the tab that proves it. Re-derives
// from live data, so it never goes stale.
import { generateMap } from "./context-map.mjs";
import { readTokens } from "./token-budget.mjs";
import { generateCoverage } from "./coverage.mjs";
import { driftStatus } from "./drift-refresh.mjs";
import { redactDeep } from "../lib/redact.mjs";

const SEV_RANK = { high: 0, medium: 1, low: 2 };
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export async function generateSummary() {
  const map = generateMap();
  const tokens = readTokens();
  const coverage = await generateCoverage();
  const drift = driftStatus();

  const issues = [];
  const add = (severity, title, detail, tab, action) =>
    issues.push({ severity, title, detail, tab, action });

  // ── tokens ──
  const cm = tokens.callouts.claudeMd;
  if (cm.over)
    add(
      "high",
      `CLAUDE.md is ${cm.ratio.toFixed(1)}× over the always-loaded budget`,
      `${cm.tokens.toLocaleString()} tokens vs a ${cm.budget.toLocaleString()} target — every session pays this on load.`,
      2,
      "Split or trim CLAUDE.md (the Wake Word + Voice Service section is the bulk).",
    );
  const rf = tokens.callouts.readFirst;
  if (rf.over)
    add(
      "high",
      "Read-first bundle is over budget",
      `${rf.tokens.toLocaleString()} vs ${rf.budget.toLocaleString()} tokens.`,
      2,
      "Trim the largest read-first docs.",
    );
  else {
    const biggest = (rf.files || []).slice().sort((a, b) => b.tokens - a.tokens)[0];
    if (biggest && rf.tokens && biggest.tokens / rf.tokens > 0.4)
      add(
        "low",
        `${biggest.path.split("/").pop()} is ~${Math.round((biggest.tokens / rf.tokens) * 100)}% of the read-first bundle`,
        `${biggest.tokens.toLocaleString()} of ${rf.tokens.toLocaleString()} tokens — under budget, but watch as it grows.`,
        2,
        "Keep an eye on it; consider summarizing older entries.",
      );
  }

  // ── coverage ── (friendly subject lines so issue titles read cleanly)
  const RULE_SUBJECT = {
    deterministic_slice_replayable: "AgentCI gate",
    enhance_not_decide: "Enhance-not-decide rule",
    visibility_is_derived_only: "Derived-only visibility rule",
    reminder_timing_deterministic: "Reminder-timing rule",
  };
  const subj = (id) => RULE_SUBJECT[id] || id;
  for (const r of coverage.rules) {
    if (r.status === "not-in-ci") {
      const gateNote =
        coverage.gate?.ran
          ? ` Gate passes locally (${coverage.gate.fixtures.filter((f) => f.passed).length}/${coverage.gate.fixtures.length}).`
          : "";
      add(
        r.severity === "critical" || r.severity === "high" ? "high" : "medium",
        `${subj(r.id)} isn't enforced in CI`,
        `Protected by ${r.protects.map((p) => p.artifact).join(", ")} — runs in no workflow.${gateNote}`,
        3,
        "Add the gate/eval to a workflow (it's offline and fast).",
      );
    } else if (r.status === "missing-artifact") {
      add(
        "high",
        `${subj(r.id)} is missing a protecting test`,
        `${r.protects.filter((p) => !p.exists).map((p) => p.artifact).join(", ")} not found.`,
        3,
        "Restore the test or fix the path in context/rules.yaml.",
      );
    }
  }
  if (coverage.reminderTiming && coverage.reminderTiming.asserted === false)
    add(
      "medium",
      "reminder_timing_deterministic has no asserting test case",
      "rules.yaml claims an assertion the test file doesn't actually make.",
      3,
      "Add a deterministic bedtime-window assertion, or correct rules.yaml.",
    );
  if (coverage.evalResultsEmpty)
    add(
      "medium",
      "No eval results recorded",
      `openclaw/eval/results/ is empty; eval:score / eval:taxonomy run in no workflow.${coverage.evalAvailability.ollamaUp ? " Local Ollama tier is reachable now." : ""}`,
      3,
      "Run npm run eval:score to capture a baseline.",
    );

  // ── map (dangling / duplicates) ──
  const isCodeDoc = (p) => /\.test\.js$|^src\//.test(p) || (/^docs\//.test(p) && !/\.log$|\/logs\//.test(p));
  const codeDangling = map.danglingRefs.filter((d) => isCodeDoc(d.path));
  const otherDangling = map.danglingRefs.filter((d) => !isCodeDoc(d.path));
  for (const d of codeDangling)
    add(
      "medium",
      "Stale reference to a non-existent path",
      `${d.source} → ${d.path}`,
      1,
      "Fix or remove the reference.",
    );
  if (otherDangling.length)
    add(
      "low",
      `${otherDangling.length} dangling reference${otherDangling.length > 1 ? "s" : ""} to runtime/local files`,
      otherDangling.map((d) => d.path).join(", "),
      1,
      "Expected for logs / local config — confirm none are real.",
    );
  if (map.summary.duplicatePairs > 0)
    add(
      "low",
      `${map.summary.duplicatePairs} duplicated doc block${map.summary.duplicatePairs > 1 ? "s" : ""}`,
      "A substantial block appears verbatim in ≥2 files.",
      1,
      "Dedupe if it's accidental drift.",
    );

  // ── drift ──
  if (drift.status === "empty" || drift.status === "not-installed")
    add(
      "low",
      drift.installed ? "Drift never run" : "Packmind drift not set up",
      drift.installed
        ? "No context-evaluator run is cached yet."
        : "context-evaluator is not installed — no external context-quality signal.",
      4,
      drift.installed ? "Run npm run drift:refresh." : "Install Packmind (see Tab 4).",
    );

  issues.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  // ── health strip ──
  const rulesInCi = coverage.rules.filter((r) => r.status === "protected-in-ci").length;
  const health = [
    {
      label: "CLAUDE.md budget",
      value: `${cm.tokens.toLocaleString()} / ${cm.budget.toLocaleString()}`,
      status: cm.over ? "bad" : "good",
      tab: 2,
    },
    {
      label: "Read-first budget",
      value: `${rf.tokens.toLocaleString()} / ${rf.budget.toLocaleString()}`,
      status: rf.over ? "bad" : "good",
      tab: 2,
    },
    {
      label: "Rules in CI",
      value: `${rulesInCi}/${coverage.rules.length}`,
      status: rulesInCi === coverage.rules.length ? "good" : "warn",
      tab: 3,
    },
    {
      label: "Dangling refs",
      value: String(map.summary.danglingCount),
      status: map.summary.danglingCount ? "warn" : "good",
      tab: 1,
    },
    {
      label: "AgentCI gate",
      value: coverage.gate?.ran ? (coverage.gate.passed ? "pass" : "fail") : "not run",
      status: coverage.gate?.ran ? (coverage.gate.passed ? "good" : "bad") : "muted",
      tab: 3,
    },
    {
      label: "Drift",
      value: drift.status === "ok" ? ago(drift.ranAt) : drift.installed ? "never run" : "not set up",
      status: drift.status === "ok" ? "good" : "muted",
      tab: 4,
    },
  ];

  // ── positives ──
  const healthy = [];
  if (rulesInCi) healthy.push(`${rulesInCi}/${coverage.rules.length} rules protected & in CI`);
  if (coverage.reminderTiming?.asserted)
    healthy.push(`reminder-timing asserted ×${coverage.reminderTiming.assertionCount}`);
  if (!rf.over) healthy.push("read-first bundle under budget");
  if (coverage.gate?.ran && coverage.gate.passed)
    healthy.push(`AgentCI gate passes ${coverage.gate.fixtures.length}/${coverage.gate.fixtures.length}`);
  const memPop = map.nodes.filter((n) => n.type === "memory_store" && n.meta?.populated).length;
  healthy.push(memPop ? `${memPop} memory stores populated` : "all memory stores empty (no leakage risk)");

  return redactDeep({
    generatedAt: new Date().toISOString(),
    counts: {
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low").length,
    },
    health,
    issues,
    healthy,
  });
}
