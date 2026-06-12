// Pure text helpers shared by the dashboard and the published CLI.
//
// HARD RULE (eng review 2A): this module must stay side-effect-free at import
// time — no fs reads, no path resolution, no environment access. The CLI's
// module graph includes this file and lib/redact.mjs ONLY from lib/; it must
// never import lib/repo.mjs (which resolves dashboard paths on import).

// chars/4 token approximation (o200k-ish ballpark). All rendered figures
// derived from this are ~-prefixed — it is an approximation, label it as one.
export function tokchars(text) {
  return Math.round((text || "").length / 4);
}
