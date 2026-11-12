/** What one pass of `ContentPurgeService` did (IKN-87 v2), for its log line and the tests. */
export type ContentPurgeReport = {
  /** `span_content` rows deleted. */
  deleted: number;
  /** `DELETE … LIMIT` statements run — at most `PURGE_MAX_BATCHES`. */
  batches: number;
  durationMs: number;
};
