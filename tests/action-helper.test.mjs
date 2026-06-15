// Security regression suite for the "Open in Terminal" loopback helper.
//
// Drives the pure request handler with injected deps (no real repo scan, no real
// Terminal launch), asserting every defense-in-depth layer:
//   L2 Origin allowlist · L3 token · L4 issueId-only (no prompt text honored)
//   L5 pre-type-not-run + osascript escaping (CRITICAL — a bypass = pre-typed bait)
//   + fail-closed, macOS guard, command construction.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handle,
  osaEscape,
  buildOsascript,
  titleHash,
  isMac,
  DASH_ORIGIN,
} from "../scripts/action-helper.mjs";

// ── mock req/res ──
function mockReq({ method = "POST", url = "/run-in-terminal", headers = {}, body = "" }) {
  async function* gen() {
    if (body) yield Buffer.from(body);
  }
  const req = gen();
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}
function mockRes() {
  const res = {};
  res.writeHead = (s, h) => {
    res.status = s;
    res.head = h;
    return res;
  };
  res.end = (b) => {
    res.json = b ? JSON.parse(b) : null;
  };
  return res;
}

const DERIVED = 'Fix the AgentCI gate; do not touch "other" files \\ or $(secrets) `here`';
function deps(over = {}) {
  const calls = [];
  return {
    token: "TOK",
    deriveActionPrompt: async (issueId) =>
      issueId === 0 ? { prompt: DERIVED } : { error: "unknown issue", status: 404 },
    launch: (cmd) => calls.push(cmd),
    _calls: calls,
    ...over,
  };
}
const okHeaders = { origin: DASH_ORIGIN, "x-df-token": "TOK" };
async function run(reqOpts, d) {
  const res = mockRes();
  await handle(mockReq(reqOpts), res, d);
  return res;
}

// ── L2 Origin allowlist ──
test("L2: POST with no Origin → 403", async () => {
  const d = deps();
  const res = await run({ headers: { "x-df-token": "TOK" }, body: '{"issueId":0}' }, d);
  assert.equal(res.status, 403);
  assert.match(res.json.error, /origin/);
  assert.equal(d._calls.length, 0);
});
test("L2: POST with a foreign Origin → 403", async () => {
  const d = deps();
  const res = await run({ headers: { origin: "http://evil.example", "x-df-token": "TOK" }, body: '{"issueId":0}' }, d);
  assert.equal(res.status, 403);
  assert.equal(d._calls.length, 0);
});

// ── L3 token ──
test("L3: correct Origin but missing token → 403", async () => {
  const d = deps();
  const res = await run({ headers: { origin: DASH_ORIGIN }, body: '{"issueId":0}' }, d);
  assert.equal(res.status, 403);
  assert.match(res.json.error, /token/);
  assert.equal(d._calls.length, 0);
});
test("L3: wrong token → 403 (fail-closed)", async () => {
  const d = deps();
  const res = await run({ headers: { origin: DASH_ORIGIN, "x-df-token": "NOPE" }, body: '{"issueId":0}' }, d);
  assert.equal(res.status, 403);
  assert.equal(d._calls.length, 0);
});

// ── L4 issueId-only ──
test("L4: a `prompt` field in the body is IGNORED — only the derived prompt runs", async () => {
  const d = deps();
  const res = await run({ headers: okHeaders, body: JSON.stringify({ issueId: 0, prompt: "EVIL; rm -rf ~" }) }, d);
  assert.equal(res.status, 200);
  assert.equal(d._calls.length, 1);
  assert.equal(d._calls[0], `claude ${JSON.stringify(DERIVED)}`, "launched the derived prompt (argv-quoted)");
  assert.ok(!d._calls[0].includes("EVIL"), "ignored the attacker-supplied prompt text");
  assert.ok(!d._calls[0].includes("rm -rf"), "attacker payload absent from the command");
});
test("L4: unknown issueId → 404, nothing launched", async () => {
  const d = deps();
  const res = await run({ headers: okHeaders, body: '{"issueId":99}' }, d);
  assert.equal(res.status, 404);
  assert.equal(d._calls.length, 0);
});
test("L4: non-integer / negative issueId → 400", async () => {
  for (const bad of ['{"issueId":-1}', '{"issueId":"x"}', "{}"]) {
    const d = deps();
    const res = await run({ headers: okHeaders, body: bad }, d);
    assert.equal(res.status, 400, `body ${bad}`);
    assert.equal(d._calls.length, 0);
  }
});
test("L4: stale-scan mismatch (helper returns 409) is passed through", async () => {
  const d = deps({ deriveActionPrompt: async () => ({ error: "issue changed", status: 409 }) });
  const res = await run({ headers: okHeaders, body: '{"issueId":0,"titleHash":"deadbeef"}' }, d);
  assert.equal(res.status, 409);
  assert.equal(d._calls.length, 0);
});

// ── L5 command construction + osascript escaping (CRITICAL) ──
test("L5: launch gets `claude \"<prompt>\"` — argv-quoted, never a bare shell string", async () => {
  const d = deps();
  await run({ headers: okHeaders, body: '{"issueId":0}' }, d);
  assert.equal(d._calls[0], `claude ${JSON.stringify(DERIVED)}`);
});
test("CRITICAL: osaEscape neutralizes the AppleScript string terminators", () => {
  assert.equal(osaEscape('"'), '\\"'); // a quote can't close the keystroke string
  assert.equal(osaEscape("\\"), "\\\\"); // a backslash is doubled
  assert.equal(osaEscape("a\nb\rc"), "a b c"); // newlines collapsed (can't split the line)
});
test("CRITICAL: buildOsascript escapes a hostile prompt + never appends a return (no auto-run)", () => {
  const hostile = 'claude "x\\"; do shell script \\"rm -rf ~\\" #"';
  const script = buildOsascript(hostile);
  // every double-quote inside the keystroke payload is backslash-escaped
  const ksLine = script.split("\n").find((l) => l.includes("keystroke"));
  assert.ok(ksLine);
  const payload = ksLine.slice(ksLine.indexOf('keystroke "') + 'keystroke "'.length, -1);
  assert.ok(!/(?<!\\)"/.test(payload), "no unescaped double-quote can break out of the string");
  // pre-type only: there is NO `keystroke return` / `& return` that would run it
  assert.ok(!/keystroke\s+return|& *return/.test(script), "must NOT auto-run");
});

// ── health + misc ──
test("GET /health → 200 with platform", async () => {
  const res = await run({ method: "GET", url: "/health", headers: {} }, deps());
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(typeof res.json.platform, "string");
});
test("oversize body → 413", async () => {
  const d = deps();
  const res = await run({ headers: okHeaders, body: "x".repeat(5000) }, d);
  assert.equal(res.status, 413);
  assert.equal(d._calls.length, 0);
});
test("bad JSON → 400", async () => {
  const d = deps();
  const res = await run({ headers: okHeaders, body: "{not json" }, d);
  assert.equal(res.status, 400);
});
test("unknown route → 404", async () => {
  const res = await run({ method: "GET", url: "/nope", headers: {} }, deps());
  assert.equal(res.status, 404);
});

// ── macOS guard ──
test("macOS guard: isMac() refuses non-darwin platforms", () => {
  const orig = process.platform;
  try {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    assert.equal(isMac(), false);
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    assert.equal(isMac(), true);
  } finally {
    Object.defineProperty(process, "platform", { value: orig, configurable: true });
  }
});

// titleHash — stable fingerprint, not reversible to the prompt
test("titleHash is stable + short (a fingerprint, not the text)", () => {
  assert.equal(titleHash("AgentCI gate isn't enforced in CI"), titleHash("AgentCI gate isn't enforced in CI"));
  assert.notEqual(titleHash("a"), titleHash("b"));
  assert.equal(titleHash("anything").length, 12);
});
