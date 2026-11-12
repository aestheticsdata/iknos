import {
  CONTENT_KEYS,
  CONTENT_RETENTION_ATTR,
  DEFAULT_CONTENT_RETENTION_DAYS,
  GEN_AI_ATTR,
  MAX_ARRAY_ITEMS,
  MAX_ATTRIBUTES,
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_NAME_CHARS,
  MAX_EVENTS_PER_REQUEST,
  MAX_EVENTS_PER_SPAN,
  MAX_KEY_CHARS,
  MAX_MODEL_CHARS,
  MAX_NAME_CHARS,
  MAX_OPERATION_CHARS,
  MAX_SPAN_KIND,
  MAX_SPANS_PER_REQUEST,
  MAX_STATUS_MESSAGE_CHARS,
  MAX_STRING_CHARS,
  RESOURCE_PREFIX,
  SCOPE_NAME_ATTR,
  SCOPE_VERSION_ATTR,
  SERVICE_NAME_ATTR,
  SPAN_LEVEL_INDEX,
  SPAN_STATUS,
  STATUS_MESSAGE_CONTENT_KEY,
} from "./otlp-limits";

import type {
  AttrScalar,
  AttrValue,
  ParseContext,
  ParseOutcome,
  SpanContentRecord,
  SpanEventRecord,
  SpanRecord,
  SpanStatusCode,
} from "./interfaces/otlp-types";

/**
 * OTLP/HTTP JSON → `SpanRecord`s (IKN-87). Pure: no database, no clock but the one it is handed.
 *
 * **Two kinds of wrong, two answers.** An envelope that is not OTLP at all — not an object,
 * `resourceSpans` that is not a list, more spans than one request may carry — is refused whole
 * with `OtlpMalformedError`, which the controller turns into a 400: the sender is broken and
 * storing half of what it sent would hide that. A single span that is unusable — an id of the
 * wrong length, an end before its start — costs itself only and is counted in `rejected`, which
 * becomes the OTLP `partialSuccess.rejectedSpans`. That is the protocol's own contract, and the
 * rule the log collector applies to a bad line.
 *
 * **Unknown fields are ignored, known ones are bounded.** OTLP grows; a newer exporter adding
 * `links` or `droppedAttributesCount` must keep working. Every value that is kept is cut
 * to a column's width or a fixed ceiling here, so nothing downstream can fail an INSERT and take
 * the batch with it.
 *
 * **Metadata and content part ways here** (IKN-87 v2). The keys in `CONTENT_KEYS` — prompts,
 * answers, a reviewer's note — and the span's `status.message` never reach `span.attrs` or
 * `span_event.attrs`: they become `SpanContentRecord`s with an `expiresAt` of their own, from the
 * retention the batch states (`officina.content.retention_days` on the resource), capped by the
 * server. Metadata keeps the log window; content keeps what its sender allowed, and never longer.
 */

/** Thrown for an envelope that is not OTLP — a 400, never a partial success. */
export class OtlpMalformedError extends Error {}

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const ALL_ZERO = /^0+$/;
const DIGITS = /^\d+$/;
const INTEGER = /^-?\d+$/;
const INT32_MAX = 2_147_483_647;
const DAY_MS = 86_400_000;

/** What one resource contributes to each of its spans. */
type SpanParent = {
  ctx: ParseContext;
  /** `resource.*` and `otel.scope.*`, already decoded and prefixed. */
  inherited: Record<string, AttrValue>;
  /** Days this resource's content is kept; 0 keeps none. */
  contentDays: number;
  /** Events still allowed in this request — shared by every span of it, so it is an object. */
  budget: { events: number };
};

/** One span's rows: the span, its events, and the content taken out of both. */
type ParsedSpan = {
  span: SpanRecord;
  events: SpanEventRecord[];
  contents: SpanContentRecord[];
};

/** One span's verdict: its rows, or the reason it was not one. */
type SpanVerdict = ({ ok: true } & ParsedSpan) | { ok: false; reason: string };

/** What a span's events are parsed against: the span, its resource, and where content goes. */
type EventScope = {
  span: SpanRecord;
  parent: SpanParent;
  owner: ContentOwner | null;
};

/** Where a span's content is filed: which span, and when it goes. */
type ContentOwner = {
  traceId: string;
  spanId: string;
  spanTs: Date;
  expiresAt: Date;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A list where the envelope promises one; absent is empty, anything else is malformed. */
function listAt(holder: Record<string, unknown>, key: string): unknown[] {
  const value = holder[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OtlpMalformedError(`'${key}' must be an array`);
  return value;
}

/** Each element of a list the envelope promises objects in; a non-object is malformed. */
function objectsAt(holder: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return listAt(holder, key).map((item) => {
    if (!isObject(item)) throw new OtlpMalformedError(`'${key}' must contain objects`);
    return item;
  });
}

const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

/**
 * An OTLP `AnyValue` scalar. `intValue` is a string in proto3 JSON (int64 does not fit a double)
 * and a number from some encoders; both are read, and kept as a string only past 2⁵³ where a
 * number would silently round. Non-finite doubles and `bytesValue` are dropped: neither has a
 * JSON form a reader could use.
 */
function decodeScalar(value: Record<string, unknown>): AttrScalar | undefined {
  if (typeof value.stringValue === "string") return cut(value.stringValue, MAX_STRING_CHARS);
  if (typeof value.boolValue === "boolean") return value.boolValue;

  const int = value.intValue;
  if (typeof int === "number" && Number.isInteger(int)) return int;
  if (typeof int === "string" && INTEGER.test(int)) {
    const n = Number(int);
    return Number.isSafeInteger(n) ? n : int;
  }

  const double = value.doubleValue;
  if (typeof double === "number" && Number.isFinite(double)) return double;
  return undefined;
}

/** A scalar, or a flat array of scalars. `kvlistValue` and nested arrays are dropped. */
function decodeValue(value: unknown): AttrValue | undefined {
  if (!isObject(value)) return undefined;

  const scalar = decodeScalar(value);
  if (scalar !== undefined) return scalar;

  if (isObject(value.arrayValue) && Array.isArray(value.arrayValue.values)) {
    return value.arrayValue.values
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => (isObject(item) ? decodeScalar(item) : undefined))
      .filter((item): item is AttrScalar => item !== undefined);
  }
  return undefined;
}

/**
 * `[{key, value}]` → a plain object, bounded. Malformed entries are skipped, never fatal: an
 * attribute is a detail of a span, and losing one is a smaller harm than losing the span.
 */
export function decodeAttributes(list: unknown): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  if (!Array.isArray(list)) return out;

  let kept = 0;
  for (const entry of list) {
    if (kept >= MAX_ATTRIBUTES) break;
    if (!isObject(entry) || typeof entry.key !== "string") continue;
    if (entry.key === "" || entry.key.length > MAX_KEY_CHARS) continue;

    const value = decodeValue(entry.value);
    if (value === undefined) continue;
    out[entry.key] = value;
    kept += 1;
  }
  return out;
}

/** The attributes every span of a resource inherits, minus the service name the token overrides. */
function inheritedAttrs(resourceAttrs: Record<string, AttrValue>, scope: unknown): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};

  for (const [key, value] of Object.entries(resourceAttrs)) {
    if (key !== SERVICE_NAME_ATTR) out[`${RESOURCE_PREFIX}${key}`] = value;
  }

  if (isObject(scope)) {
    if (typeof scope.name === "string" && scope.name !== "") out[SCOPE_NAME_ATTR] = cut(scope.name, MAX_KEY_CHARS);
    if (typeof scope.version === "string" && scope.version !== "") {
      out[SCOPE_VERSION_ATTR] = cut(scope.version, MAX_KEY_CHARS);
    }
  }
  return out;
}

/** A Unix-nanosecond field: a digit string, as proto3 JSON writes a `fixed64`, or a number. */
function readNanos(value: unknown): bigint | null {
  if (typeof value === "string" && DIGITS.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  return null;
}

/** Lower-cased hex of the right length and not all zeros — OTLP's own definition of a valid id. */
function readId(value: unknown, shape: RegExp): string | null {
  if (typeof value !== "string") return null;
  const id = value.toLowerCase();
  return shape.test(id) && !ALL_ZERO.test(id) ? id : null;
}

const readStatusCode = (code: unknown): SpanStatusCode =>
  code === SPAN_STATUS.ok || code === SPAN_STATUS.error ? code : SPAN_STATUS.unset;

const readKind = (kind: unknown): number =>
  typeof kind === "number" && Number.isInteger(kind) && kind >= 0 && kind <= MAX_SPAN_KIND ? kind : 0;

/** A token count fits `INT` and is never negative; anything else stays in `attrs` untouched. */
const readCount = (value: AttrValue | undefined): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INT32_MAX ? value : null;

const readText = (value: AttrValue | undefined, max: number): string | null =>
  typeof value === "string" && value !== "" ? cut(value, max) : null;

/**
 * The four GenAI columns, taken out of the attributes they came from — a value is a column or an
 * attribute, never both, the rule `log_entry` keeps. A value that does not fit its column (a
 * negative token count, a model that is a number) is left in `attrs` rather than coerced.
 */
function promote(attrs: Record<string, AttrValue>) {
  const genAiOperation = readText(attrs[GEN_AI_ATTR.operation], MAX_OPERATION_CHARS);
  const genAiModel = readText(attrs[GEN_AI_ATTR.requestModel], MAX_MODEL_CHARS);
  const inputTokens = readCount(attrs[GEN_AI_ATTR.inputTokens]);
  const outputTokens = readCount(attrs[GEN_AI_ATTR.outputTokens]);

  if (genAiOperation !== null) delete attrs[GEN_AI_ATTR.operation];
  if (genAiModel !== null) delete attrs[GEN_AI_ATTR.requestModel];
  if (inputTokens !== null) delete attrs[GEN_AI_ATTR.inputTokens];
  if (outputTokens !== null) delete attrs[GEN_AI_ATTR.outputTokens];

  return { genAiOperation, genAiModel, inputTokens, outputTokens };
}

/**
 * The days a batch's content is kept: what its resource states, never more than the server's cap.
 *
 * A stated retention must be a whole number of days, zero or more; zero means "keep none" and is
 * honoured. Absent or anything else — a string, a fraction, a negative — reads as the default
 * week rather than as the cap: a sender that cannot say how long is not trusted with the longest.
 */
export function contentRetentionDays(stated: AttrValue | undefined, cap: number): number {
  const days =
    typeof stated === "number" && Number.isInteger(stated) && stated >= 0 ? stated : DEFAULT_CONTENT_RETENTION_DAYS;
  return Math.max(0, Math.min(days, cap));
}

const CONTENT_KEY_SET: ReadonlySet<string> = new Set(CONTENT_KEYS);

/** Takes the content keys out of `attrs`, in place, and returns them. */
export function takeContent(attrs: Record<string, AttrValue>): [string, AttrValue][] {
  const taken: [string, AttrValue][] = [];
  for (const key of Object.keys(attrs)) {
    if (!CONTENT_KEY_SET.has(key)) continue;
    taken.push([key, attrs[key]]);
    delete attrs[key];
  }
  return taken;
}

/** Content rows for one owner — none at all when its retention is zero days. */
function contentRows(owner: ContentOwner | null, eventIndex: number, values: [string, AttrValue][]) {
  if (owner === null) return [];
  return values.map(
    ([contentKey, value]): SpanContentRecord => ({
      traceId: owner.traceId,
      spanId: owner.spanId,
      spanTs: owner.spanTs,
      eventIndex,
      contentKey,
      value: JSON.stringify(value),
      expiresAt: owner.expiresAt,
    }),
  );
}

/**
 * A span's events, metadata and content apart. An event without a string name or a usable time is
 * skipped — the span stays. The index is the event's position in the list as sent, so a resend
 * of the same span maps every event onto the row it wrote the first time.
 */
function parseEvents(raw: unknown, at: EventScope): ParsedSpan {
  const { span, parent, owner } = at;
  const events: SpanEventRecord[] = [];
  const contents: SpanContentRecord[] = [];
  const out = { span, events, contents };
  if (!Array.isArray(raw)) return out;

  const list = raw.slice(0, MAX_EVENTS_PER_SPAN);
  for (const [eventIndex, item] of list.entries()) {
    if (parent.budget.events <= 0) break;
    if (!isObject(item) || typeof item.name !== "string" || item.name === "") continue;
    const timeNs = readNanos(item.timeUnixNano);
    if (timeNs === null) continue;

    parent.budget.events -= 1;
    const attrs = decodeAttributes(item.attributes);
    contents.push(...contentRows(owner, eventIndex, takeContent(attrs)));
    events.push({
      ts: span.ts,
      service: span.service,
      traceId: span.traceId,
      spanId: span.spanId,
      eventIndex,
      timeUs: timeNs / 1000n,
      name: cut(item.name, MAX_EVENT_NAME_CHARS),
      attrs: Object.keys(attrs).length > 0 ? attrs : null,
    });
  }
  return out;
}

/** One span, or the reason it is not one. */
function parseSpan(raw: Record<string, unknown>, parent: SpanParent): SpanVerdict {
  const traceId = readId(raw.traceId, TRACE_ID);
  if (traceId === null) return { ok: false, reason: "traceId must be 32 hex characters, not all zero" };

  const spanId = readId(raw.spanId, SPAN_ID);
  if (spanId === null) return { ok: false, reason: "spanId must be 16 hex characters, not all zero" };

  // Absent, empty or all zeros all mean "a root" in OTLP; anything else has to be a real id.
  const rawParent = raw.parentSpanId;
  const isRoot =
    rawParent === undefined ||
    rawParent === null ||
    rawParent === "" ||
    (typeof rawParent === "string" && ALL_ZERO.test(rawParent));
  const parentSpanId = isRoot ? null : readId(rawParent, SPAN_ID);
  if (!isRoot && parentSpanId === null) return { ok: false, reason: "parentSpanId must be 16 hex characters" };

  if (typeof raw.name !== "string") return { ok: false, reason: "name must be a string" };

  const startNs = readNanos(raw.startTimeUnixNano);
  const endNs = readNanos(raw.endTimeUnixNano);
  if (startNs === null || endNs === null) return { ok: false, reason: "start and end times must be Unix nanoseconds" };
  if (endNs < startNs) return { ok: false, reason: "a span cannot end before it starts" };

  const startUs = startNs / 1000n;
  const startMs = Number(startUs / 1000n);
  const { now, maxAgeDays, service } = parent.ctx;
  if (startMs > now.getTime() + MAX_CLOCK_SKEW_MS) return { ok: false, reason: "span starts in the future" };
  if (startMs < now.getTime() - maxAgeDays * DAY_MS) return { ok: false, reason: "span is older than the retention" };

  const status = isObject(raw.status) ? raw.status : {};
  const attrs = { ...parent.inherited, ...decodeAttributes(raw.attributes) };
  const promoted = promote(attrs);
  const spanContent = takeContent(attrs);
  if (typeof status.message === "string" && status.message !== "") {
    spanContent.push([STATUS_MESSAGE_CONTENT_KEY, cut(status.message, MAX_STATUS_MESSAGE_CHARS)]);
  }

  const ts = new Date(startMs);
  const { contentDays } = parent;
  const owner: ContentOwner | null =
    contentDays > 0 ? { traceId, spanId, spanTs: ts, expiresAt: new Date(now.getTime() + contentDays * DAY_MS) } : null;

  const span: SpanRecord = {
    ts,
    service,
    traceId,
    spanId,
    parentSpanId,
    name: cut(raw.name, MAX_NAME_CHARS),
    kind: readKind(raw.kind),
    startUs,
    durationUs: endNs / 1000n - startUs,
    statusCode: readStatusCode(status.code),
    // Content, so it is never kept beside the metadata — see `STATUS_MESSAGE_CONTENT_KEY`.
    statusMessage: null,
    ...promoted,
    attrs: Object.keys(attrs).length > 0 ? attrs : null,
    contentUntil: null,
    contentDays: null,
  };

  const parsed = parseEvents(raw.events, { span, parent, owner });
  parsed.contents.unshift(...contentRows(owner, SPAN_LEVEL_INDEX, spanContent));
  // Marked only when something was kept: no mark reads as "metadata only", a mark with no rows
  // left as "expired" — the distinction the view draws once the purge has run.
  if (owner !== null && parsed.contents.length > 0) {
    span.contentUntil = owner.expiresAt;
    span.contentDays = contentDays;
  }
  return { ok: true, ...parsed };
}

/**
 * Counts before parsing, so a ten-thousand-span request is refused before any of it is decoded.
 * Malformed nesting surfaces here too, as the 400 it is.
 */
function countSpans(resourceSpans: Record<string, unknown>[]): number {
  let total = 0;
  for (const rs of resourceSpans) {
    for (const ss of objectsAt(rs, "scopeSpans")) total += listAt(ss, "spans").length;
  }
  return total;
}

/**
 * The whole request. `service` comes from the context — the token's — and every span is stamped
 * with it; `service.name` in the resource is dropped unread.
 */
export function parseTraces(body: unknown, ctx: ParseContext): ParseOutcome {
  if (!isObject(body)) throw new OtlpMalformedError("the body must be an OTLP ExportTraceServiceRequest object");

  const resourceSpans = objectsAt(body, "resourceSpans");
  const total = countSpans(resourceSpans);
  if (total > MAX_SPANS_PER_REQUEST) {
    throw new OtlpMalformedError(`at most ${MAX_SPANS_PER_REQUEST} spans per request, got ${total}`);
  }

  const spans: SpanRecord[] = [];
  const events: SpanEventRecord[] = [];
  const contents: SpanContentRecord[] = [];
  const reasons: string[] = [];
  const budget = { events: MAX_EVENTS_PER_REQUEST };
  let rejected = 0;

  for (const rs of resourceSpans) {
    const resourceAttrs = isObject(rs.resource) ? decodeAttributes(rs.resource.attributes) : {};
    const contentDays = contentRetentionDays(resourceAttrs[CONTENT_RETENTION_ATTR], ctx.contentMaxDays);

    for (const ss of objectsAt(rs, "scopeSpans")) {
      const parent: SpanParent = { ctx, inherited: inheritedAttrs(resourceAttrs, ss.scope), contentDays, budget };

      for (const raw of listAt(ss, "spans")) {
        const verdict = isObject(raw)
          ? parseSpan(raw, parent)
          : { ok: false as const, reason: "a span must be an object" };
        if (verdict.ok) {
          spans.push(verdict.span);
          events.push(...verdict.events);
          contents.push(...verdict.contents);
        } else {
          rejected += 1;
          if (!reasons.includes(verdict.reason)) reasons.push(verdict.reason);
        }
      }
    }
  }

  return { spans, events, contents, rejected, reasons };
}
