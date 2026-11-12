/**
 * The Traces view's copy (IKN-87), in one place — the same split every other view uses.
 *
 * "Run" is the word on screen for one trace: what a reader of an AI pipeline calls one execution of
 * it. "Span" stays the OpenTelemetry word, because the attributes underneath are named in it.
 */
export const TRACES_TEXT = {
  title: "traces",
  rangeLabel: (range: string) => `last ${range}`,

  /* ── Whole-view states ────────────────────────────────────────────────────────────────────── */
  pickService: "Pick a service in the rail to see the AI pipeline runs it reported.",
  /* Stem only; `<Pending>` draws the dots — see `SERVICE_TEXT.loading` (IKN-57). */
  loading: "reading",
  failed: "Could not read this service's runs.",
  detailFailed: "Could not read this run's spans.",
  retry: "retry",
  noRuns: "No run reported in this range. Traces arrive over OTLP from apps holding a write token.",
  truncated: "More runs matched than are listed; narrow the range to see the oldest.",
  runCount: (n: number) => (n === 1 ? "1 run" : `${n} runs`),
  pickRun: "Pick a run above to see its spans.",

  /* ── The list ─────────────────────────────────────────────────────────────────────────────── */
  colStarted: "started",
  colRun: "run",
  colDuration: "duration",
  colSpans: "spans",
  colTokens: "tokens",
  colModels: "models",
  colStatus: "status",
  openHint: (name: string) => `Open the spans of ${name}`,
  unnamed: "(unnamed)",
  none: "–",
  status: { unset: "unset", ok: "ok", error: "error" },

  /* ── The waterfall ────────────────────────────────────────────────────────────────────────── */
  waterfallLabel: "Spans of this run, nested by parent, on the run's own timeline",
  spanCount: (n: number) => (n === 1 ? "1 span" : `${n} spans`),
  spansTruncated: "This run has more spans than one read returns; the latest are missing.",
  orphanHint: "Its parent span never arrived, so it is drawn at the top level.",
  spanHint: (name: string, duration: string) => `${name} · ${duration}`,

  /* ── The span inspector ───────────────────────────────────────────────────────────────────── */
  inspectorTitle: "span",
  noSpan: "Pick a span to see its attributes.",
  fieldSpanId: "span id",
  fieldParent: "parent",
  fieldStart: "starts at",
  fieldDuration: "duration",
  fieldStatus: "status",
  fieldOperation: "operation",
  fieldModel: "model",
  fieldTokens: "tokens in / out",
  attributes: "attributes",
  noAttributes: "No attributes.",
  root: "root",
  offset: (duration: string) => `+${duration}`,
} as const;
