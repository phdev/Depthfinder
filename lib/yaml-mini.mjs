// Tiny zero-dependency YAML reader for the constrained subset used by
// context/rules.yaml: nested maps, block sequences, and scalar values.
// No flow style, no multi-line scalars, no anchors. Good enough for an
// authored config file; not a general YAML implementation.

function scalar(s) {
  let v = s.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~" || v === "") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

export function parseYaml(text) {
  // Tokenize: drop blank lines and full-line comments; record indent + body.
  const lines = [];
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    // strip trailing " # comment" (our authored values contain no '#')
    const body = raw.slice(indent).replace(/\s+#.*$/, "").trimEnd();
    lines.push({ indent, body });
  }
  let idx = 0;

  function parseNode(indent) {
    if (idx >= lines.length || lines[idx].indent < indent) return null;
    if (lines[idx].body.startsWith("- ")) {
      const arr = [];
      while (
        idx < lines.length &&
        lines[idx].indent === indent &&
        lines[idx].body.startsWith("- ")
      ) {
        const item = lines[idx].body.slice(2).trim();
        if (/^[^:\s][^:]*:(\s|$)/.test(item)) {
          // list item is a map — re-seat this line as a map entry, parse map
          lines[idx] = { indent: indent + 2, body: item };
          arr.push(parseNode(indent + 2));
        } else {
          arr.push(scalar(item));
          idx++;
        }
      }
      return arr;
    }
    const obj = {};
    while (
      idx < lines.length &&
      lines[idx].indent === indent &&
      !lines[idx].body.startsWith("- ")
    ) {
      const line = lines[idx];
      const ci = line.body.indexOf(":");
      const key = line.body.slice(0, ci).trim();
      const val = line.body.slice(ci + 1).trim();
      idx++;
      if (val === "") {
        const childIndent = idx < lines.length ? lines[idx].indent : indent + 2;
        obj[key] = childIndent > indent ? parseNode(childIndent) : null;
      } else {
        obj[key] = scalar(val);
      }
    }
    return obj;
  }

  return parseNode(lines.length ? lines[0].indent : 0) || {};
}
