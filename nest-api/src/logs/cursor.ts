/**
 * The pagination cursor: the `(ts, id)` of the last row of a page, base64url so that it is
 * opaque to the client and survives a query string untouched.
 *
 * Opaque on purpose. The client's whole contract with it is "hand it back", which leaves the
 * ordering key free to change without a coordinated release — and stops a caller from crafting
 * one by hand and paginating through a window it was not given.
 *
 * The id is carried as decimal text and rebuilt as a `bigint`. `log_entry.id` is an
 * `UNSIGNED BIGINT` and passes 2^53; a cursor that round-tripped through a JSON number would
 * start skipping rows at exactly the point where the table is large enough for the pagination
 * to matter.
 */

export function encodeCursor(ts: Date, id: bigint): string {
  return Buffer.from(`${ts.getTime()}:${id}`).toString("base64url");
}

/**
 * Returns `null` for anything malformed rather than throwing.
 *
 * A cursor comes from a URL, so garbage is an ordinary event — a truncated copy-paste, a stale
 * bookmark. The caller decides what that means; here it simply means "no cursor".
 */
export function decodeCursor(raw: string): { ts: Date; id: bigint } | null {
  try {
    const [ms, id] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    if (!ms || !id) return null;

    const at = Number(ms);
    if (!Number.isFinite(at)) return null;

    return { ts: new Date(at), id: BigInt(id) };
  } catch {
    // BigInt() throws on non-numeric text; Buffer.from does not, which is why the shape is
    // checked as well as the decode.
    return null;
  }
}
