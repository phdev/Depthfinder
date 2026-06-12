// Claim evaluation — deterministic predicates vs repo state.
//
// Posture (design doc): unknown-never-false. When an oracle cannot decide
// safely it emits `unknown` (excluded from the score, never rendered as a
// finding). A false accusation from an honesty tool is fatal; a missed lie
// is acceptable.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const SYMBOL_FILE_CAP = 2000; // repo-wide search caps (design doc)
const SYMBOL_WALL_MS = 1000;
const POLYGLOT_MANIFESTS = ["requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile"];

export function evaluateClaims(claims, ctx) {
  // ctx: { root, index:Set<posixRel>, warn(msg) }
  const pkg = loadPackageManifests(ctx);
  const polyglot = POLYGLOT_MANIFESTS.some((f) => ctx.index.has(f));

  for (const claim of claims) {
    const { type, args } = claim.predicate;
    let r;
    if (type === "file_exists") r = evalPath(args, ctx);
    else if (type === "declared_dependency") r = evalDependency(args, ctx, pkg, polyglot);
    else if (type === "symbol_exported") r = evalSymbol(args, ctx);
    else if (type === "count_matches") r = evalCount(args, ctx);
    else r = { verdict: "unknown", summary: `unknown predicate ${type}` };
    claim.verdict = r.verdict;
    claim.evidence.summary = r.summary;
    claim.evidence.actual = r.actual ?? null;
    claim.evidence.checkedAt = ctx.now;
  }
  return claims;
}

// ── path ────────────────────────────────────────────────────────────────
function evalPath({ path }, ctx) {
  if (ctx.index.has(path)) return { verdict: "true", summary: "tracked file exists" };
  if (existsSync(join(ctx.root, path)))
    return { verdict: "unknown", summary: "present on disk but untracked (gitignored or not yet added)" };
  return { verdict: "false", summary: "no such tracked file" };
}

// ── dependency ──────────────────────────────────────────────────────────
function loadPackageManifests(ctx) {
  // All tracked package.json files, parsed lazily once; malformed -> warn,
  // recorded so the oracle can emit unknown instead of accusing (7A).
  const files = [...ctx.index].filter((p) => p === "package.json" || p.endsWith("/package.json"));
  const manifests = [];
  let malformed = 0;
  for (const rel of files) {
    try {
      const json = JSON.parse(readFileSync(join(ctx.root, rel), "utf8"));
      manifests.push({ rel, json });
    } catch {
      malformed++;
      ctx.warn(`malformed ${rel} — dependency claims may be undecidable`);
    }
  }
  return { manifests, malformed, none: files.length === 0 };
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function evalDependency({ name }, ctx, pkg, polyglot) {
  if (pkg.none) return { verdict: "unknown", summary: "no package.json in this repo (not an npm project)" };
  const declaredIn = [];
  for (const { rel, json } of pkg.manifests)
    for (const field of DEP_FIELDS)
      if (json[field] && Object.prototype.hasOwnProperty.call(json[field], name))
        declaredIn.push(`${rel} (${field})`);
  if (declaredIn.length) {
    // lockfile corroboration is warn-only (design doc)
    if (ctx.index.has("package-lock.json")) {
      try {
        const lock = readFileSync(join(ctx.root, "package-lock.json"), "utf8");
        if (!lock.includes(`"${name}"`)) ctx.warn(`${name} declared but absent from package-lock.json`);
      } catch { /* corroboration only */ }
    }
    return { verdict: "true", summary: `declared in ${declaredIn[0]}` };
  }
  if (pkg.malformed > 0)
    return { verdict: "unknown", summary: "a package.json failed to parse — cannot decide safely" };
  if (polyglot)
    return { verdict: "unknown", summary: "polyglot repo (non-npm manifests present) — name not in npm manifests" };
  return {
    verdict: "false",
    summary: `not in any package.json (checked ${pkg.manifests.length} manifest${pkg.manifests.length === 1 ? "" : "s"})`,
  };
}

// ── symbol ──────────────────────────────────────────────────────────────
const UNKNOWN_FORMS = /export\s*\*|export\s+default(?!\s+(async\s+)?(function|class)\b)|module\.exports/;

function exportMatchers(symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`export\\s+(default\\s+)?(async\\s+)?(function|class)\\s+${s}\\b`),
    new RegExp(`export\\s+(const|let|var)\\s+${s}\\b`),
    new RegExp(`export\\s+(type|interface|enum)\\s+${s}\\b`),
    new RegExp(`export\\s*\\{[^}]*(\\b${s}\\b|\\w+\\s+as\\s+${s}\\b)[^}]*\\}`),
  ];
}

function fileExports(text, symbol) {
  for (const re of exportMatchers(symbol)) if (re.test(text)) return true;
  return false;
}

function evalSymbol({ symbol, file }, ctx) {
  if (file) {
    if (!ctx.index.has(file))
      return { verdict: "unknown", summary: `referenced file ${file} is not tracked — cannot check exports` };
    let text;
    try {
      text = readFileSync(join(ctx.root, file), "utf8");
    } catch {
      return { verdict: "unknown", summary: `could not read ${file}` };
    }
    if (fileExports(text, symbol)) return { verdict: "true", summary: `exported by ${file}` };
    if (UNKNOWN_FORMS.test(text) || file.endsWith(".cjs"))
      return { verdict: "unknown", summary: `${file} uses export forms the deterministic check cannot decide (export * / default expression / CJS)` };
    const near = nearestExportName(text, symbol);
    return {
      verdict: "false",
      summary: `no matching export in ${file}`,
      actual: near ? `did you mean \`${near}\`?` : null,
    };
  }

  // Repo-wide: unique match -> true; multiple -> unknown; zero -> false only
  // when nothing undecidable was encountered (design doc + absorb #6).
  const start = Date.now();
  const candidates = [...ctx.index].filter((p) => /\.(m?js|cjs|tsx?|jsx|mts)$/.test(p));
  let scanned = 0, undecidable = false;
  const matches = [];
  for (const rel of candidates) {
    if (scanned >= SYMBOL_FILE_CAP || Date.now() - start > SYMBOL_WALL_MS) {
      return { verdict: "unknown", summary: "repo-wide symbol search hit its cap — undecided" };
    }
    scanned++;
    let text;
    try {
      text = readFileSync(join(ctx.root, rel), "utf8");
    } catch {
      undecidable = true;
      continue;
    }
    if (fileExports(text, symbol)) matches.push(rel);
    else if (UNKNOWN_FORMS.test(text) || rel.endsWith(".cjs")) undecidable = true;
    if (matches.length > 1)
      return { verdict: "unknown", summary: "symbol exported by multiple files — ambiguous without a named file" };
  }
  if (matches.length === 1) return { verdict: "true", summary: `exported by ${matches[0]}` };
  if (undecidable)
    return { verdict: "unknown", summary: "no match found, but some files use undecidable export forms" };
  return { verdict: "false", summary: `no export of ${symbol} found in ${scanned} JS/TS files` };
}

function nearestExportName(text, symbol) {
  const names = new Set();
  const re = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(text))) names.add(m[1]);
  let best = null, bestD = 3;
  for (const n of names) {
    const d = levenshtein(symbol, n, 2);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function levenshtein(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

// ── count ───────────────────────────────────────────────────────────────
function evalCount({ n, noun, anchor }, ctx) {
  if (!ctx.index.has(anchor))
    return { verdict: "unknown", summary: `anchor ${anchor} is not tracked` };
  let text;
  try {
    text = readFileSync(join(ctx.root, anchor), "utf8");
  } catch {
    return { verdict: "unknown", summary: `could not read ${anchor}` };
  }
  const singular = noun.replace(/s$/, "");
  const bind = new RegExp(`(?:const|let|var)\\s+(${noun}|${singular})\\b\\s*=\\s*([{\\[])|\\b(${noun}|${singular})\\s*:\\s*([{\\[])`, "i");
  const m = bind.exec(text);
  if (!m) return { verdict: "unknown", summary: `no ${noun} literal found in ${anchor}` };
  const opener = m[2] || m[4];
  const startIdx = m.index + m[0].length - 1;
  const counted = countTopLevel(text, startIdx, opener);
  if (counted === null)
    return { verdict: "unknown", summary: `the ${noun} literal in ${anchor} contains strings/comments — counting is uncertain` };
  if (counted === n) return { verdict: "true", summary: `${anchor} defines ${counted} ${noun}` };
  return {
    verdict: "false",
    summary: `${anchor} defines ${counted} ${noun === singular ? noun : noun}, not ${n}`,
    actual: `${counted} in \`${anchor}\``,
  };
}

// Count top-level elements of a brace/bracket literal; null on uncertainty
// (quotes, comments, or template literals inside the region — 7A posture).
function countTopLevel(text, openIdx, opener) {
  const closer = opener === "{" ? "}" : "]";
  let depth = 0, elements = 0, sawContent = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`" ) return null;
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) return null;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        if (sawContent) elements++;
        return elements;
      }
    } else if (depth === 1) {
      if (c === ",") {
        if (sawContent) elements++;
        sawContent = false;
      } else if (!/\s/.test(c)) sawContent = true;
    }
  }
  return null; // unbalanced
}
