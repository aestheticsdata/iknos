import type { IssueRow } from "./issue-row";
import type { Meta } from "./meta";

/**
 * A page of grouped errors (IKN-14).
 *
 * Keyset like `LogPage`, and `nextCursor` is opaque for the same reasons — the client's whole
 * contract with it is to hand it back. What it encodes depends on the sort the page was read
 * with, which is precisely why the client is not allowed to read it: continuing a volume-sorted
 * page with a cursor cut from a time-sorted one would silently skip rows.
 */
export type IssuePage = {
  rows: IssueRow[];
  nextCursor: string | null;
  /**
   * The axis every row's `spark` is drawn on. One window for the whole page, chosen by the
   * server: the sparklines are only comparable if they share it, and a client-chosen window would
   * be a moving `now` in the URL that re-fetches the list on every tick.
   */
  spark: { from: string; to: string; bucketMs: number };
  meta: Meta;
};

/**
 * How many issues sit in each filter segment.
 *
 * Its own route rather than a field on the page, because a count taken from the page would be the
 * length of the page. The segments show these beside their labels, and the rail's badge is the
 * `unresolved` one — scoped to the same service, so the number beside the view name answers the
 * same question as everything else on screen.
 */
export type IssueCounts = {
  unresolved: number;
  resolved: number;
  ignored: number;
};
