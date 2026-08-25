import { describe, expect, it } from "vitest";
import { formatDuration, formatValue, needsAttention, openFor } from "./alertFormat";

import type { AlertRow } from "./alertTypes";

const T0 = Date.UTC(2026, 7, 25, 12, 0, 0);

const alert = (over: Partial<AlertRow> = {}): AlertRow => ({
  id: 1,
  ruleKey: "error_rate",
  service: "pfa-nest-api",
  severity: "warning",
  title: "t",
  expr: "e",
  threshold: 5,
  unit: "percent",
  value: 6.2,
  state: "firing",
  openedAt: new Date(T0 - 600_000).toISOString(),
  firedAt: new Date(T0 - 300_000).toISOString(),
  resolvedAt: null,
  ackedAt: null,
  silencedUntil: null,
  occurrences: 5,
  lastSeenAt: new Date(T0).toISOString(),
  ...over,
});

describe("formatDuration", () => {
  it("is a clock, and keeps its hours at zero", () => {
    // A field that switched between `04:12` and `01:04:12` would change width under the reader.
    expect(formatDuration(252_000)).toBe("00:04:12");
    expect(formatDuration(3_852_000)).toBe("01:04:12");
  });

  it("switches to days once the seconds have stopped mattering", () => {
    expect(formatDuration(96_400_000)).toBe("1d 02h");
  });

  it("dashes anything that is not a duration", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("openFor", () => {
  it("counts from firedAt once it has fired", () => {
    expect(openFor(alert(), T0)).toBe(300_000);
  });

  it("counts from openedAt while pending — a different question", () => {
    expect(openFor(alert({ state: "pending", firedAt: null }), T0)).toBe(600_000);
  });
});

describe("formatValue", () => {
  it("carries its unit", () => {
    expect(formatValue(3.1, "percent")).toBe("3.1%");
    expect(formatValue(1204, "ms")).toBe("1204ms");
    expect(formatValue(2, "count")).toBe("2");
  });

  it("dashes a null rather than drawing a zero", () => {
    // The one lie this function exists to prevent: a reading nobody took, rendered as measured.
    expect(formatValue(null, "percent")).toBe("—");
  });

  it("keeps a measured zero, which is a fact", () => {
    expect(formatValue(0, "percent")).toBe("0%");
  });
});

describe("needsAttention", () => {
  it("is true for a plain firing alert", () => {
    expect(needsAttention(alert(), T0)).toBe(true);
  });

  it("is false while pending — the for-window exists so it does not interrupt", () => {
    expect(needsAttention(alert({ state: "pending" }), T0)).toBe(false);
  });

  it("is false once acknowledged or resolved", () => {
    expect(needsAttention(alert({ ackedAt: new Date(T0).toISOString() }), T0)).toBe(false);
    expect(needsAttention(alert({ resolvedAt: new Date(T0).toISOString() }), T0)).toBe(false);
  });

  it("is false while silenced and true again once the silence lapses", () => {
    expect(needsAttention(alert({ silencedUntil: new Date(T0 + 3_600_000).toISOString() }), T0)).toBe(false);
    expect(needsAttention(alert({ silencedUntil: new Date(T0 - 1).toISOString() }), T0)).toBe(true);
  });
});
