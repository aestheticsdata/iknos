/**
 * The log API's response shapes, restated.
 *
 * Restated rather than imported, like every other contract in this front end: `nest-api/` and
 * `front/` are separate pnpm roots with separate lockfiles, and there is no shared package to
 * import from. The authoritative copies are `nest-api/src/contracts/*.ts`, and each type below
 * names the file it mirrors so a drift is one grep away.
 *
 * Only the fields the view reads are here. That is not laziness — a type that claims a field the
 * renderer never touches is a claim nobody checks.
 */

/** Mirrors `contracts/meta.ts`. */
export type Meta = {
  /** Measured around the database call, not the request. The status bar renders it as `q 38ms`. */
  tookMs: number;
};

/**
 * Mirrors `contracts/log-row.ts`.
 *
 * `id` is a **string** of decimal digits, not a number: `log_entry.id` is an unsigned BIGINT, and
 * past 2^53 a JSON number rounds silently — which, since the cursor is built from `(ts, id)`,
 * would skip rows. It is **empty** for a row that arrived over the live tail, which has been
 * committed but never read back and so does not know its autoincrement value yet.
 */
export type LogRow = {
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

/**
 * Mirrors `contracts/log-page.ts`.
 *
 * `nextCursor` is opaque and the only contract with it is to hand it back. `null` means this was
 * the last page.
 */
export type LogPage = {
  rows: LogRow[];
  nextCursor: string | null;
  meta: Meta;
};

/** Mirrors `contracts/histogram.ts`. `error` is level ≥ 50, so `fatal` counts as an error. */
export type Bucket = {
  /** Start of the interval, ISO-8601 UTC. */
  t: string;
  error: number;
  warn: number;
  info: number;
};

/**
 * Mirrors `contracts/histogram.ts`.
 *
 * `bucketMs` is the server's choice, never the caller's, and `buckets` covers the whole requested
 * range with no gaps — an interval with no logs is a row of zeroes. The x-axis is the range the
 * user asked for, always.
 */
export type Histogram = {
  bucketMs: number;
  buckets: Bucket[];
  meta: Meta;
};

/**
 * Mirrors `contracts/trace.ts`.
 *
 * Not a span tree and must never be drawn as one: Iknos does not do distributed tracing. This is
 * one request's course reconstructed from the lines the services happened to log.
 */
export type Trace = {
  traceId: string;
  rows: LogRow[];
  totalMs: number;
  /** The trace logged more lines than the endpoint returns, so `totalMs` covers only these. */
  truncated: boolean;
  meta: Meta;
};

/**
 * What the list actually renders: rows, and the holes between them.
 *
 * A gap is a first-class item rather than a flag on the row after it. The live tail drops lines
 * when a client cannot keep up and says so (`event: lagged`), and the view has to draw that break
 * *between* two rows — a tail that silently skips lines is worse than one that admits it, because
 * it still looks continuous. Modelling it as an item is also what keeps the list keyed correctly
 * when a gap arrives twice in a row.
 */
export type LogFeedItem = { kind: "row"; key: string; row: LogRow } | { kind: "gap"; key: string; dropped: number };

/**
 * pino's scale, as the parser and the API use it.
 *
 * The API accepts either a name or a number for `?level=`; the UI sends names, because a URL
 * someone reads over a shoulder should say `level=warn`.
 */
export const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export type LevelName = keyof typeof LEVELS;

/** The four worth offering as a minimum. `trace` and `fatal` exist but nobody filters on them. */
export const FILTERABLE_LEVELS = ["debug", "info", "warn", "error"] as const satisfies readonly LevelName[];

/**
 * Which tone a row is drawn in — the histogram splits the same way, so the two agree by
 * construction rather than by two lists that happen to match today.
 */
export const severityOf = (level: number): "error" | "warn" | "info" =>
  level >= LEVELS.error ? "error" : level === LEVELS.warn ? "warn" : "info";
