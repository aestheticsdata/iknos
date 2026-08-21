import type { Meta } from "./meta";

/**
 * Iknos observing itself — what the top bar's pastille, the rail's `INGEST · 60m` card and the
 * storage panel consume (IKN-24).
 *
 * **Every `null` below means "I do not know", and never "zero".** A collector that has just
 * started has written nothing, read nothing and measured no lag, and the difference between that
 * and a collector that has stopped is the entire value of the pastille. Sending zeroes for both
 * would make a cold start indistinguishable from an outage — which is precisely the failure this
 * route exists to make visible.
 */

/** One tailed file and where reading resumes from. */
export type CollectorFile = {
  filePath: string;
  byteOffset: number;
};

/** The last hour of throughput, pre-bucketed so the browser draws it without arithmetic. */
export type IngestRate = {
  /** Lines per minute, oldest first, sixty long. */
  perMinute: number[];
  /** Lines over the window. */
  lines: number;
  /** Bytes over the window. */
  bytes: number;
};

export type CollectorStatus = {
  /**
   * Delay between a line being emitted and its transaction committing, measured at the last
   * flush. `null` before anything has been written.
   *
   * Not "now minus the newest line": that climbs on its own while ks-b is quiet, and would report
   * hours of lag for a collector doing exactly what it should.
   */
  lagMs: number | null;
  /** ISO-8601 UTC, or `null` before the first write. */
  lastWrittenAt: string | null;
  /**
   * When the tailer last completed a pass — the liveness signal, and the only one.
   *
   * A pass stamps this whether it found bytes or not, so it goes stale only when the loop has
   * genuinely stopped. That is what lets the pastille turn red within a minute of the collector
   * dying without turning red every night when the host has nothing to say.
   */
  lastPollAt: string | null;
  written: number;
  /** Lines abandoned because the writer's queue was full — backpressure, and the one real alarm. */
  dropped: number;
  /** Lines that looked like JSON, would not parse, and were stored as plain text. */
  degraded: number;
  /** Records waiting to be flushed right now. */
  queued: number;
  bytesRead: number;
  /** `null` until the first line has been written — an empty window is not a flat one. */
  rate: IngestRate | null;
  files: CollectorFile[];
  /**
   * The server's clock when this snapshot was taken.
   *
   * Sent so that the browser can age `lastPollAt` **without ever comparing the two machines'
   * clocks**. `Date.now() - Date.parse(lastPollAt)` looks right and is not: a laptop a minute
   * behind the server reports the collector as freshly polled forever, and one a minute ahead
   * paints the pastille red against a collector that is fine. Subtracting two server timestamps
   * and then adding locally-measured elapsed time keeps every subtraction inside one clock.
   */
  observedAt: string;
  meta: Meta;
};

/** One row of the storage panel. */
export type StorageTable = {
  /** The MySQL table name, which is what the panel labels the row with. */
  name: string;
  /** `data_length + index_length`, as `information_schema` reports it. */
  bytes: number;
  /** Days kept, or `null` for a table nothing prunes — the panel's `∞`. */
  retentionDays: number | null;
};

/** The filesystem the API is running on. `null` when the platform would not say. */
export type DiskUsage = {
  freeBytes: number;
  totalBytes: number;
};

export type CollectorStorage = {
  tables: StorageTable[];
  totalBytes: number;
  /** The window in force, from `IKNOS_RETENTION_DAYS`. */
  retentionDays: number;
  /** Oldest day still held, ISO date. `null` before the first maintenance pass has run. */
  oldestPartition: string | null;
  /** When partition maintenance last completed, ISO-8601 UTC. */
  lastPurgeAt: string | null;
  /** When it next runs, as a plain `HH:MM` in the server's zone — the panel's footer line. */
  purgeAt: string;
  disk: DiskUsage | null;
  /**
   * When this snapshot was computed. The route is cached for minutes at a time, and a panel that
   * showed a five-minute-old number as if it were live would be lying about the one thing it is
   * for.
   */
  computedAt: string;
  meta: Meta;
};
