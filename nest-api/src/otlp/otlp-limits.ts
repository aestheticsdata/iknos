/**
 * The bounds and vocabularies of OTLP trace ingestion (IKN-87), in one place.
 *
 * Every number here is a ceiling on what one unauthenticated-by-session request can make the API
 * hold in memory or write to disk. The write token ships inside a JavaScript bundle, so these — not
 * the token — are what stand between a public route and the box.
 */

/** The route. nginx already proxies every `/api/` path to the API; nothing to add there. */
export const OTLP_TRACES_PATH = "/api/otlp/v1/traces";

/**
 * The largest body read, in body-parser's notation. The same megabyte as every other route
 * (`config/body-limit.ts`), and nginx's own default `client_max_body_size` — a full batch of
 * 1 000 GenAI spans with their prompts summarised comes nowhere near it.
 */
export const OTLP_BODY_LIMIT = "1mb";

/** A whole request is refused (400) above this — the OpenTelemetry SDKs export at most 512 per batch. */
export const MAX_SPANS_PER_REQUEST = 1000;

/** Attributes kept per span, and per resource; the rest are dropped, first ones first kept. */
export const MAX_ATTRIBUTES = 128;

/** A string attribute is cut here (characters) rather than refused — the OpenTelemetry SDKs' own rule. */
export const MAX_STRING_CHARS = 32_768;

/** Elements kept in an array attribute. */
export const MAX_ARRAY_ITEMS = 128;

/** An attribute key longer than this is dropped with its value. */
export const MAX_KEY_CHARS = 255;

/** Column widths, mirrored from `schema.prisma`. */
export const MAX_NAME_CHARS = 255;
export const MAX_STATUS_MESSAGE_CHARS = 1024;
export const MAX_OPERATION_CHARS = 64;
export const MAX_MODEL_CHARS = 128;

/** How far ahead of the server's clock a span may start: a laptop's clock, not a time machine. */
export const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

/** OTLP `Status.code`. */
export const SPAN_STATUS = { unset: 0, ok: 1, error: 2 } as const;

/** OTLP `SpanKind` runs from 0 (unspecified) to 5 (consumer); anything else reads as 0. */
export const MAX_SPAN_KIND = 5;

/** The GenAI semantic-convention attributes promoted to columns. */
export const GEN_AI_ATTR = {
  operation: "gen_ai.operation.name",
  requestModel: "gen_ai.request.model",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
} as const;

/** The resource attribute the token overrides — the payload never chooses its own service. */
export const SERVICE_NAME_ATTR = "service.name";

/** Where resource and scope facts land inside `attrs`, so a span attribute can never collide with one. */
export const RESOURCE_PREFIX = "resource.";
export const SCOPE_NAME_ATTR = "otel.scope.name";
export const SCOPE_VERSION_ATTR = "otel.scope.version";

/** The header the fetch path presents the token in, and the query parameter the beacon path uses. */
export const OTLP_TOKEN_HEADER = "x-iknos-token";
export const OTLP_TOKEN_QUERY = "token";

/** The two content types accepted: JSON, and the `text/plain` a `sendBeacon(string)` is sent as. */
export const OTLP_CONTENT_TYPES = ["application/json", "text/plain"] as const;
