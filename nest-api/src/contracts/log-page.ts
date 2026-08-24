import type { LogRow } from "./log-row";
import type { Meta } from "./meta";

/**
 * A page of search results.
 *
 * `nextCursor` is opaque: it encodes the `(ts, id)` of whichever row bounds this page in the
 * direction the request walked (`dir`), and the client's only contract with it is to hand it back
 * — with the same `dir` — to continue further that way. Keyset, never `LIMIT/OFFSET` — on a table
 * partitioned by day, a deep offset is exactly where naive pagination collapses, because the
 * server has to walk and discard every row it skips.
 *
 * `null` means there is nothing further in that direction.
 */
export type LogPage = {
  rows: LogRow[];
  nextCursor: string | null;
  meta: Meta;
};
