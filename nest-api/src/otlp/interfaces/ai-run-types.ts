import type { AiRunSummary, Checks, QualityReport, Review, VersionReport } from "@contracts/ai-runs";

/**
 * What the AI-run reads work on (IKN-91 … IKN-94): one span reduced to the columns and the handful
 * of `officina.*` attributes the summaries need. The raw query extracts them in SQL, so a run's
 * captured prompts — the big part of `attrs` — never leave the database for a list.
 */
export type SpanFact = {
  traceId: string;
  service: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startUs: number;
  durationUs: number;
  statusCode: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** `gen_ai.agent.name` — on the root, the pipeline's name without the operation in front. */
  agentName: string | null;
  nodeId: string | null;
  nodeKind: string | null;
  /** `officina.attempt` — set on attempt spans, which a verdict span is not. */
  attempt: number | null;
  promptVersion: number | null;
  pipelineVersion: number | null;
  gatePass: boolean | null;
  decision: string | null;
  runStatus: string | null;
  firstTokenMs: number | null;
  tokensPerSecond: number | null;
  loopTarget: string | null;
  /** The span's content was captured — the `full` level — whether or not it is still kept. */
  hasContent: boolean;
  /** When that content goes, Unix µs. */
  contentUntilUs: number | null;
};

/** One gate node of a run: its last verdict and how many verdicts failed on the way. */
export type GateReading = {
  nodeId: string;
  label: string;
  passed: boolean;
  failures: number;
  /** The step a failed verdict looped back to, when one said so. */
  loopTarget: string | null;
};

/** One step node of a run, with what its model calls measured. */
export type StepReading = {
  nodeId: string;
  label: string;
  durationUs: number;
  promptVersion: number | null;
  model: string | null;
  tokens: number;
  firstTokenMs: number[];
  tokensPerSecond: number[];
};

/** A run read for meaning: the row the list shows, and the parts quality and versions aggregate. */
export type RunReading = {
  summary: AiRunSummary;
  gates: GateReading[];
  steps: StepReading[];
};

/** The run list's filters, parsed. `null` means "any". */
export type RunFilters = {
  checks: Checks | null;
  review: Review | null;
  prompt: string | null;
  model: string | null;
};

/** The window every AI-run read starts from: a service (or all of them) and `[from, to)`. */
export type RunWindow = {
  service: string | null;
  from: Date;
  to: Date;
};

/** A page of the run list. */
export type RunPage = {
  offset: number;
  limit: number;
};

/** The quality report's frame, in Unix microseconds: the window, and the start of the daily series. */
export type QualityFrame = {
  fromUs: number;
  toUs: number;
  seriesDays: number;
};

/** The quality report before the controller adds the service and the timing. */
export type QualityBody = Omit<QualityReport, "service" | "meta" | "ticketing">;

/** The version report before the controller adds the service, the step and the timing. */
export type VersionBody = Pick<VersionReport, "steps" | "columns">;

/** One row of the facts query: JSON values arrive unquoted, as text. */
export type RawFact = {
  traceId: string;
  service: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startUs: unknown;
  durationUs: unknown;
  statusCode: unknown;
  model: string | null;
  inputTokens: unknown;
  outputTokens: unknown;
  agentName: string | null;
  nodeId: string | null;
  nodeKind: string | null;
  attempt: unknown;
  promptVersion: unknown;
  pipelineVersion: unknown;
  gatePass: unknown;
  decision: string | null;
  runStatus: string | null;
  firstTokenMs: unknown;
  tokensPerSecond: unknown;
  loopTarget: string | null;
  hasContent: unknown;
  contentUntilUs: unknown;
};

/** The raw strings the run list accepts. */
export type RunFilterQuery = {
  checks?: string;
  review?: string;
  prompt?: string;
  model?: string;
};

/** One evaluation or feedback event of a run, reduced to what the summaries read. */
export type EventFact = {
  traceId: string;
  spanId: string;
  timeUs: number;
  name: string;
  /** `gen_ai.evaluation.name`: the gate it judges. */
  evaluation: string | null;
  /** `gen_ai.evaluation.score.label`: `pass` or `fail`. */
  label: string | null;
  /** `officina.gate.rule_index`: set on the per-rule events, absent on the gate's overall one. */
  ruleIndex: number | null;
  /** `officina.human.decision`, on feedback events. */
  decision: string | null;
};

/** The events query's row, as the driver returns it. */
export type RawEventFact = {
  traceId: string;
  spanId: string;
  timeUs: unknown;
  name: string;
  evaluation: string | null;
  label: string | null;
  ruleIndex: unknown;
  decision: string | null;
};
