// Depthfinder Console — a public, zero-install web demo.
//
// Paste a public GitHub repo → the server shallow-clones it, runs the LOCAL
// Depthfinder CLI against it (deterministic, no model calls), and returns the
// honesty payload for the browser to render. Lets you show Depthfinder to
// anyone with a URL; they never install npm.
//
// Safety model (this is a public-facing server that runs a tool on arbitrary
// public repos):
//   • host is HARD-CODED to github.com; only `owner/repo` (matched by a strict
//     regex) is interpolated — and via a spawn ARGS ARRAY, never a shell, so no
//     command/URL injection and no SSRF to internal hosts.
//   • Depthfinder only READS/parses the repo (no eval, no build, no code run);
//     `git clone` doesn't run repo hooks. A hostile repo can't execute code here.
//   • shallow clone (`--depth 1`), hard timeouts, a concurrency cap, and a
//     blob-size filter bound resource use; the temp clone is always shredded.
//   • `--burn` (the only model-calling path) is never invoked.
//
// Zero runtime deps (Node ≥20 built-ins). Binds 127.0.0.1 by default; expose
// publicly with a Cloudflare quick tunnel (see console/README.md).
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const BIN = join(REPO_ROOT, "bin", "depthfinder.mjs");
const PORT = Number(process.env.PORT || 4319);
const HOST = process.env.HOST || "127.0.0.1";

// owner/repo: GitHub names are [A-Za-z0-9._-]; reject everything else (no
// spaces, no `..`, no scheme, no second slash) so the clone URL is unforgeable.
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CLONE_TIMEOUT_MS = 25_000;
const SCAN_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT = 3;
let inFlight = 0;

// "github.com/a/b", "https://github.com/a/b(.git)", "a/b" → "owner/repo" | null
function parseRepo(input) {
  if (typeof input !== "string") return null;
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  // keep only the first two path segments (owner/repo); drop /tree/main etc.
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const slug = `${parts[0]}/${parts[1]}`;
  return OWNER_REPO.test(slug) ? slug : null;
}

function cloneAndScan(slug) {
  const dir = mkdtempSync(join(tmpdir(), "df-console-"));
  try {
    const clone = spawnSync(
      "git",
      [
        "clone", "--depth", "1", "--single-branch", "--no-tags",
        "--filter=blob:limit=2m", // cap individual blobs; tree still complete
        `https://github.com/${slug}.git`, dir,
      ],
      { timeout: CLONE_TIMEOUT_MS, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    if (clone.status !== 0) {
      const why = (clone.stderr || "").includes("not found") || (clone.stderr || "").includes("Repository not found")
        ? "repository not found (is it public?)"
        : clone.error?.code === "ETIMEDOUT" ? "clone timed out (repo too large for the demo)" : "clone failed";
      return { error: why };
    }
    // Default mode (no --json): stdout is the EXACT replay card `npx depthfinder`
    // prints — what we show, verbatim, so the demo is a faithful preview of the
    // real tool (--no-history keeps it from touching a cache; --no-follow off so
    // linked brain docs are scanned exactly as the CLI does by default).
    const scan = spawnSync(process.execPath, [BIN, dir, "--no-history"], {
      timeout: SCAN_TIMEOUT_MS, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, DEPTHFINDER_CACHE: join(dir, ".df-cache") },
    });
    // exit 3 = no context files (a clean "this repo has no CLAUDE.md/AGENTS.md")
    if (scan.status === 3) return { error: "no AI context files found (no CLAUDE.md / AGENTS.md / .cursorrules)" };
    if (scan.status === 2) return { error: "not a scannable git repo" };
    if (!scan.stdout) return { error: scan.error?.code === "ETIMEDOUT" ? "scan timed out (repo too large for the demo)" : "scan produced no output" };
    return { card: scan.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const PAGE = () => readFileSync(join(HERE, "public", "index.html"), "utf8");

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return send(res, 200, PAGE(), "text/html; charset=utf-8");
  }
  if (req.method === "POST" && url.pathname === "/api/scan") {
    if (inFlight >= MAX_CONCURRENT) return send(res, 429, JSON.stringify({ error: "busy — a few scans are already running, try again in a moment" }));
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on("end", () => {
      let slug;
      try { slug = parseRepo(JSON.parse(raw).repo); } catch { slug = null; }
      if (!slug) return send(res, 400, JSON.stringify({ error: "enter a public GitHub repo as owner/name or a github.com URL" }));
      inFlight++;
      // run off the event loop tick so the concurrency counter is honored
      Promise.resolve().then(() => cloneAndScan(slug))
        .then((r) => send(res, r.error ? 422 : 200, JSON.stringify({ repo: slug, ...r })))
        .catch((e) => send(res, 500, JSON.stringify({ error: String(e?.message || e) })))
        .finally(() => { inFlight--; });
    });
    return;
  }
  send(res, 404, JSON.stringify({ error: "not found" }));
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`Depthfinder Console → http://${HOST}:${PORT}  (expose with a Cloudflare quick tunnel; see console/README.md)\n`);
});
