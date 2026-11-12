import { MARKER, REVIEW, TELEMETRY } from "@contracts/ai-runs";
import { checksRate, durationP95, reviewRate } from "./run-stats";

import type { AiRunSummary, FailurePattern, QualityDay, QualityKpis, QualityMarker } from "@contracts/ai-runs";
import type { QualityBody, QualityFrame, RunReading } from "../interfaces/ai-run-types";

/**
 * The quality report (IKN-93), pure: one service's runs in, KPIs against the previous window, a daily
 * series, the version changes that happened in it, and the gates that fail.
 */

export const DAY_US = 86_400_000_000;

const within = (reading: RunReading, fromUs: number, toUs: number): boolean =>
  reading.summary.startUs >= fromUs && reading.summary.startUs < toUs;

function kpisOf(current: RunReading[], previous: RunReading[]): QualityKpis {
  const now = current.map((reading) => reading.summary);
  const before = previous.map((reading) => reading.summary);
  return {
    checksPassed: checksRate(now),
    approved: reviewRate(now, REVIEW.approve),
    runs: now.length,
    fullTelemetryRuns: now.filter((run) => run.telemetry === TELEMETRY.full).length,
    durationP95Us: durationP95(now),
    previous:
      before.length === 0
        ? null
        : {
            checksPassed: checksRate(before),
            approved: reviewRate(before, REVIEW.approve),
            runs: before.length,
            durationP95Us: durationP95(before),
          },
  };
}

function daysOf(readings: RunReading[], frame: QualityFrame): QualityDay[] {
  const lastDay = Math.floor((frame.toUs - 1) / DAY_US) * DAY_US;
  const days: QualityDay[] = [];
  for (let i = frame.seriesDays - 1; i >= 0; i--) {
    const dayStartUs = lastDay - i * DAY_US;
    const runs: AiRunSummary[] = readings
      .filter((reading) => within(reading, dayStartUs, dayStartUs + DAY_US))
      .map((reading) => reading.summary);
    days.push({
      dayStartUs,
      runs: runs.length,
      checksPassed: checksRate(runs),
      approved: reviewRate(runs, REVIEW.approve),
    });
  }
  return days;
}

type Seen = {
  key: string;
  marker: QualityMarker;
};

/** Every version a run shows: one entry per prompt, per step model, and the pipeline's. */
function versionsOf(reading: RunReading): Seen[] {
  const atUs = reading.summary.startUs;
  const seen: Seen[] = [];
  if (reading.summary.pipelineVersion !== null) {
    const version = reading.summary.pipelineVersion;
    seen.push({
      key: `pipeline:${version}`,
      marker: { atUs, kind: MARKER.pipeline, step: null, label: `pipeline v${version}` },
    });
  }
  for (const step of reading.steps) {
    if (step.promptVersion !== null) {
      seen.push({
        key: `prompt:${step.nodeId}:${step.promptVersion}`,
        marker: { atUs, kind: MARKER.prompt, step: step.nodeId, label: `${step.nodeId} v${step.promptVersion}` },
      });
    }
    if (step.model !== null) {
      seen.push({
        key: `model:${step.nodeId}:${step.model}`,
        marker: { atUs, kind: MARKER.model, step: step.nodeId, label: `${step.nodeId} · ${step.model}` },
      });
    }
  }
  return seen;
}

/**
 * A marker where a version first appears — but not the versions already running on the series' first
 * day: those were there before the chart began, and marking them would mark everything.
 */
function markersOf(readings: RunReading[], frame: QualityFrame): QualityMarker[] {
  const seriesStart = Math.floor((frame.toUs - 1) / DAY_US) * DAY_US - (frame.seriesDays - 1) * DAY_US;
  const oldestFirst = readings
    .filter((reading) => reading.summary.startUs >= seriesStart)
    .sort((a, b) => a.summary.startUs - b.summary.startUs);
  if (oldestFirst.length === 0) return [];

  const baselineEnd = oldestFirst[0].summary.startUs + DAY_US;
  const known = new Set<string>();
  const markers: QualityMarker[] = [];
  for (const reading of oldestFirst) {
    for (const { key, marker } of versionsOf(reading)) {
      if (known.has(key)) continue;
      known.add(key);
      if (reading.summary.startUs >= baselineEnd) markers.push(marker);
    }
  }
  return markers;
}

type GateTally = {
  gateLabel: string;
  failures: number;
  targets: Map<string, number>;
};

function tallyGates(readings: RunReading[]): Map<string, GateTally> {
  const tallies = new Map<string, GateTally>();
  for (const reading of readings) {
    for (const gate of reading.gates) {
      const tally = tallies.get(gate.nodeId) ?? { gateLabel: gate.label, failures: 0, targets: new Map() };
      tally.failures += gate.failures;
      if (gate.loopTarget !== null) tally.targets.set(gate.loopTarget, (tally.targets.get(gate.loopTarget) ?? 0) + 1);
      tallies.set(gate.nodeId, tally);
    }
  }
  return tallies;
}

function failuresOf(current: RunReading[], previous: RunReading[]): FailurePattern[] {
  const now = tallyGates(current);
  const before = tallyGates(previous);
  const patterns: FailurePattern[] = [];
  for (const [gate, tally] of now) {
    const prior = before.get(gate);
    if (tally.failures === 0 && (prior?.failures ?? 0) === 0) continue;
    const step = [...tally.targets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    patterns.push({
      step,
      gate,
      gateLabel: tally.gateLabel,
      failures: tally.failures,
      previous: previous.length === 0 ? null : (prior?.failures ?? 0),
      ticket: null,
    });
  }
  return patterns.sort((a, b) => b.failures - a.failures || a.gate.localeCompare(b.gate));
}

const mostCommon = (values: string[]): string | null => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** `readings` must cover the series and the window before `frame.fromUs`. */
export function qualityReport(readings: RunReading[], frame: QualityFrame): QualityBody {
  const span = frame.toUs - frame.fromUs;
  const current = readings.filter((reading) => within(reading, frame.fromUs, frame.toUs));
  const previous = readings.filter((reading) => within(reading, frame.fromUs - span, frame.fromUs));
  return {
    pipeline: mostCommon(current.map((reading) => reading.summary.pipeline)),
    steps: new Set(current.flatMap((reading) => reading.steps.map((step) => step.nodeId))).size,
    gates: new Set(current.flatMap((reading) => reading.gates.map((gate) => gate.nodeId))).size,
    kpis: kpisOf(current, previous),
    days: daysOf(readings, frame),
    markers: markersOf(readings, frame),
    failures: failuresOf(current, previous),
  };
}
