import type { Span, SpanContent, SpanEvent } from "@generated/prisma/client";
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
  /**
   * When this span's content (prompts, answers, notes — `span_content`) is purged, or `null` when
   * none was kept. Set at ingest, so the read can tell "expired" from "never captured" after the
   * purge has removed every trace of the content itself.
   */
  contentUntil: Date | null;
  /** The retention, in days, that `contentUntil` was computed from — what the view says expired. */
  contentDays: number | null;
};

/** One span event, metadata only, ready for `span_event`. */
export type SpanEventRecord = {
  /** The span's `ts`, not the event's: the event lives and is dropped in its span's partition. */
  ts: Date;
  service: string;
  traceId: string;
  spanId: string;
  /** Position in the span's `events` list — with the span's key, what makes a resend harmless. */
  eventIndex: number;
  /** Unix microseconds. */
  timeUs: bigint;
  name: string;
  attrs: Record<string, AttrValue> | null;
};

/** One content value, apart from the metadata, with its own expiry. */
export type SpanContentRecord = {
  traceId: string;
  spanId: string;
  spanTs: Date;
  /** The event it came from, or `SPAN_LEVEL_INDEX` for the span's own attributes and status. */
  eventIndex: number;
  contentKey: string;
  /** The decoded attribute value, JSON-encoded, so an array reads back as an array. */
  value: string;
  expiresAt: Date;
};

/** What the parser needs besides the body: whose spans these are, and what "now" is. */
export type ParseContext = {
  service: string;
  now: Date;
  /** Spans that started longer ago than this would land in a partition retention already dropped. */
  maxAgeDays: number;
  /**
   * The most days any content may be kept — `IKNOS_CONTENT_MAX_RETENTION_DAYS`, never more than
   * `maxAgeDays` (content must not outlive the span it belongs to). 0 keeps no content at all.
   */
  contentMaxDays: number;
};

/** The rows one request writes, in the three tables. */
export type ParsedBatch = {
  spans: SpanRecord[];
  events: SpanEventRecord[];
  contents: SpanContentRecord[];
};

/** The spans worth storing, and an account of the ones that were not. */
export type ParseOutcome = ParsedBatch & {
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

/** One trace's rows from the three tables, as `TracesService.spans` reads them. */
export type TraceRows = {
  spans: Span[];
  events: SpanEvent[];
  /** Only the rows not yet expired — an expired row the purge has not reached yet is not content. */
  contents: SpanContent[];
};

/** `pnpm token:create <service> --origin … [--label …]`, parsed. */
export type CreateTokenArgs = {
  service: string;
  origins: string[];
  label: string | null;
};
