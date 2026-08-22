/**
 * The Prometheus text exposition format, one line at a time (IKN-8).
 *
 * Line-at-a-time is the whole design: the scraper streams the response body through a
 * LineBuffer, so no multi-megabyte string is ever split in one go on the event loop the API
 * shares. This parser must therefore be complete per line and must never throw — one malformed
 * line from a misbehaving exporter costs that line, not the scrape.
 *
 * Comments (`# HELP`, `# TYPE`) and blank lines are structure, not data: `null`. Garbage — an
 * HTML error page, an unclosed quote — is also `null`. Histogram parts (`_bucket`, `_sum`,
 * `_count`) are ordinary samples here; `le` is a label like any other, because the raw buckets
 * are exactly what `metric_sample` stores.
 */

export type PromSample = {
  name: string;
  labels: Record<string, string> | null;
  value: number;
};

const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*/;
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*/;

export function parsePromLine(line: string): PromSample | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;

  const nameMatch = NAME_RE.exec(trimmed);
  if (!nameMatch) return null;
  const name = nameMatch[0];

  let pos = name.length;
  let labels: Record<string, string> | null = null;

  if (trimmed[pos] === "{") {
    const parsed = parseLabels(trimmed, pos + 1);
    if (parsed === null) return null;
    labels = parsed.labels;
    pos = parsed.end;
  }

  // Between the name (or closing brace) and the value: at least one space.
  const rest = trimmed.slice(pos);
  if (!/^\s/.test(rest)) return null;
  const valueToken = rest.trim().split(/\s+/)[0];
  if (!valueToken) return null;

  const value = parseValue(valueToken);
  if (value === null) return null;

  return { name, labels, value };
}

/** Character scan, because escaped quotes inside label values defeat any single regex. */
function parseLabels(line: string, start: number): { labels: Record<string, string>; end: number } | null {
  const labels: Record<string, string> = {};
  let pos = start;

  for (;;) {
    // Closing brace directly: `{}` or a trailing comma before it.
    if (line[pos] === "}") return { labels, end: pos + 1 };

    const nameMatch = LABEL_NAME_RE.exec(line.slice(pos));
    if (!nameMatch) return null;
    const labelName = nameMatch[0];
    pos += labelName.length;

    if (line[pos] !== "=" || line[pos + 1] !== '"') return null;
    pos += 2;

    let value = "";
    for (;;) {
      const ch = line[pos];
      if (ch === undefined) return null; // unterminated quote
      if (ch === "\\") {
        const next = line[pos + 1];
        if (next === "\\") value += "\\";
        else if (next === '"') value += '"';
        else if (next === "n") value += "\n";
        else return null;
        pos += 2;
        continue;
      }
      if (ch === '"') {
        pos += 1;
        break;
      }
      value += ch;
      pos += 1;
    }

    labels[labelName] = value;

    if (line[pos] === ",") {
      pos += 1;
      continue;
    }
    if (line[pos] === "}") return { labels, end: pos + 1 };
    return null;
  }
}

/**
 * `+Inf`, `-Inf` and `NaN` are spelled out in the format and parsed faithfully — whether a
 * non-finite value is *storable* is the row mapper's question, not the parser's.
 */
function parseValue(token: string): number | null {
  if (token === "+Inf" || token === "Inf") return Number.POSITIVE_INFINITY;
  if (token === "-Inf") return Number.NEGATIVE_INFINITY;
  if (token === "NaN") return Number.NaN;
  const value = Number(token);
  return Number.isNaN(value) ? null : value;
}
