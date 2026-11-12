import type { SPAN_STATUS } from "../otlp-limits";

/**
 * The shapes OTLP trace ingestion works on (IKN-87).
 *
 * The payload arrives as `unknown` and is narrowed field by field in `otlp-parse.ts`; nothing here
 * describes the wire format, only what the parser hands on.
 */

/** OTLP `Status.code`: unset, ok, error. */
export type SpanStatusCode = (typeof SPAN_STATUS)[keyof typeof SPAN_STATUS];

/** An attribute value once decoded — a scalar, or a flat array of scalars. */
export type AttrScalar = string | number | boolean;
export type AttrValue = AttrScalar | AttrScalar[];

/** One span, validated and bounded, ready for `span` — `service` already taken from the token. */
export type SpanRecord = {
  ts: Date;
  service: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: number;
  startUs: bigint;
  durationUs: bigint;
  statusCode: SpanStatusCode;
  statusMessage: string | null;
  genAiOperation: string | null;
  genAiModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attrs: Record<string, AttrValue> | null;
};

/** What the parser needs besides the body: whose spans these are, and what "now" is. */
export type ParseContext = {
  service: string;
  now: Date;
  /** Spans that started longer ago than this would land in a partition retention already dropped. */
  maxAgeDays: number;
};

/** The spans worth storing, and an account of the ones that were not. */
export type ParseOutcome = {
  spans: SpanRecord[];
  rejected: number;
  /** Distinct reasons, in the order first met — the `errorMessage` of an OTLP partial success. */
  reasons: string[];
};

/** What a valid token grants: one service, and the origins a browser may send it from. */
export type TokenGrant = {
  id: number;
  service: string;
  origins: string[];
};

/** A token as the CLI creates it: the clear value to print once, and the hash to store. */
export type IssuedToken = {
  clear: string;
  hash: string;
};

/** What the CORS middleware needs of the token registry: is this origin any active token's? */
export type OriginCheck = {
  isKnownOrigin: (origin: string) => Promise<boolean>;
};

/**
 * One row of the trace-list aggregate as `$queryRaw` returns it. Numeric columns arrive as
 * `bigint`, `Decimal` or `number` depending on the expression, so they are `unknown` here and
 * narrowed by `toSummary`.
 */
export type RawTraceRow = {
  traceId: string;
  service: string;
  rootName: string | null;
  startUs: unknown;
  endUs: unknown;
  spanCount: unknown;
  anyError: unknown;
  anyOk: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
  models: string | null;
};

/** The trace list's question: one service, one window, a page size. */
export type TraceListQuery = {
  service: string;
  from: Date;
  to: Date;
  limit: number;
};

/** `pnpm token:create <service> --origin … [--label …]`, parsed. */
export type CreateTokenArgs = {
  service: string;
  origins: string[];
  label: string | null;
};
