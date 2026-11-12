import { REVIEW } from "@contracts/ai-runs";
import { checksRate, durationP95, reviewRate } from "./run-stats";

import type { AiRunFacets, AiRunKpis, AiRunSummary } from "@contracts/ai-runs";
import type { RunFilters, RunReading } from "../interfaces/ai-run-types";

/** The run list (IKN-91): filters, headline numbers, and what the filter selects offer. Pure. */

export function matchesFilters(run: AiRunSummary, filters: RunFilters): boolean {
  if (filters.checks !== null && run.checks !== filters.checks) return false;
  if (filters.review !== null && run.review !== filters.review) return false;
  if (filters.prompt !== null && !run.prompts.includes(filters.prompt)) return false;
  if (filters.model !== null && run.model !== filters.model) return false;
  return true;
}

export function runKpis(runs: AiRunSummary[]): AiRunKpis {
  return {
    runs: runs.length,
    checksPassed: checksRate(runs),
    approved: reviewRate(runs, REVIEW.approve),
    rejected: reviewRate(runs, REVIEW.reject),
    durationP95Us: durationP95(runs),
    tokens: runs.reduce((a, run) => a + run.inputTokens + run.outputTokens, 0),
  };
}

const sortedDistinct = (values: Array<string | null>): string[] =>
  [...new Set(values.filter((v): v is string => v !== null))].sort((a, b) => a.localeCompare(b));

/** Facets come from every run in the window, not the filtered ones: a filter must be undoable from its own select. */
export function runFacets(readings: RunReading[]): AiRunFacets {
  const runs = readings.map((reading) => reading.summary);
  return {
    services: sortedDistinct(runs.map((run) => run.service)),
    prompts: sortedDistinct(runs.flatMap((run) => run.prompts)),
    models: sortedDistinct(runs.map((run) => run.model)),
  };
}
