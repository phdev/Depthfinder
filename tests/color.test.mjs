// resolveColor — the color-on decision. Pure, so every case is deterministic
// regardless of the host terminal (the integration end is in cli.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveColor } from "../src/cli/color.mjs";

test("OFF wins first: --no-color / NO_COLOR beat everything (even a TTY + --color)", () => {
  assert.equal(resolveColor({ flags: { "no-color": true }, env: { COLORTERM: "truecolor" }, isTTY: true }), false);
  assert.equal(resolveColor({ flags: { color: true }, env: { NO_COLOR: "1" }, isTTY: true }), false);
  assert.equal(resolveColor({ env: { NO_COLOR: "1", FORCE_COLOR: "1" } }), false);
});

test("explicit ON: --color / FORCE_COLOR beat CI and a missing TTY", () => {
  assert.equal(resolveColor({ flags: { color: true }, env: { CI: "true" }, isTTY: false }), true);
  assert.equal(resolveColor({ env: { FORCE_COLOR: "1", CI: "true" }, isTTY: false }), true);
});

test("CI is plain unless explicitly forced", () => {
  assert.equal(resolveColor({ env: { CI: "true", COLORTERM: "truecolor" }, isTTY: false }), false);
  assert.equal(resolveColor({ env: { CI: "true" }, isTTY: true }), false); // even a CI pty stays plain
});

test("a real TTY is colored", () => {
  assert.equal(resolveColor({ env: {}, isTTY: true }), true);
});

test("no TTY but a color-capable terminal/multiplexer advertises → ON (Cmux/ghostty, tmux, iTerm…)", () => {
  assert.equal(resolveColor({ env: { COLORTERM: "truecolor", TERM_PROGRAM: "ghostty" }, isTTY: false }), true); // Cmux
  assert.equal(resolveColor({ env: { TERM_PROGRAM: "iTerm.app" }, isTTY: false }), true);
  assert.equal(resolveColor({ env: { TMUX: "/tmp/tmux-501/default,1,0" }, isTTY: false }), true);
  assert.equal(resolveColor({ env: { STY: "12345.pts-0.host" }, isTTY: false }), true);
});

test("headless / dumb context (no TTY, no advertisement) → plain — agents & `> file` stay clean", () => {
  assert.equal(resolveColor({ env: { TERM: "dumb" }, isTTY: false }), false);
  assert.equal(resolveColor({ env: {}, isTTY: false }), false);
});

test("empty-string env vars are falsy (a cleared NO_COLOR doesn't force off; empty COLORTERM isn't an advertisement)", () => {
  assert.equal(resolveColor({ flags: { color: true }, env: { NO_COLOR: "" }, isTTY: false }), true);
  assert.equal(resolveColor({ env: { COLORTERM: "" }, isTTY: false }), false);
});
