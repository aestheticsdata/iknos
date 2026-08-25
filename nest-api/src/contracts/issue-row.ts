/**
 * One grouped error as it crosses the wire — the table's row, the rail panel's row, and the head
 * of the detail modal (IKN-14).
 *
 * **The fingerprint is the identifier here, and `issue.id` is absent on purpose.** The integer id
 * exists so `issue_event.issue_id` can be a narrow indexed column; it names nothing a reader has
 * seen. The fingerprint is already unique, already stable across restarts and deploys, already
 * what the row prints and what someone would paste into the palette — so it is what the routes,
 * the URLs and this contract are keyed on. A row carrying both would invite the front to address
 * the one identifier that is not on screen.
 *
 * `firstSeen` and `lastSeen` are ISO-8601 strings for the reason `LogRow.ts` is: a `Date` does not
 * survive JSON in either direction.
 */

/**
 * The three states, and they are the mockup's own words.
 *
 * `unresolved` rather than `open` because the filter segment is labelled "unresolved" — a column
 * named one thing and a control labelled another is how a filter that does not filter gets
 * written. A regression is **not** a fourth state: it is a flag on an `unresolved` issue, which is
 * the segment it most belongs in.
 */
export type IssueStatus = "unresolved" | "resolved" | "ignored";

export type IssueRow = {
  /** Sixteen hex characters. The public identifier — see the note above. */
  fingerprint: string;
  service: string;
  /** `TypeError`, `ConnectionAcquireTimeoutError`. Null for an exception that carried no type. */
  type: string | null;
  message: string;
  /** The first frame that is ours, normalised. Null when every frame belongs to a dependency. */
  culprit: string | null;
  /** pino's numeric scale, as everywhere else. */
  level: number;
  levelName: string;
  status: IssueStatus;
  /** A resolved issue that came back. Rendered distinctly: it is the case that wants attention. */
  regression: boolean;
  /** ISO-8601, UTC. Written once and never moved. */
  firstSeen: string;
  /** ISO-8601, UTC. */
  lastSeen: string;
  /** Every occurrence, including those the per-minute sample cap kept out of `issue_event`. */
  eventCount: number;
  /** Null until a deploy writes a release marker the collector can read — the column shows `—`. */
  firstRelease: string | null;
  lastRelease: string | null;
  /**
   * Occurrences per bucket over the window `IssuePage.spark` describes, oldest first.
   *
   * On the row rather than fetched per issue: the table draws one of these per line, and a
   * request each would be forty round trips for a chart 52 pixels wide. Always the full span of
   * buckets — an empty interval is a zero, never a missing entry, so the sparkline's x-axis is
   * the same window on every row.
   */
  spark: number[];
};
