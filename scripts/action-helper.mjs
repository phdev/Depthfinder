// Depthfinder — local "Open in Terminal" helper.
//
// A SEPARATE, opt-in, loopback-ONLY process (never the dashboard server). It
// binds 127.0.0.1:4318 and is NEVER forwarded by the Cloudflare tunnel (which
// proxies only :4317), so a remote tunnel viewer can never reach it — their
// `fetch('127.0.0.1:4318')` resolves to THEIR OWN localhost, not the host's.
// One job: open the user's Terminal with a Depthfinder suggested-action prompt
// PRE-TYPED (never executed — the user reviews and presses Enter).
//
// Security model (defense in depth — see the eng-review design doc):
//
//   L1 loopback isolation — binds 127.0.0.1 only; the tunnel never forwards :4318
//   L2 Origin allowlist   — POST must carry Origin: http://127.0.0.1:4317
//   L3 per-boot token     — minted here, written 0600, required on every POST
//   L4 issueId-only       — NO command text on the wire; the prompt is derived
//                           HERE from the issueId (a forged request can't inject)
//   L5 Enter checkpoint   — osascript PRE-TYPES `claude "<prompt>"`; the user
//                           runs it. Nothing auto-executes.
//
// Opt-in / OFF by default: started only via the dev.depthfinder.helper launchd
// job (npm run helper:enable). macOS-only for v1 (refuses to start elsewhere).
import { createServer } from "node:http";
import { writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { CACHE_DIR } from "../lib/repo.mjs";

export const DASH_ORIGIN = "http://127.0.0.1:4317";
const HOST = "127.0.0.1";
const PORT = Number(process.env.DF_HELPER_PORT || 4318);
const STATE = join(CACHE_DIR, "helper.json");

export const isMac = () => process.platform === "darwin";

// Stable per-issue fingerprint. NOT executable text — a hash the front-end
// also sends so the helper can detect a dashboard/helper scan mismatch (the
// repo changed between render and click) WITHOUT putting the prompt on the wire.
export const titleHash = (s) =>
  createHash("sha256").update(String(s || "")).digest("hex").slice(0, 12);

// AppleScript string escaping: backslash first, then double-quote, then strip
// control chars that could terminate the `keystroke` string early.
export function osaEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

// Build the AppleScript that opens Terminal and PRE-TYPES the command line
// WITHOUT a trailing return — the user reviews and presses Enter. `keystroke`
// (System Events) types into the frontmost Terminal; `do script ""` only when
// there's no window yet so we have a shell to type into. The first run prompts
// for Accessibility permission (documented in the consent + CLAUDE.md).
export function buildOsascript(commandLine) {
  return [
    'tell application "Terminal"',
    "  activate",
    "  if (count of windows) is 0 then do script \"\"",
    "end tell",
    "delay 0.3",
    'tell application "System Events" to keystroke "' + osaEscape(commandLine) + '"',
  ].join("\n");
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

// Pure request handler. `deps` are injected so tests can drive every security
// branch without a real repo scan or launching Terminal:
//   deps.token              — the secret the POST must echo (L3)
//   deps.deriveActionPrompt — (issueId, titleHash) -> {prompt} | {error,status} (L4)
//   deps.launch             — (commandLine) -> void; the real one spawns osascript (L5)
export async function handle(req, res, deps) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // GET /health — liveness probe so the dashboard only shows the button when
  // the helper is actually up. Cheap, no side effects, no secrets.
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, platform: process.platform });
  }

  if (req.method === "POST" && url.pathname === "/run-in-terminal") {
    // L2 — Origin allowlist. A foreign local page's POST carries its own Origin
    // (browser-set, unforgeable from JS); reject anything but the dashboard.
    if (req.headers["origin"] !== DASH_ORIGIN) return sendJson(res, 403, { error: "bad origin" });
    // L3 — per-boot token. Foreign pages can't read it (CORS withholds the body
    // of a cross-origin read of :4317's same-origin token endpoint).
    if ((req.headers["x-df-token"] || "") !== deps.token) return sendJson(res, 403, { error: "bad token" });

    // L4 — issueId-only. Read ONLY issueId + titleHash; never any prompt text.
    let body = "";
    for await (const c of req) {
      body += c;
      if (body.length > 4096) return sendJson(res, 413, { error: "too large" });
    }
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      return sendJson(res, 400, { error: "bad json" });
    }
    const issueId = Number(payload.issueId);
    if (!Number.isInteger(issueId) || issueId < 0) return sendJson(res, 400, { error: "bad issueId" });

    const derived = await deps.deriveActionPrompt(issueId, String(payload.titleHash || ""));
    if (derived.error) return sendJson(res, derived.status || 404, { error: derived.error });

    // L5 — PRE-TYPE the command (claude "<prompt>"), never run it.
    deps.launch(`claude ${JSON.stringify(derived.prompt)}`);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "not found" });
}

// Real derivation: re-run the live summary scan HERE and pick the issue by
// index, verifying the title fingerprint to catch a stale dashboard click.
async function realDerive(issueId, check) {
  const { generateSummary } = await import("./summary.mjs");
  const data = await generateSummary();
  const issue = data.issues?.[issueId];
  if (!issue || !issue.actionPrompt) return { error: "unknown issue", status: 404 };
  if (check && titleHash(issue.title) !== check)
    return { error: "issue changed — reload the dashboard", status: 409 };
  return { prompt: issue.actionPrompt };
}

// Real launch: spawn osascript to PRE-TYPE the command. Detached + unref'd so a
// slow Terminal doesn't tie up the request. Never a shell string — args array.
function realLaunch(commandLine) {
  const script = buildOsascript(commandLine);
  spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
}

function writeState(token) {
  writeFileSync(STATE, JSON.stringify({ token, port: PORT, pid: process.pid }), { mode: 0o600 });
  try {
    chmodSync(STATE, 0o600);
  } catch {
    /* best-effort tightening */
  }
}
function cleanup() {
  try {
    unlinkSync(STATE);
  } catch {
    /* already gone */
  }
}

export function start() {
  // macOS guard — the osascript launcher is Terminal.app-specific. Refuse to
  // serve anywhere else rather than expose a non-functional execute endpoint.
  if (!isMac()) {
    console.error(`action-helper: platform ${process.platform} unsupported (macOS only); refusing to start.`);
    process.exitCode = 0;
    return;
  }
  const token = randomBytes(24).toString("hex");
  writeState(token);
  const deps = { token, deriveActionPrompt: realDerive, launch: realLaunch };
  const server = createServer((req, res) =>
    handle(req, res, deps).catch((e) => sendJson(res, 500, { error: String(e?.message || e) })),
  );
  server.listen(PORT, HOST, () => {
    console.log(`Depthfinder helper → http://127.0.0.1:${PORT}`);
    console.log("  loopback only · opt-in · pre-types (never runs) · never tunneled");
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
