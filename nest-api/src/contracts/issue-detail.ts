import type { IssueRow } from "./issue-row";

/**
 * One issue in full — what the modal shows over and above the row it was opened from (IKN-14).
 *
 * A `LogDetail` widens a `LogRow` with columns the list leaves in the table; this widens an
 * `IssueRow` with the one thing the list has no room for: the latest occurrence, kept on the issue
 * itself so a stack outlives the event rows it came in on.
 */
export type IssueDetail = IssueRow & {
  /**
   * The most recent occurrence the grouper saw, or null for an issue whose sample would not read.
   *
   * `traceId` is the point of the modal. It is what turns "this threw" into the whole request that
   * produced it, and `ts` is what bounds the window that link has to carry — the log API refuses
   * an unbounded query (IKN-19), so an occurrence with no instant would be a link with no range.
   */
  latest: {
    /** ISO-8601, UTC. */
    ts: string;
    traceId: string | null;
    /** V8 text form, as thrown. Null when the exception carried no frames. */
    stack: string | null;
  } | null;
};
