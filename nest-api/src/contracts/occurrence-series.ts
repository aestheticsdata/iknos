/**
 * The occurrences of one issue over time — the modal's 48-hour chart (IKN-14).
 *
 * **Not a `Histogram`.** That type is `{ t, error, warn, info }` by construction: three counts
 * split by pino level, because the log volume chart genuinely has three series. An issue's
 * occurrences are one series by definition — every one of them is the same error at the same
 * level. Sending them as `error` with two permanent zeroes would be a shape claiming a split that
 * does not exist, which is the argument `contracts/histogram.ts` already makes in the other
 * direction.
 *
 * `counts` covers the whole window with no gaps, so a quiet hour is a zero rather than a missing
 * bar, and `bucketMs` is the server's choice — the caller owns the range, never the resolution.
 *
 * The counts are true occurrences, not sample rows: `issue_event` holds one sample per pass and
 * each carries how many throws it stands for. See the `count` column in the schema.
 */
export type OccurrenceSeries = {
  /** ISO-8601, UTC. The instant `counts[0]` starts at. */
  from: string;
  /** ISO-8601, UTC. */
  to: string;
  bucketMs: number;
  counts: number[];
};
