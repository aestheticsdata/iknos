import type { Meta } from "./meta";

/**
 * The AI traces screens (IKN-91 … IKN-94): what a run of an Officina pipeline says once its spans are
 * read for meaning — the checks it passed, what the human decided, which prompt and model ran.
 *
 * Read from the attributes Officina's `buildTrace` writes (`officina.*` and the GenAI conventions);
 * nothing is stored beyond the spans. Times are Unix microseconds, as in `traces.ts`.
 */

/** The run's automated checks: every gate's last verdict passed, one failed, the run is still going, or it has none. */
export const CHECKS = {
  passed: "passed",
  failed: "failed",
  pending: "pending",
  none: "none",
} as const;

export type Checks = (typeof CHECKS)[keyof typeof CHECKS];

/** Officina's `HUMAN_DECISION`, plus `none` when nobody reviewed the run. */
export const REVIEW = {
  approve: "approve",
  edit: "edit",
  reject: "reject",
  none: "none",
} as const;

export type Review = (typeof REVIEW)[keyof typeof REVIEW];

/** Whether the prompts and responses were captured (`gen_ai.input.messages`), or only the metadata. */
export const TELEMETRY = {
  full: "full",
  metadata: "metadata",
} as const;

export type Telemetry = (typeof TELEMETRY)[keyof typeof TELEMETRY];

export const RUN_STATE = {
  running: "running",
  completed: "completed",
} as const;

export type RunState = (typeof RUN_STATE)[keyof typeof RUN_STATE];

/** One run, one row of the run list. */
export type AiRunSummary = {
  traceId: string;
  service: string;
  /** The root span's name: the pipeline's. */
  pipeline: string;
  pipelineVersion: number | null;
  startUs: number;
  durationUs: number;
  spanCount: number;
  /** Steps — nodes that are not automated gates — that started. */
  steps: number;
  state: RunState;
  checks: Checks;
  /** Gates whose last verdict failed. */
  failedGates: number;
  review: Review;
  telemetry: Telemetry;
  /** When the run's captured content goes (Unix µs) — `null` at the metadata level. */
  contentUntilUs: number | null;
  inputTokens: number;
  outputTokens: number;
  /** `<node>@v<officina.prompt.version>`, in the order the nodes ran. */
  prompts: string[];
  /** The model that generated the most tokens, or `null` when no model was called. */
  model: string | null;
};

/** A rate as counts, so the front can both print it and test a difference between two of them. */
export type Rate = {
  hits: number;
  total: number;
};

/** The run list's headline numbers, over every run the filters keep. */
export type AiRunKpis = {
  runs: number;
  checksPassed: Rate;
  approved: Rate;
  rejected: Rate;
  /** Completed runs only; `null` with none. */
  durationP95Us: number | null;
  tokens: number;
};

/** What the filter selects can offer: the values seen in the window. */
export type AiRunFacets = {
  services: string[];
  prompts: string[];
  models: string[];
};

/** `GET /api/traces` — newest first, one page. */
export type AiRunList = {
  runs: AiRunSummary[];
  /** Runs the filters kept, before paging. */
  total: number;
  kpis: AiRunKpis;
  facets: AiRunFacets;
  meta: Meta;
};

/* ── Quality (IKN-93) ─────────────────────────────────────────────────────────────────────────── */

/** One KPI now and over the window of the same length just before; `previous` is `null` past the data. */
export type QualityKpis = {
  checksPassed: Rate;
  approved: Rate;
  runs: number;
  fullTelemetryRuns: number;
  durationP95Us: number | null;
  previous: QualityBaseline | null;
};

/** The same KPIs over the window just before. */
export type QualityBaseline = {
  checksPassed: Rate;
  approved: Rate;
  runs: number;
  durationP95Us: number | null;
};

/** One UTC day of the rate chart. */
export type QualityDay = {
  dayStartUs: number;
  runs: number;
  checksPassed: Rate;
  approved: Rate;
};

export const MARKER = {
  prompt: "prompt",
  model: "model",
  pipeline: "pipeline",
} as const;

export type MarkerKind = (typeof MARKER)[keyof typeof MARKER];

/** The first run of a version the series had not seen before: a new prompt, model or pipeline version. */
export type QualityMarker = {
  atUs: number;
  kind: MarkerKind;
  /** The step it applies to, `null` for the pipeline. */
  step: string | null;
  label: string;
};

/** One gate's failures: the step it loops back to, the gate, how many failed verdicts now and before. */
export type FailurePattern = {
  step: string | null;
  gate: string;
  gateLabel: string;
  failures: number;
  previous: number | null;
  /** Its Spira ticket (IKN-96), or `null` when none was filed. */
  ticket: FailureTicket | null;
};

/** A failure pattern's Spira ticket: its identifier, its state as Spira says it now, and its page. */
export type FailureTicket = {
  issue: string;
  /** `null` when Spira could not be asked (not configured, down, or the issue is gone). */
  state: string | null;
  url: string;
};

/** Why "create the ticket" is not offered — or `null` when it is. */
export const TICKETING_BLOCK = {
  notConfigured: "notConfigured",
  noProject: "noProject",
} as const;

export type TicketingBlock = (typeof TICKETING_BLOCK)[keyof typeof TICKETING_BLOCK];

/** Whether this service's failure patterns can be filed, and where. */
export type Ticketing = {
  project: string | null;
  blocked: TicketingBlock | null;
};

/** `POST /api/traces/quality/tickets` — the pattern to file, as the quality screen shows it. */
export type CreateTicketRequest = {
  service: string;
  gate: string;
  gateLabel: string;
  step: string | null;
  failures: number;
  previous: number | null;
  /** The window the counts are over, ISO-8601. */
  from: string;
  to: string;
};

/** `GET /api/traces/quality` */
export type QualityReport = {
  service: string;
  pipeline: string | null;
  steps: number;
  gates: number;
  kpis: QualityKpis;
  days: QualityDay[];
  markers: QualityMarker[];
  failures: FailurePattern[];
  ticketing: Ticketing;
  meta: Meta;
};

/* ── Versions (IKN-94) ────────────────────────────────────────────────────────────────────────── */

/** A continuous measure: its value and how many observations it rests on. */
export type Measure = {
  value: number | null;
  n: number;
};

/** One (prompt version, model) pair seen on the step. */
export type VersionColumn = {
  /** `spec@v14`, or `pipeline v8` for the whole pipeline. */
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

/** A step the selector offers: its node id and label. */
export type VersionStep = {
  id: string;
  label: string;
};

/** `GET /api/traces/versions` */
export type VersionReport = {
  service: string;
  /** The step compared, or `null` for the whole pipeline. */
  step: string | null;
  steps: VersionStep[];
  columns: VersionColumn[];
  meta: Meta;
};
