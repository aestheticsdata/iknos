import { REVIEW, RUN_STATE } from "@contracts/ai-runs";
import { checksRate, mean, percentile, reviewRate } from "./run-stats";

import type { Measure, VersionColumn, VersionStep } from "@contracts/ai-runs";
import type { RunReading, StepReading, VersionBody } from "../interfaces/ai-run-types";

/**
 * The version comparison (IKN-94), pure: one column per (prompt version, model) a step ran with —
 * or per (pipeline version, model) for the whole pipeline — and the measures the grid compares.
 * Significance is the front's (`lib/versionDelta.ts`): this hands over counts, not verdicts.
 */

type Sample = {
  reading: RunReading;
  version: string;
  model: string;
  latencyUs: number;
  tokens: number;
  firstTokenMs: number[];
  tokensPerSecond: number[];
};

const measure = (values: number[], value: number | null): Measure => ({ value, n: values.length });

function sampleOfStep(reading: RunReading, step: StepReading): Sample | null {
  if (step.promptVersion === null || step.model === null) return null;
  return {
    reading,
    version: `${step.nodeId}@v${step.promptVersion}`,
    model: step.model,
    latencyUs: step.durationUs,
    tokens: step.tokens,
    firstTokenMs: step.firstTokenMs,
    tokensPerSecond: step.tokensPerSecond,
  };
}

function sampleOfRun(reading: RunReading): Sample | null {
  const { summary } = reading;
  if (summary.pipelineVersion === null || summary.model === null) return null;
  return {
    reading,
    version: `pipeline v${summary.pipelineVersion}`,
    model: summary.model,
    latencyUs: summary.durationUs,
    tokens: summary.inputTokens + summary.outputTokens,
    firstTokenMs: reading.steps.flatMap((step) => step.firstTokenMs),
    tokensPerSecond: reading.steps.flatMap((step) => step.tokensPerSecond),
  };
}

function columnOf(samples: Sample[]): VersionColumn {
  const runs = samples.map((sample) => sample.reading.summary);
  const latencies = samples
    .filter((sample) => sample.reading.summary.state === RUN_STATE.completed)
    .map((sample) => sample.latencyUs);
  const ttft = samples.flatMap((sample) => sample.firstTokenMs);
  const tps = samples.flatMap((sample) => sample.tokensPerSecond);
  const tokens = samples.map((sample) => sample.tokens);
  const starts = runs.map((run) => run.startUs);
  return {
    version: samples[0].version,
    model: samples[0].model,
    firstUs: Math.min(...starts),
    lastUs: Math.max(...starts),
    runs: runs.length,
    checksPassed: checksRate(runs),
    approved: reviewRate(runs, REVIEW.approve),
    rejected: reviewRate(runs, REVIEW.reject),
    latencyP50Us: measure(latencies, percentile(latencies, 0.5)),
    latencyP95Us: measure(latencies, percentile(latencies, 0.95)),
    firstTokenMs: measure(ttft, mean(ttft)),
    tokensPerSecond: measure(tps, mean(tps)),
    tokensPerRun: measure(tokens, mean(tokens)),
  };
}

/** The steps the selector offers: every non-gate node that ran a prompt, in pipeline order. */
function stepsOf(readings: RunReading[]): VersionStep[] {
  const seen = new Map<string, VersionStep>();
  const order = new Map<string, number>();
  for (const reading of readings) {
    reading.steps.forEach((step, index) => {
      if (step.promptVersion === null) return;
      if (!seen.has(step.nodeId)) seen.set(step.nodeId, { id: step.nodeId, label: step.label });
      order.set(step.nodeId, Math.min(order.get(step.nodeId) ?? index, index));
    });
  }
  return [...seen.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** `step` is a node id, or `null` for the whole pipeline. Columns oldest first. */
export function versionReport(readings: RunReading[], step: string | null): VersionBody {
  const samples: Sample[] = [];
  for (const reading of readings) {
    if (step === null) {
      const sample = sampleOfRun(reading);
      if (sample) samples.push(sample);
      continue;
    }
    const node = reading.steps.find((candidate) => candidate.nodeId === step);
    const sample = node ? sampleOfStep(reading, node) : null;
    if (sample) samples.push(sample);
  }

  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = `${sample.version}\u001f${sample.model}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  const columns = [...groups.values()].map(columnOf).sort((a, b) => a.firstUs - b.firstUs);
  return { steps: stepsOf(readings), columns };
}
