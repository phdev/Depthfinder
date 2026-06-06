// Redact common secret / token / key shapes before any string reaches the
// browser. Defense-in-depth: the map panel never emits file contents, but
// every API payload is passed through redactDeep() on the way out anyway.
const PATTERNS = [
  // OpenAI / Stripe-style prefixed keys
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, "«redacted-key»"],
  // GitHub tokens (ghp_, gho_, ghs_, ghu_, ghr_)
  [/\bgh[opsru]_[A-Za-z0-9]{20,}\b/g, "«redacted-gh-token»"],
  // Slack tokens
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, "«redacted-slack-token»"],
  // AWS access key id
  [/\bAKIA[0-9A-Z]{16}\b/g, "«redacted-aws-key»"],
  // Google API key
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "«redacted-google-key»"],
  // JWT (header.payload.signature)
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g,
    "«redacted-jwt»",
  ],
  // PEM private keys
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "«redacted-private-key»",
  ],
  // Bearer tokens
  [/\bBearer\s+[A-Za-z0-9._-]{12,}\b/g, "Bearer «redacted»"],
  // key/secret/token/password assignment with a quoted or bare value
  [
    /\b([A-Za-z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIAL|ACCESS[_-]?KEY)[A-Za-z0-9_]*)\b(\s*[:=]\s*)(["']?)([^\s"',}{)]{6,})\3/gi,
    (_m, key, sepChars, quote) => `${key}${sepChars}${quote}«redacted»${quote}`,
  ],
];

export function redact(input) {
  if (input == null) return input;
  let s = String(input);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

// Deep-redact every string leaf in a JSON-able value.
export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}
