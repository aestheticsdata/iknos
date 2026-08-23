/**
 * What the two service-view routes return, restated — the authoritative copies are
 * `nest-api/src/contracts/service-runtime.ts` and `service-signals.ts`, like every other contract
 * in this front end.
 *
 * The rule the whole view turns on is in the types: **every `null` here means "I do not know", and
 * none of them mean zero.** A service nobody scrapes, a minute the collector slept through and a
 * pool of no connections are three different facts, and the tiles say which one they are in words
 * rather than drawing a confident `0`.
 */

import type { Meta } from "@lib/logTypes";

/** Mirrors `contracts/service-runtime.ts`. The key is the service's own word for the dependency. */
export type ProbeCheck = {
  name: string;
  status: string;
  latencyMs: number | null;
};

/** Mirrors `contracts/service-runtime.ts`. `stale` is the rail's own threshold, shared. */
export type ProbeSummary = {
  status: "ok" | "error" | "stale";
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
  checks: ProbeCheck[];
};

/** Mirrors `contracts/service-runtime.ts`. Uptime is arithmetic at render time — see `formatUptime`. */
export type ProcessFacts = {
  pm2Id: number | null;
  status: string;
  restarts: number;
  nodeVersion: string | null;
  startedAt: string | null;
  observedAt: string;
};

/** Mirrors `contracts/service-runtime.ts`. The pool's size is `active + idle`; there is no ceiling. */
export type PoolGauge = {
  active: number;
  idle: number;
  waiting: number;
};

/** Mirrors `contracts/service-runtime.ts`. Every field is independently absent. */
export type NodeRuntime = {
  heapUsedBytes: number | null;
  heapTotalBytes: number | null;
  eventLoopLagMs: number | null;
  pool: PoolGauge | null;
  observedAt: string | null;
};

/** Mirrors `contracts/service-runtime.ts`. */
export type ServiceRuntime = {
  service: string;
  pm2Name: string;
  /** The registry carries a `metricsUrl`. False is permanent; an empty tile is not. */
  scraped: boolean;
  /** The registry carries a `healthUrl`. */
  probed: boolean;
  /** `null` until a deploy writes a release marker — the chip shows `—` and keeps its place. */
  release: string | null;
  process: ProcessFacts | null;
  probe: ProbeSummary | null;
  runtime: NodeRuntime | null;
  observedAt: string;
  meta: Meta;
};

/** Mirrors `contracts/service-signals.ts`. `v` is `null` for an interval that cannot be quoted. */
export type SignalPoint = {
  t: string;
  v: number | null;
};

/** Mirrors `contracts/service-signals.ts`. `value` is the whole range, never the mean of `points`. */
export type Signal = {
  value: number | null;
  points: SignalPoint[];
};

/** Mirrors `contracts/service-signals.ts`. */
export type MetricSource = "raw" | "rollup" | "mixed" | "none";

/** Mirrors `contracts/service-signals.ts`. */
export type ServiceSignals = {
  service: string;
  from: string;
  to: string;
  bucketMs: number;
  source: MetricSource;
  scraped: boolean;
  /** Requests per second. */
  throughput: Signal;
  /** Percent, 0–100 — 5xx over all responses. */
  errorRate: Signal;
  /** Milliseconds, interpolated from the histogram buckets server-side. */
  p95: Signal;
  meta: Meta;
};
