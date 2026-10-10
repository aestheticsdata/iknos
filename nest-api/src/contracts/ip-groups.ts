import type { Meta } from "./meta";

/**
 * One caller's footprint over the range — a row of `GET /api/logs/ips` (IKN-72).
 *
 * `routes` is the number that separates a scan from a busy client: a reader refreshing a page is
 * many hits on one route, a scanner is many hits on many. Counting both is what turns "this
 * address looks noisy" into a number without reading a single line.
 */
export type IpGroup = {
  ip: string;
  hits: number;
  /** Distinct `route` values. Lines with no route (an app line that happens to carry an IP) add none. */
  routes: number;
  /** ISO-8601, UTC — the caller's most recent line inside the range. */
  lastSeen: string;
};

/**
 * The busiest addresses under the same filters the list and the histogram use, busiest first.
 *
 * Capped, and `truncated` says so: the question is "who is hammering this box", which the top of
 * the list answers, and the long tail of one-hit addresses is the one part nobody reads.
 */
export type IpGroups = {
  groups: IpGroup[];
  truncated: boolean;
  meta: Meta;
};
