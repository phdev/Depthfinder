// Repo location + safe read helpers for the Depthfinder.
//
// The tool reads the analyzed repo (home-center) READ-ONLY. The only paths it
// is ever allowed to WRITE are this tool's own dir and its .cache/. Reads are
// pinned under REPO_ROOT and refuse anything that escapes it (no traversal).
import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep } from "node:path";

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
export const REPO_ROOT = resolveRepoRoot();

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
