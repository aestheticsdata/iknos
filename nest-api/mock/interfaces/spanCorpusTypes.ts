/**
 * The AI pipeline runs of the mock corpus (IKN-90), as `mock/spans.json` holds them.
 *
 * Compact on purpose: OTLP/JSON spells every attribute as `{ key, value: { stringValue } }`, which
 * would triple the file. The loader expands each span back into OTLP and hands it to the real
 * `parseTraces`, so nothing here reaches the table without going through the production parser.
 */

/** An attribute value as Officina's exporter sends it: a scalar. */
export type CorpusAttr = string | number | boolean;

/** One span event: `[timeMs, name, attributes]` — a gate's evaluation, a person's feedback. */
export type CorpusEvent = [number, string, Record<string, CorpusAttr>];

/**
 * One span: `[spanId, parentSpanId, name, startMs, endMs, statusCode, attributes, events]`.
 * `parentSpanId` is `""` for the root; times are epoch milliseconds before the loader's shift; the
 * status code is OTLP's (0 unset, 1 ok, 2 error). `events` is empty for most spans.
 */
export type CorpusSpan = [string, string, string, number, number, number, Record<string, CorpusAttr>, CorpusEvent[]];

/** One run: its trace id and every span of it. */
export type CorpusRun = {
  traceId: string;
  spans: CorpusSpan[];
};

/** Every run of one service, oldest first. */
export type CorpusService = {
  service: string;
  runs: CorpusRun[];
};

/** What `loadSpans` reports: spans written, and spans the production parser refused. */
export type SpanLoadResult = {
  stored: number;
  rejected: number;
};
