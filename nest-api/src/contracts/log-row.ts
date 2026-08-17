/**
 * One log line as it crosses the wire — from the search, from a trace, and from the live tail.
 *
 * One shape for all three on purpose: the front end has a single row renderer, and a line that
 * arrives over SSE looks like the same line re-read from the database a second later.
 *
 * Two fields are deliberately not the database's own types:
 *
 * - `id` is a string. `log_entry.id` is an `UNSIGNED BIGINT`; past 2^53 a JSON number is rounded
 *   silently, and since the keyset cursor is built from `(ts, id)` a rounded id skips rows.
 *   `JSON.stringify` also throws outright on a `BigInt`, so this is not optional.
 * - `ts` is an ISO-8601 string, in UTC. A `Date` does not survive JSON either way.
 *
 * `attrs` is absent on purpose: two hundred rows of arbitrary JSON is a payload nobody reads.
 * The detail panel fetches what it needs when a row is opened.
 */
export type LogRow = {
  /** Decimal digits. Empty for a row arriving over the live tail, which has no id yet. */
  id: string;
  /** ISO-8601, UTC. */
  ts: string;
  service: string;
  /** pino's numeric scale — 10 trace … 60 fatal. What sorting and filtering use. */
  level: number;
  levelName: string;
  message: string;
  traceId: string | null;
  httpMethod: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
};
