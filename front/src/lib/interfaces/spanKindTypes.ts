import type { SpanRow } from "@lib/interfaces/traceSpanTypes";

/** What an Officina span stands for (IKN-92) — see `lib/spanKind.ts`, which reads it. */
export const SPAN_KIND = {
  run: "run",
  step: "step",
  gate: "gate",
  attempt: "attempt",
  model: "model",
  tool: "tool",
  verdict: "verdict",
  human: "human",
  other: "other",
} as const;

export type SpanKind = (typeof SPAN_KIND)[keyof typeof SPAN_KIND];

/** One verdict of a gate: which attempt, whether it passed, its score and how many reasons it gave. */
export type GateVerdict = {
  spanId: string;
  attempt: number | null;
  passed: boolean;
  score: number | null;
  /** Officina sends a count; a sender that sends the reasons themselves gets them listed. */
  reasons: number | string[] | null;
};

/** One gate node of a run, with its verdicts in order. */
export type GateView = {
  node: SpanRow;
  passed: boolean;
  verdicts: GateVerdict[];
  loopTarget: string | null;
};

export const RUN_EVENT = {
  start: "start",
  checkFailed: "checkFailed",
  retry: "retry",
  decision: "decision",
  end: "end",
  running: "running",
} as const;

export type RunEventKind = (typeof RUN_EVENT)[keyof typeof RUN_EVENT];

/** A moment of the run worth a line in the events tab, derived from the spans — nothing is stored. */
export type RunEvent = {
  atUs: number;
  kind: RunEventKind;
  spanId: string;
  /** The node it concerns (a gate, a step) or the pipeline for start and end. */
  subject: string;
  /** The attempt number, for a failed check or a retry. */
  attempt: number | null;
  /** The human decision, for a decision. */
  decision: string | null;
};

/** One message of a captured conversation (`gen_ai.input.messages` / `gen_ai.output.messages`). */
export type GenAiMessage = {
  /** Its place in the conversation — the list never reorders, so this is its identity. */
  position: number;
  role: string;
  text: string;
};

/** A row of the inspector's info tab: which field, and its value already formatted. */
export type InfoRow = {
  field: string;
  value: string;
};

export const INSPECTOR_TAB = {
  info: "info",
  checks: "checks",
  content: "content",
  events: "events",
  attributes: "attributes",
} as const;

export type InspectorTab = (typeof INSPECTOR_TAB)[keyof typeof INSPECTOR_TAB];
