// Repo location + safe read helpers for the Depthfinder.
//
// The tool reads the analyzed repo (home-center) READ-ONLY. The only paths it
// is ever allowed to WRITE are this tool's own dir and its .cache/. Reads are
// pinned under REPO_ROOT and refuse anything that escapes it (no traversal).
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve, relative, sep, basename } from "node:path";

const LIB_DIR = dirname(fileURLToPath(import.meta.url)); // <tool>/lib
export const TOOL_DIR = resolve(LIB_DIR, ".."); // tool root

// REPO_ROOT resolution: $REPO_ROOT env > a `.repo-root` file in the tool dir >
// ../../ fallback. This tool lives in its OWN repo, so `.repo-root` pins it at
// the repo it analyzes. `.repo-root` is machine-specific and gitignored — see
// `.repo-root.example`.
function resolveRepoRoot() {
  if (process.env.REPO_ROOT) return resolve(process.env.REPO_ROOT);
  try {
    const pinned = readFileSync(join(TOOL_DIR, ".repo-root"), "utf8").trim();
    if (pinned) return resolve(pinned);
  } catch {}
  return resolve(TOOL_DIR, "..", "..");
}
// REPO_ROOT is a LIVE binding (let, not const): the dashboard can switch the
// scanned project at runtime via setRepoRoot(). ES-module named exports are live,
// and every scan script reads REPO_ROOT at call time, so switching here re-points
// all subsequent API calls (which regenerate fresh) — no restart, no cache clear.
export let REPO_ROOT = resolveRepoRoot();
export function setRepoRoot(p) {
  REPO_ROOT = resolve(p);
  return REPO_ROOT;
}
export function repoName(root = REPO_ROOT) {
  return basename(root) || root;
}
// A directory only counts as a project if it carries a recognizable marker —
// guards against pointing the (local-only) scanner at arbitrary/system dirs.
const PROJECT_MARKERS = [".git", "package.json", "CLAUDE.md", "AGENTS.md", ".repo-root", "pyproject.toml", "go.mod", "Cargo.toml"];
export function looksLikeProject(abs) {
  try {
    if (!statSync(abs).isDirectory()) return false;
  } catch {
    return false;
  }
  return PROJECT_MARKERS.some((m) => existsSync(join(abs, m)));
}
export function projectPathOk(abs) {
  // confine added/activated projects to the user's home tree (the scanner is
  // unauthenticated on the LAN; this stops it being pointed at /etc, /, etc.)
  const home = homedir();
  return abs === home || abs.startsWith(home + sep);
}
// Persisted project registry (the dashboard's repo-name dropdown reads/writes it).
const PROJECTS_FILE = () => join(CACHE_DIR, "projects.json");
export function readProjects() {
  try {
    const d = JSON.parse(readFileSync(PROJECTS_FILE(), "utf8"));
    if (d && Array.isArray(d.projects)) return d;
  } catch {}
  return { active: null, projects: [] };
}
export function writeProjects(data) {
  ensureCache();
  writeFileSync(PROJECTS_FILE(), JSON.stringify(data, null, 2));
  return data;
}
export function registerProject(root) {
  const abs = resolve(root);
  const data = readProjects();
  if (!data.projects.some((p) => p.root === abs))
    data.projects.push({ name: repoName(abs), root: abs });
  return writeProjects(data);
}

export const CACHE_DIR = join(TOOL_DIR, ".cache");
export const PUBLIC_DIR = join(TOOL_DIR, "public");

export function ensureCache() {
  mkdirSync(CACHE_DIR, { recursive: true });
  return CACHE_DIR;
}

// Resolve a repo-relative path and refuse anything escaping REPO_ROOT.
export function repoPath(rel) {
  const abs = resolve(REPO_ROOT, rel);
  const within = abs === REPO_ROOT || abs.startsWith(REPO_ROOT + sep);
  if (!within) throw new Error(`path escapes repo root: ${rel}`);
  return abs;
}

export function repoExists(rel) {
  try {
    return existsSync(repoPath(rel));
  } catch {
    return false;
  }
}

export function readRepoText(rel) {
  try {
    return readFileSync(repoPath(rel), "utf8");
  } catch {
    return null;
  }
}

export function relToRepo(abs) {
  return relative(REPO_ROOT, abs).split(sep).join("/");
}

// Recursively list repo-relative files under a dir, optionally filtered by ext.
export function walk(
  relDir,
  { exts = null, skipDirs = ["node_modules", ".git", "dist", ".cache"] } = {},
) {
  const out = [];
  let base;
  try {
    base = repoPath(relDir);
  } catch {
    return out;
  }
  if (!existsSync(base)) return out;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.includes(e.name)) continue;
        stack.push(abs);
      } else if (e.isFile()) {
        if (exts && !exts.some((x) => e.name.endsWith(x))) continue;
        out.push(relToRepo(abs));
      }
    }
  }
  return out.sort();
}

export function listGlob(relDir, exts) {
  return walk(relDir, { exts });
}

// tokchars moved to lib/text.mjs (pure, side-effect-free) so the published
// CLI can share it without importing this module's import-time path
// resolution (eng review 2A). Dashboard code imports it from there too.
