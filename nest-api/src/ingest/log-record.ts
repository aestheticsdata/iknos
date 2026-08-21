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
  /**
   * Set when the line could not be read as JSON and was stored as plain text instead.
   *
   * **The one field here that is not a column**, and deliberately so: it says something about the
   * reading, not about the line, and `GET /api/collector/status` counts it (IKN-24) so that a
   * service which has quietly stopped emitting ECS is visible without anyone going to look. The
   * writer's `toRow` names every column it maps, so this cannot reach MySQL by accident.
   */
  degraded?: true;
};
