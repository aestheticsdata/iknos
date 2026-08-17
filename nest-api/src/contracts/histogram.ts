import type { Meta } from "./meta";

/**
 * One bar of the volume chart, already split by severity so the browser stacks it without any
 * post-processing.
 *
 * The three counts follow pino's scale and between them cover every level: `error` is 50 and
 * above, so `fatal` is counted as an error rather than quietly falling out of the total.
 */
export type Bucket = {
  /** Start of the interval, ISO-8601 UTC. */
  t: string;
  /** level >= 50 */
  error: number;
  /** level == 40 */
  warn: number;
  /** level < 40 */
  info: number;
};

/**
 * `bucketMs` is chosen by the server from the requested range, never by the caller: a week asked
 * for in one-second intervals is six hundred thousand points that nobody can draw and MySQL
 * should not have been asked to group.
 *
 * `buckets` covers the whole requested range with no gaps — an interval with no logs is a row of
 * zeroes, not a missing entry. The x-axis has to stay the range the user asked for.
 */
export type Histogram = {
  bucketMs: number;
  buckets: Bucket[];
  meta: Meta;
};
