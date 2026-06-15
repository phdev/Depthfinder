// Whether to emit ANSI color, resolved once in bin and threaded into the render.
//
// Precedence (OFF wins first, so a file redirect / CI never gets surprise
// escapes; explicit ON beats auto-detection):
//   1. --no-color / NO_COLOR            → off   (explicit, and the NO_COLOR std)
//   2. --color / FORCE_COLOR            → on    (explicit override)
//   3. CI                               → off   (keep build logs clean)
//   4. stdout is a TTY                  → on    (a real pty)
//   5. color-capable display advertised → on    (no pty, but a terminal app /
//      multiplexer / AI shell is relaying our output — Cmux, tmux, iTerm,
//      ghostty, … — and it told us it does color via COLORTERM / TERM_PROGRAM /
//      TMUX / STY). This is the case that makes color "just work" in those apps
//      without a flag: they capture a command's output instead of giving it a
//      pty, so step 4 is false even though a human is watching a color screen.
//   6. else                             → off   (headless agents / dumb pipes —
//      they don't set the step-5 vars, so they stay plain, which is what an
//      agent parsing the card or a `> file` redirect wants).
//
// Pure + deterministic (no process access) so it unit-tests across every host.
export function resolveColor({ flags = {}, env = {}, isTTY = false } = {}) {
  if (flags["no-color"] || env.NO_COLOR) return false;
  if (flags.color || env.FORCE_COLOR) return true;
  if (env.CI) return false;
  if (isTTY) return true;
  return !!(env.COLORTERM || env.TERM_PROGRAM || env.TMUX || env.STY);
}
