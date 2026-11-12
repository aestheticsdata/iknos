import { CHECKS, MARKER, REVIEW, RUN_STATE, TELEMETRY } from "@contracts/ai-runs";
import { describe, expect, it } from "vitest";
import { DAY_US, qualityReport } from "./run-quality";
import { versionReport } from "./run-versions";

import type { Checks, Review } from "@contracts/ai-runs";
import type { GateReading, RunReading } from "../interfaces/ai-run-types";

const TO = 20 * DAY_US;

type Shape = {
  day: number;
  checks: Checks;
  review: Review;
  prompt: number;
};

/** A reading built directly — the reader has its own spec; this one is about aggregation. */
function reading(shape: Shape): RunReading {
  const gate: GateReading = {
    nodeId: "spec-testable",
    label: "Testable criteria",
    passed: shape.checks === CHECKS.passed,
    failures: shape.checks === CHECKS.passed ? 0 : 1,
    loopTarget: shape.checks === CHECKS.passed ? null : "spec",
  };
  return {
    summary: {
      traceId: `${shape.day}`,
      service: "fathom-front",
      pipeline: "spec-to-code",
      pipelineVersion: 8,
      startUs: TO - shape.day * DAY_US + 1000,
      durationUs: 40_000_000,
      spanCount: 10,
      steps: 2,
      state: RUN_STATE.completed,
      checks: shape.checks,
      failedGates: gate.passed ? 0 : 1,
      review: shape.review,
      telemetry: TELEMETRY.metadata,
      contentUntilUs: null,
      inputTokens: 100,
      outputTokens: 50,
      prompts: [`spec@v${shape.prompt}`],
      model: "m",
    },
    gates: [gate],
    steps: [
      {
        nodeId: "spec",
        label: "Spec",
        durationUs: 10_000_000,
        promptVersion: shape.prompt,
        model: "m",
        tokens: 150,
        firstTokenMs: [1000],
        tokensPerSecond: [200],
      },
    ],
  };
}

const ok = (day: number, prompt = 13): RunReading =>
  reading({ day, checks: CHECKS.passed, review: REVIEW.approve, prompt });
const bad = (day: number, prompt = 14): RunReading =>
  reading({ day, checks: CHECKS.failed, review: REVIEW.reject, prompt });

const frame = { fromUs: TO - 7 * DAY_US, toUs: TO, seriesDays: 14 };

describe("qualityReport", () => {
  const readings = [ok(13), ok(12), ok(10), ok(9), bad(5), ok(4, 14), bad(2)];

  it("compares the window with the one just before it", () => {
    const { kpis } = qualityReport(readings, frame);

    expect(kpis.runs).toBe(3);
    expect(kpis.checksPassed).toEqual({ hits: 1, total: 3 });
    expect(kpis.approved).toEqual({ hits: 1, total: 3 });
    expect(kpis.previous?.runs).toBe(4);
    expect(kpis.previous?.checksPassed).toEqual({ hits: 4, total: 4 });
  });

  it("has no baseline when the window before holds no run", () => {
    expect(qualityReport([bad(2)], frame).kpis.previous).toBeNull();
  });

  it("draws one point per UTC day of the series, empty days included", () => {
    const { days } = qualityReport(readings, frame);

    expect(days).toHaveLength(14);
    expect(days.reduce((a, day) => a + day.runs, 0)).toBe(7);
    expect(days.filter((day) => day.runs === 0).length).toBe(7);
  });

  it("marks a version's first run, but not the versions already there on the first day", () => {
    const { markers } = qualityReport(readings, frame);

    expect(markers).toEqual([expect.objectContaining({ kind: MARKER.prompt, step: "spec", label: "spec v14" })]);
    expect(markers[0].atUs).toBe(TO - 5 * DAY_US + 1000);
  });

  it("tallies failed verdicts per gate against the previous window, with the step they loop to", () => {
    expect(qualityReport(readings, frame).failures).toEqual([
      { step: "spec", gate: "spec-testable", gateLabel: "Testable criteria", failures: 2, previous: 0, ticket: null },
    ]);
  });
});

describe("versionReport", () => {
  const readings = [ok(13), ok(12), bad(5), ok(4, 14)];

  it("makes one column per prompt version and model of the step, oldest first", () => {
    const { columns, steps } = versionReport(readings, "spec");

    expect(steps).toEqual([{ id: "spec", label: "Spec" }]);
    expect(columns.map((column) => column.version)).toEqual(["spec@v13", "spec@v14"]);
    expect(columns[1]).toMatchObject({ runs: 2, checksPassed: { hits: 1, total: 2 }, rejected: { hits: 1, total: 2 } });
    expect(columns[1].tokensPerRun).toEqual({ value: 150, n: 2 });
  });

  it("compares pipeline versions when no step is named", () => {
    expect(versionReport(readings, null).columns.map((column) => column.version)).toEqual(["pipeline v8"]);
  });
});
