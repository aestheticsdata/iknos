/**
 * Query parameters whose value never reaches a stored log line (IKN-87).
 *
 * `token` is the OTLP write token as `navigator.sendBeacon` has to send it: a beacon cannot set a
 * header, so the final flush of a page carries `?token=…` in the URL — and every URL is written
 * down twice on its way in. nginx's access log has it in `$request`, which the access-log source
 * ingests (IKN-16, IKN-84), and the API's own pino-http line has it in `url.query`, which the
 * collector tails like any other service. Either would file a working write credential into
 * `log_entry`, readable by anyone who can read the logs and kept for the whole retention window.
 *
 * A write token is not a secret in the strong sense — it ships inside a JavaScript bundle — but it
 * is a credential, and a monitoring tool that archives its own credentials is the bug IKN-30 was.
 */
const SENSITIVE_PARAMS = new Set(["token"]);

/** What a redacted value is replaced with — the same word the logger's own redaction writes. */
export const REDACTED = "[redacted]";

/** Decoded for the comparison only; a key that is not valid percent-encoding is compared raw. */
const decodeKey = (raw: string): string => {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
};

/**
 * `a=1&token=abc&b=2` → `a=1&token=[redacted]&b=2`.
 *
 * Built by hand rather than through `URLSearchParams`, which would re-encode every *other*
 * parameter on the way through: the stored query has to stay the bytes the client sent, or a
 * search for the literal string someone sees in their browser stops matching. Only the value of a
 * sensitive key changes; its key, its position and everything around it are left exactly as they
 * were. A bare `token` with no `=` carries no value and is left alone.
 */
export function redactQuery(query: string): string {
  if (query === "") return query;

  return query
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return part;
      const key = part.slice(0, eq);
      return SENSITIVE_PARAMS.has(decodeKey(key)) ? `${key}=${REDACTED}` : part;
    })
    .join("&");
}

/** A path with its query string, as `req.url` holds it. The fragment never reaches a server. */
export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?${redactQuery(url.slice(q + 1))}`;
}
