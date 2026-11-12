import { CHECKS, REVIEW, RUN_STATE } from "@contracts/ai-runs";

import type { AiRunSummary, Rate } from "@contracts/ai-runs";

/** The small statistics every AI-run aggregate shares (IKN-91 … IKN-94). Pure. */

/** Nearest-rank percentile, `q` in (0, 1]; `null` on no values. */
export function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1];
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

/** Runs whose checks concluded, and how many of them passed. Running and gate-less runs are not counted. */
export function checksRate(runs: AiRunSummary[]): Rate {
  const decided = runs.filter((run) => run.checks === CHECKS.passed || run.checks === CHECKS.failed);
  return { hits: decided.filter((run) => run.checks === CHECKS.passed).length, total: decided.length };
}

/** Runs a human reviewed, and how many of them got `decision`. */
export function reviewRate(runs: AiRunSummary[], decision: string): Rate {
  const reviewed = runs.filter((run) => run.review !== REVIEW.none);
  return { hits: reviewed.filter((run) => run.review === decision).length, total: reviewed.length };
}

/** p95 of completed runs' durations. */
export function durationP95(runs: AiRunSummary[]): number | null {
  return percentile(
    runs.filter((run) => run.state === RUN_STATE.completed).map((run) => run.durationUs),
    0.95,
  );
}
