/**
 * The issues list's pagination cursor (IKN-14).
 *
 * Base64url and opaque, exactly like `logs/cursor.ts`, and for the same two reasons: the client's
 * whole contract with it is to hand it back, and an opaque token cannot be crafted by hand to
 * page through something the caller was not given.
 *
 * **Its own pair rather than `logs/cursor.ts`, and that is a deviation worth naming.** That one
 * encodes a `Date` and an `UNSIGNED BIGINT` row id, because a log page is always ordered by time.
 * This list is orderable by volume as well, where the key is `event_count` — an integer that is
 * not an instant and would have to be dressed as one to fit. `issue.id` is a plain `INT` too, so
 * the BigInt handling there buys nothing here. Two small functions that say what they carry beat
 * one that lies about it.
 *
 * The key travels as decimal text and comes back a number: epoch milliseconds for the two
 * time sorts, an occurrence count for the volume sort. Which of the two it is depends on the
 * `sort` the page was read with, which is why the token is opaque — continuing a volume page with
 * a time cursor would compare a count against a timestamp and skip everything.
 */

export function encodeIssueCursor(key: number, id: number): string {
  return Buffer.from(`${key}:${id}`).toString("base64url");
}

/**
 * `null` for anything malformed, never a throw.
 *
 * A cursor comes off a URL, so garbage is an ordinary event — a truncated copy-paste, a stale
 * bookmark. The caller decides what that means; here it means "no cursor", and the reader lands
 * on the first page instead of on a 400.
 */
export function decodeIssueCursor(raw: string): { key: number; id: number } | null {
  const [key, id] = Buffer.from(raw, "base64url").toString("utf8").split(":");
  if (key === undefined || id === undefined) return null;

  const k = Number(key);
  const i = Number(id);
  if (!Number.isFinite(k) || !Number.isInteger(i)) return null;

  return { key: k, id: i };
}
