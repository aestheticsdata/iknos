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
  colReview: "review",
  reviewCell: (failed: number, feedback: number) =>
    [failed > 0 ? `${failed} failed` : null, feedback > 0 ? `${feedback} human` : null].filter(Boolean).join(" · "),
  reviewHint: "Failed gate evaluations, and human decisions, on this run's spans",
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
  /* Glyph + count on the row; the words are the title, so the mark is never colour alone. */
  markFailed: "✕",
  markPassed: "✓",
  markFeedback: "◆",
  markFailedHint: (n: number) => (n === 1 ? "1 gate evaluation failed" : `${n} gate evaluations failed`),
  markPassedHint: (n: number) => (n === 1 ? "1 gate evaluation passed" : `${n} gate evaluations passed`),
  markFeedbackHint: (n: number) => (n === 1 ? "1 human decision" : `${n} human decisions`),

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

  /* ── Evaluations, human feedback, content (IKN-87 v2) ─────────────────────────────────────── */
  evaluations: "evaluations",
  verdict: { pass: "pass", fail: "fail", other: "other" },
  ruleIndex: (n: number) => `rule ${n}`,
  score: (n: number) => `score ${n}`,
  feedback: "human feedback",
  atNode: (node: string) => `at ${node}`,
  noteLabel: "note",
  editLabel: "edit",
  content: "content",
  contentExpired: (days: number | null) =>
    days === null ? "Content expired." : `Content expired after ${days === 1 ? "1 day" : `${days} days`}.`,
  contentNone: "Metadata only — this span's prompts and answers were not captured.",
  contentEmpty: "No content on this span itself; its events may carry some.",
} as const;
