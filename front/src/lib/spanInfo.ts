import { formatCount } from "@lib/format";
import { SPAN_KIND } from "@lib/interfaces/spanKindTypes";
import { SPAN_STATUS_CODE } from "@lib/interfaces/traceSpanTypes";
import {
  attrNumber,
  attrOf,
  attrString,
  firstTokenMsOf,
  isVerdict,
  OFFICINA,
  promptVersionOf,
  spanKindOf,
  spansById,
} from "@lib/spanKind";
import { formatMicros } from "@lib/spanTimeline";
import { TRACES_TEXT } from "@text/traces";

import type { InfoRow } from "@lib/interfaces/spanKindTypes";
import type { SpanRow, Timeline } from "@lib/interfaces/traceSpanTypes";

/**
 * The inspector's info tab (IKN-92): the few fields that matter for a span of its kind, formatted.
 * Pure. The raw attributes stay one tab over, untouched.
 */

const FIELD = TRACES_TEXT.field;

const STATUS_WORD: Record<number, string> = {
  [SPAN_STATUS_CODE.unset]: TRACES_TEXT.unset,
  [SPAN_STATUS_CODE.ok]: TRACES_TEXT.ok,
  [SPAN_STATUS_CODE.error]: TRACES_TEXT.error,
};

const count = (n: number | null): string => (n === null ? TRACES_TEXT.none : formatCount(n));

/** Every span under `root`, itself excluded. */
function descendants(root: SpanRow, spans: SpanRow[]): SpanRow[] {
  const children = new Map<string, SpanRow[]>();
  for (const span of spans) {
    if (span.parentSpanId === null) continue;
    const list = children.get(span.parentSpanId) ?? [];
    list.push(span);
    children.set(span.parentSpanId, list);
  }
  const out: SpanRow[] = [];
  const stack = [...(children.get(root.spanId) ?? [])];
  while (stack.length > 0) {
    const span = stack.pop() as SpanRow;
    out.push(span);
    stack.push(...(children.get(span.spanId) ?? []));
  }
  return out;
}

const timing = (span: SpanRow, timeline: Timeline): InfoRow[] => [
  { field: FIELD.duration, value: formatMicros(span.durationUs) },
  { field: FIELD.start, value: TRACES_TEXT.offset(formatMicros(span.startUs - timeline.startUs)) },
];

function modelRows(span: SpanRow, spans: SpanRow[]): InfoRow[] {
  const parent = span.parentSpanId ? spansById(spans).get(span.parentSpanId) : undefined;
  const attempt = attrNumber(span, OFFICINA.attempt) ?? (parent ? attrNumber(parent, OFFICINA.attempt) : null);
  const firstToken = firstTokenMsOf(span);
  const tps = attrNumber(span, OFFICINA.tokensPerSecond);
  const rows: InfoRow[] = [
    { field: FIELD.model, value: span.genAiModel ?? TRACES_TEXT.none },
    { field: FIELD.provider, value: attrString(span, OFFICINA.provider) ?? TRACES_TEXT.none },
    { field: FIELD.tokens, value: TRACES_TEXT.tokensSplit(count(span.inputTokens), count(span.outputTokens)) },
    { field: FIELD.firstToken, value: firstToken === null ? TRACES_TEXT.none : formatMicros(firstToken * 1000) },
    { field: FIELD.throughput, value: tps === null ? TRACES_TEXT.none : TRACES_TEXT.tokensPerSecond(tps.toFixed(0)) },
  ];
  if (attempt !== null) rows.push({ field: FIELD.attempt, value: TRACES_TEXT.attemptRetry(attempt) });
  return rows;
}

function verdictRows(span: SpanRow): InfoRow[] {
  const reasons = attrOf(span, OFFICINA.gateReasons);
  const score = attrNumber(span, OFFICINA.gateScore);
  return [
    {
      field: FIELD.verdict,
      value: attrOf(span, OFFICINA.gatePass) === true ? TRACES_TEXT.passed : TRACES_TEXT.failed_,
    },
    { field: FIELD.score, value: score === null ? TRACES_TEXT.none : score.toFixed(2) },
    {
      field: FIELD.reasons,
      value:
        typeof reasons === "number"
          ? TRACES_TEXT.reasonsCount(reasons)
          : Array.isArray(reasons)
            ? reasons.join(" · ")
            : TRACES_TEXT.none,
    },
  ];
}

function nodeRows(span: SpanRow, spans: SpanRow[]): InfoRow[] {
  const under = descendants(span, spans);
  const calls = under.filter((child) => spanKindOf(child) === SPAN_KIND.model);
  const attempts =
    attrNumber(span, OFFICINA.attempts) ?? under.filter((child) => spanKindOf(child) === SPAN_KIND.attempt).length;
  const tokens = calls.reduce((a, call) => a + (call.inputTokens ?? 0) + (call.outputTokens ?? 0), 0);
  return [
    { field: FIELD.node, value: attrString(span, OFFICINA.nodeId) ?? TRACES_TEXT.none },
    { field: FIELD.nodeKind, value: attrString(span, OFFICINA.nodeKind) ?? TRACES_TEXT.none },
    { field: FIELD.status, value: STATUS_WORD[span.statusCode] ?? TRACES_TEXT.unset },
    { field: FIELD.children, value: formatCount(under.length) },
    { field: FIELD.cumulatedTokens, value: formatCount(tokens) },
    { field: FIELD.attempts, value: formatCount(attempts) },
  ];
}

function attemptRows(span: SpanRow): InfoRow[] {
  const prompt = promptVersionOf(span);
  const cache = attrOf(span, OFFICINA.cacheHit);
  return [
    { field: FIELD.attempt, value: TRACES_TEXT.attemptRetry(attrNumber(span, OFFICINA.attempt) ?? 1) },
    { field: FIELD.prompt, value: prompt === null ? TRACES_TEXT.none : `v${prompt}` },
    { field: FIELD.model, value: span.genAiModel ?? TRACES_TEXT.none },
    {
      field: FIELD.cache,
      value: cache === true ? TRACES_TEXT.cacheHit : cache === false ? TRACES_TEXT.cacheMiss : TRACES_TEXT.none,
    },
  ];
}

function runRows(span: SpanRow, spans: SpanRow[]): InfoRow[] {
  const version = attrNumber(span, OFFICINA.pipelineVersion);
  const modelLoad = attrNumber(span, OFFICINA.modelLoadMs);
  return [
    { field: FIELD.pipelineVersion, value: version === null ? TRACES_TEXT.none : `v${version}` },
    { field: FIELD.runStatus, value: attrString(span, OFFICINA.runStatus) ?? TRACES_TEXT.none },
    { field: FIELD.modelLoad, value: modelLoad === null ? TRACES_TEXT.none : formatMicros(modelLoad * 1000) },
    { field: FIELD.gpu, value: attrString(span, OFFICINA.gpuVendor) ?? TRACES_TEXT.none },
    { field: FIELD.children, value: formatCount(spans.length - 1) },
  ];
}

function rowsByKind(span: SpanRow, spans: SpanRow[]): InfoRow[] {
  /* The sandbox running the tests is a tool *and* a verdict: its verdict is what a reader wants. */
  if (isVerdict(span)) return verdictRows(span);
  switch (spanKindOf(span)) {
    case SPAN_KIND.model:
      return modelRows(span, spans);
    case SPAN_KIND.verdict:
      return verdictRows(span);
    case SPAN_KIND.step:
    case SPAN_KIND.gate:
      return nodeRows(span, spans);
    case SPAN_KIND.attempt:
      return attemptRows(span);
    case SPAN_KIND.human:
      return [{ field: FIELD.decision, value: attrString(span, OFFICINA.decision) ?? TRACES_TEXT.none }];
    case SPAN_KIND.run:
      return runRows(span, spans);
    default:
      return [{ field: FIELD.status, value: STATUS_WORD[span.statusCode] ?? TRACES_TEXT.unset }];
  }
}

/** The rows the info tab lists for `span`, by kind, then its timing. */
export function infoRows(span: SpanRow, spans: SpanRow[], timeline: Timeline): InfoRow[] {
  return [...rowsByKind(span, spans), ...timing(span, timeline)];
}
