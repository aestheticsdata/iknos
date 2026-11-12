import type { Point } from "@lib/charts/interfaces/chartTypes";
import type { Meta } from "@lib/logTypes";
import type { RangeKey } from "@lib/timeRange";

/**
 * The AI traces screens' contracts (IKN-91 … IKN-94) — the front's copy of
 * `nest-api/src/contracts/ai-runs.ts`, which is the authoritative one. Times are Unix microseconds.
 */

export const CHECKS = { passed: "passed", failed: "failed", pending: "pending", none: "none" } as const;
export type Checks = (typeof CHECKS)[keyof typeof CHECKS];

export const REVIEW = { approve: "approve", edit: "edit", reject: "reject", none: "none" } as const;
export type Review = (typeof REVIEW)[keyof typeof REVIEW];

export const TELEMETRY = { full: "full", metadata: "metadata" } as const;
export type Telemetry = (typeof TELEMETRY)[keyof typeof TELEMETRY];

export const RUN_STATE = { running: "running", completed: "completed" } as const;
export type RunState = (typeof RUN_STATE)[keyof typeof RUN_STATE];

export const MARKER = { prompt: "prompt", model: "model", pipeline: "pipeline" } as const;
export type MarkerKind = (typeof MARKER)[keyof typeof MARKER];

export type AiRunSummary = {
  traceId: string;
  service: string;
  pipeline: string;
  pipelineVersion: number | null;
  startUs: number;
  durationUs: number;
  spanCount: number;
  steps: number;
  state: RunState;
  checks: Checks;
  failedGates: number;
  review: Review;
  telemetry: Telemetry;
  contentUntilUs: number | null;
  inputTokens: number;
  outputTokens: number;
  prompts: string[];
  model: string | null;
};

export type Rate = {
  hits: number;
  total: number;
};

export type AiRunKpis = {
  runs: number;
  checksPassed: Rate;
  approved: Rate;
  rejected: Rate;
  durationP95Us: number | null;
  tokens: number;
};

export type AiRunFacets = {
  services: string[];
  prompts: string[];
  models: string[];
};

export type AiRunList = {
  runs: AiRunSummary[];
  total: number;
  kpis: AiRunKpis;
  facets: AiRunFacets;
  meta: Meta;
};

export type QualityBaseline = {
  checksPassed: Rate;
  approved: Rate;
  runs: number;
  durationP95Us: number | null;
};

export type QualityKpis = QualityBaseline & {
  fullTelemetryRuns: number;
  previous: QualityBaseline | null;
};

export type QualityDay = {
  dayStartUs: number;
  runs: number;
  checksPassed: Rate;
  approved: Rate;
};

export type QualityMarker = {
  atUs: number;
  kind: MarkerKind;
  step: string | null;
  label: string;
};

export type FailurePattern = {
  step: string | null;
  gate: string;
  gateLabel: string;
  failures: number;
  previous: number | null;
};

export type QualityReport = {
  service: string;
  pipeline: string | null;
  steps: number;
  gates: number;
  kpis: QualityKpis;
  days: QualityDay[];
  markers: QualityMarker[];
  failures: FailurePattern[];
  meta: Meta;
};

export type Measure = {
  value: number | null;
  n: number;
};

export type VersionColumn = {
  version: string;
  model: string;
  firstUs: number;
  lastUs: number;
  runs: number;
  checksPassed: Rate;
  approved: Rate;
  rejected: Rate;
  latencyP50Us: Measure;
  latencyP95Us: Measure;
  firstTokenMs: Measure;
  tokensPerSecond: Measure;
  tokensPerRun: Measure;
};

export type VersionStep = {
  id: string;
  label: string;
};

export type VersionReport = {
  service: string;
  step: string | null;
  steps: VersionStep[];
  columns: VersionColumn[];
  meta: Meta;
};

/** The run list's filters as the URL holds them; `null` is "any". */
export type RunFilterState = {
  checks: Checks | null;
  review: Review | null;
  prompt: string | null;
  model: string | null;
};

/** Which way is better for a measure: up (approval, throughput), down (latency, rejection), or neither (a count). */
export const BETTER = { up: 1, down: -1, none: 0 } as const;
export type Better = (typeof BETTER)[keyof typeof BETTER];

/** One cell compared with the reference column's. */
export type Delta = {
  /** In percentage points for a rate, in the measure's unit otherwise. */
  delta: number;
  /** Relative to the reference, for a measure; the 95 % half-interval in points, for a rate. */
  spread: number;
  significant: boolean;
  /** `null` when the measure has no better direction or the difference is nil. */
  better: boolean | null;
};

/** A measure, the runs it was taken over, and which way is better. */
export type MeasureSide = {
  measure: Measure;
  runs: number;
};

/** What the run list asks: a service or every one, a range, filters and a page. */
export type RunListQuery = {
  service: string | null;
  range: RangeKey;
  filters: RunFilterState;
  page: number;
};

/** One service's step — `null` for the whole pipeline — across versions. */
export type VersionQuery = {
  service: string | null;
  step: string | null;
  range: RangeKey;
};

/** The quality chart's drawing, in a 1000 × 200 view box: one segment per run of days with data. */
export type RateChart = {
  /** The bottom of the y axis, in percent; the top is 100. */
  floor: number;
  /** Gridline values, top to bottom. */
  ticks: number[];
  checks: Point[][];
  approved: Point[][];
  markers: PlacedMarker[];
  days: DayLabel[];
};

/** A version change, placed: `pct` of the chart's width. */
export type PlacedMarker = QualityMarker & {
  pct: number;
};

/** A day label: where it sits, in percent of the width, and the day's start. */
export type DayLabel = {
  pct: number;
  dayStartUs: number;
};

export const VERSION_ROW = {
  runs: "runs",
  checks: "checks",
  approved: "approved",
  rejected: "rejected",
  p50: "p50",
  p95: "p95",
  ttft: "ttft",
  tps: "tps",
  tokens: "tokens",
} as const;

export type VersionRowKey = (typeof VERSION_ROW)[keyof typeof VERSION_ROW];

/** One cell of the grid, ready to print: the value, and its delta against the reference if any. */
export type VersionCell = {
  value: string;
  delta: string | null;
  verdict: Delta | null;
};
