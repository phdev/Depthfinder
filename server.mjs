// Depthfinder — local-only HTTP server.
//
// Built-in http only, ZERO dependencies. Binds 127.0.0.1 ONLY by default.
// No auth by design. Opt into LAN exposure explicitly with `--lan`, `LAN=1`,
// or `HOST=0.0.0.0` — that serves the (redacted, unauthenticated) tool to
// every device on your network, so only do it on a trusted LAN. For internet
// access use a Cloudflare Tunnel instead of LAN exposure.
//
// Endpoints:
//   GET  /                       static index.html (+ /app.js, /styles.css)
//   GET  /api/map                context graph (regenerated on load — fast)
//   GET  /api/tokens             token budget (cached; refresh to recompute)
//   GET  /api/coverage           rule × eval × in-CI matrix
//   GET  /api/drift              cached drift result (manual refresh only)
//   POST /api/refresh/{map|tokens|coverage|drift}   re-run a job
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, normalize, extname } from "node:path";
import { networkInterfaces } from "node:os";
import { PUBLIC_DIR, CACHE_DIR, TOOL_DIR, REPO_ROOT } from "./lib/repo.mjs";
import { redactDeep } from "./lib/redact.mjs";

// Secure default: loopback only. Opt into LAN with --lan / LAN=1 / HOST=...
const LAN = process.argv.includes("--lan") || process.env.LAN === "1";
const HOST = process.env.HOST || (LAN ? "0.0.0.0" : "127.0.0.1");
const PORT = Number(process.env.PORT || 4317);

function lanUrls() {
  const urls = [];
  for (const addrs of Object.values(networkInterfaces()))
    for (const a of addrs || [])
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${PORT}/`);
  return urls;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(redactDeep(obj)));
}
function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const abs = normalize(join(PUBLIC_DIR, rel));
  if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + "/"))
    return sendText(res, 403, "forbidden");
  try {
    const data = await readFile(abs);
    res.writeHead(200, {
      "content-type": TYPES[extname(abs)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    sendText(res, 404, "not found");
  }
}

async function readCache(name) {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, name), "utf8"));
  } catch {
    return null;
  }
}

// Run a panel generator by dynamic import. If the stage script doesn't exist
// yet, fall back to cache or a clean "not-built" placeholder so the shell
// never crashes.
async function panelData(scriptRel, fnNames, cacheName, panel) {
  try {
    const mod = await import(scriptRel);
    for (const fn of fnNames)
      if (typeof mod[fn] === "function") return { ok: true, data: await mod[fn]() };
    return { ok: false, notBuilt: true, panel };
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND") {
      const cached = cacheName ? await readCache(cacheName) : null;
      return cached
        ? { ok: true, data: cached }
        : { ok: false, notBuilt: true, panel };
    }
    return { ok: false, error: String(e?.message || e), panel };
  }
}

const notBuilt = (panel, stage) => ({
  status: "not-built",
  panel,
  message: `The ${panel} panel is built in stage ${stage}.`,
});

async function getMap() {
  const mod = await import("./scripts/context-map.mjs");
  return mod.writeMap().map; // regenerate + cache, return map
}

// Run the AgentCI gate in a CHILD process: it chdir's to the repo and stubs
// global fetch, so we isolate it from the server. It writes only to .cache.
function runGateChild() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(TOOL_DIR, "scripts", "coverage.mjs"), "--run-gate"],
      { cwd: REPO_ROOT, env: process.env },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ ran: false, error: err.slice(-500) || `gate exited ${code}` });
      }
    });
    child.on("error", (e) => resolve({ ran: false, error: String(e?.message || e) }));
  });
}

async function handle(req, res) {
  const { method } = req;
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  // drain POST body (unused; refresh actions are path-addressed)
  if (method === "POST") for await (const _ of req) {/* ignore */}

  try {
    // ── GET APIs ──
    if (method === "GET" && path === "/api/summary") {
      const mod = await import("./scripts/summary.mjs");
      return sendJson(res, 200, await mod.generateSummary());
    }

    if (method === "GET" && path === "/api/map")
      return sendJson(res, 200, await getMap());

    if (method === "GET" && path === "/api/tokens") {
      const r = await panelData(
        "./scripts/token-budget.mjs",
        ["generateCurrents", "readTokens"],
        "tokens.json",
        "tokens",
      );
      return sendJson(res, 200, r.ok ? r.data : notBuilt("tokens", "b"));
    }

    if (method === "GET" && path === "/api/coverage") {
      const r = await panelData(
        "./scripts/coverage.mjs",
        ["generateCoverage", "writeCoverage"],
        "coverage.json",
        "coverage",
      );
      return sendJson(res, 200, r.ok ? r.data : notBuilt("coverage", "c"));
    }

    if (method === "GET" && path === "/api/drift") {
      const mod = await import("./scripts/drift-refresh.mjs");
      return sendJson(res, 200, mod.driftStatus());
    }

    // ── POST refresh ──
    if (method === "POST" && path === "/api/refresh/map") {
      const map = await getMap();
      return sendJson(res, 200, { ok: true, summary: map.summary });
    }
    if (method === "POST" && path === "/api/refresh/tokens") {
      const r = await panelData(
        "./scripts/token-budget.mjs",
        // writeTokens PERSISTS the regenerated cache; the prior first-choice
        // returned fresh data without ever writing, so the refresh button
        // silently no-op'd and the cache stayed stale.
        ["writeTokens"],
        "tokens.json",
        "tokens",
      );
      return sendJson(res, 200, r.ok ? { ok: true, data: r.data } : notBuilt("tokens", "b"));
    }
    if (method === "POST" && path === "/api/refresh/coverage") {
      const r = await panelData(
        "./scripts/coverage.mjs",
        ["writeCoverage", "generateCoverage"],
        "coverage.json",
        "coverage",
      );
      return sendJson(res, 200, r.ok ? { ok: true, data: r.data } : notBuilt("coverage", "c"));
    }
    // Real, deterministic, offline AgentCI gate (writes only to .cache).
    if (method === "POST" && path === "/api/run/gate") {
      return sendJson(res, 200, await runGateChild());
    }
    if (method === "POST" && path === "/api/refresh/drift") {
      const mod = await import("./scripts/drift-refresh.mjs");
      if (!mod.detectEvaluator().installed)
        return sendJson(res, 200, mod.driftStatus());
      // Detached: the run takes 1–3 min and must outlive this request.
      const child = spawn(
        process.execPath,
        [join(TOOL_DIR, "scripts", "drift-refresh.mjs"), "--run"],
        { cwd: REPO_ROOT, detached: true, stdio: "ignore" },
      );
      child.unref();
      return sendJson(res, 200, { status: "started", startedAt: new Date().toISOString() });
    }

    // ── static ──
    if (method === "GET") return serveStatic(res, path);
    return sendText(res, 405, "method not allowed");
  } catch (e) {
    return sendJson(res, 500, { error: String(e?.message || e) });
  }
}

const exposed = HOST !== "127.0.0.1" && HOST !== "localhost";
createServer(handle).listen(PORT, HOST, () => {
  console.log(
    `Depthfinder → http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`,
  );
  if (!exposed) {
    console.log("  bound to 127.0.0.1 only (loopback).");
  } else {
    console.log(`  ⚠ LAN-EXPOSED (${HOST}) — no auth; anyone on your network can view this.`);
    for (const u of lanUrls()) console.log(`     reachable at ${u}`);
  }
});
