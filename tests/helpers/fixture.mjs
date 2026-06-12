// Hermetic fixture materializer (eng review 9A).
//
// Fixtures are generated as REAL git repos in tmpdirs with pinned author/
// committer/date, so commit SHAs are deterministic and the golden card can
// contain history evidence. clean-fixture: every claim true (the no-cry-wolf
// ship gate). dirty-fixture: replicates real-world rot — dead path, false
// dependency, wrong count, undecidable symbol, planted fake secret, UTF-16
// context file.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BIN = join(HERE, "..", "..", "bin", "depthfinder.mjs");

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Depthfinder Fixture",
  GIT_AUTHOR_EMAIL: "fixture@depthfinder.invalid",
  GIT_COMMITTER_NAME: "Depthfinder Fixture",
  GIT_COMMITTER_EMAIL: "fixture@depthfinder.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd, args, date) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      // Windows: GIT_CONFIG_GLOBAL=/dev/null is invalid; NUL works.
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function materialize(name) {
  const root = mkdtempSync(join(tmpdir(), `df-${name}-`));
  git(root, ["init", "-q", "-b", "main"], "2026-01-01T00:00:00Z");

  if (name === "clean") {
    writeTree(root, {
      "package.json": JSON.stringify(
        { name: "clean-fixture", version: "1.0.0", dependencies: { "@picovoice/porcupine": "^1.0.0" } },
        null, 2) + "\n",
      "src/index.js": "export function startServer() {}\n",
      "router/config.js": "export const tiers = { cache: 1, local: 2, cloud: 3 }\n",
      "CLAUDE.md": [
        "# clean-fixture",
        "",
        "Entry point is `src/index.js`. Routing config lives in `router/config.js`.",
        "",
        "Model routing uses 3 tiers (see `router/config.js`).",
        "",
        "Wake word handled by `@picovoice/porcupine`.",
        "",
        "`src/index.js` exports `startServer`.",
        "",
      ].join("\n"),
    });
    git(root, ["add", "-A"], "2026-01-01T00:00:00Z");
    git(root, ["commit", "-q", "-m", "init"], "2026-01-01T00:00:00Z");
    return root;
  }

  if (name === "dirty") {
    // commit 1: oauth.ts exists
    writeTree(root, {
      "package.json": JSON.stringify(
        { name: "dirty-fixture", version: "1.0.0", dependencies: { "@picovoice/porcupine": "^1.0.0" } },
        null, 2) + "\n",
      "src/index.js": "export function startServer() {}\n",
      "src/core.js": "export const core = 1\n",
      "src/engine.js": "export * from './core.js'\n",
      "src/auth/oauth.ts": "export const oauth = true\n",
      "router/config.js": "export const tiers = { cache: {}, local: {}, cloud: {} }\n",
      "CLAUDE.md": "# dirty-fixture (v1)\n",
    });
    git(root, ["add", "-A"], "2026-01-01T00:00:00Z");
    git(root, ["commit", "-q", "-m", "init"], "2026-01-01T00:00:00Z");

    // commit 2: delete oauth.ts, write the rotten CLAUDE.md + UTF-16 AGENTS.md
    rmSync(join(root, "src", "auth", "oauth.ts"));
    writeTree(root, {
      "CLAUDE.md": [
        "# dirty-fixture",
        "",
        "Entry point is `src/index.js`. Engine wiring lives in `src/engine.js`.",
        "",
        "Auth flows live in `src/auth/oauth.ts` (legacy token: sk-test-aaaabbbbccccddddeeee).",
        "",
        "Wake word handled by `openWakeWord`.",
        "",
        "Model routing uses 4 tiers (see `router/config.js`).",
        "",
        "`src/engine.js` exports `startEngine`.",
        "",
      ].join("\n"),
    });
    // UTF-16LE AGENTS.md with BOM — must be skipped with a warning (7A)
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("# agents\nSee `src/missing-from-utf16.js`.\n", "utf16le"),
    ]);
    writeFileSync(join(root, "AGENTS.md"), utf16);
    git(root, ["add", "-A"], "2026-01-02T00:00:00Z");
    git(root, ["commit", "-q", "-m", "rot sets in"], "2026-01-02T00:00:00Z");
    return root;
  }

  throw new Error(`unknown fixture: ${name}`);
}

// Ad-hoc tiny repo for unit tests: makeRepo({ files, commits }) — single commit.
export function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "df-adhoc-"));
  git(root, ["init", "-q", "-b", "main"], "2026-01-01T00:00:00Z");
  writeTree(root, files);
  git(root, ["add", "-A"], "2026-01-01T00:00:00Z");
  git(root, ["commit", "-q", "-m", "init"], "2026-01-01T00:00:00Z");
  return root;
}

export function runCli(cwd, args = [], env = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// Content hash of a working tree (ignores .git) — proves write-nothing (5A).
export function hashTree(root) {
  const h = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else {
        h.update(abs.slice(root.length));
        h.update(readFileSync(abs));
      }
    }
  };
  walk(root);
  return h.digest("hex");
}

export function cleanup(root) {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch { /* tmpdir reaping is best-effort */ }
}
