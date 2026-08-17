/**
 * The shape a log line takes the moment it is parsed, and keeps across every boundary after —
 * queue, writer, event bus, query responses. One type, so the collector and the read side can
 * never drift apart about what a log *is*.
 *
 * Field names mirror the `log_entry` columns; the mapping in the writer is mechanical on purpose.
 */
export type LogRecord = {
  ts: Date;
  service: string;
  /** pino's numeric scale — what the UI sorts and filters on. */
  level: number;
  levelName: string;
  logger: string | null;
  message: string;
  traceId: string | null;
  httpMethod: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
  clientIp: string | null;
  userId: string | null;
  hostname: string | null;
  /** Whatever the line carried beyond the promoted columns. Never duplicates them. */
  attrs: Record<string, unknown> | null;
};
