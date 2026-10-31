import { BUCKET } from "@lib/interfaces/trafficTypes";
import { describe, expect, it } from "vitest";
import { bucketLabel, dailyAverage, formatShare, pagesPerVisit, retentionCut } from "./trafficFormat";

import type { TrafficPoint, TrafficTotals } from "@lib/interfaces/trafficTypes";

const TOTALS: TrafficTotals = {
  visitorDays: 10,
  pageViews: 18,
  requests: 100,
  humanRequests: 60,
  botRequests: 30,
  scannerRequests: 10,
  bytes: 1_000_000,
  previews: 2,
};

const point = (t: string, partial = false): TrafficPoint => ({
  t,
  partial,
  available: true,
  visitorDays: 1,
  pageViews: 1,
  botRequests: 0,
  scannerRequests: 0,
});

describe("formatShare", () => {
  it("prints a whole percentage", () => {
    expect(formatShare(0.734)).toBe("73%");
    expect(formatShare(1)).toBe("100%");
  });

  it("prints the absent glyph for nothing", () => {
    expect(formatShare(null)).toBe("—");
  });
});

describe("pagesPerVisit", () => {
  it("divides page views by visitor-days, one decimal", () => {
    expect(pagesPerVisit(TOTALS)).toBe("1.8");
  });

  it("says nothing with no visitor", () => {
    expect(pagesPerVisit({ ...TOTALS, visitorDays: 0 })).toBe("—");
  });
});

describe("bucketLabel", () => {
  it("names a day in the reader's zone", () => {
    expect(bucketLabel(point("2026-10-30T23:00:00.000Z"), BUCKET.day, "Europe/Paris")).toBe("Sat 31 Oct");
  });

  it("names an hour", () => {
    expect(bucketLabel(point("2026-10-31T13:00:00.000Z"), BUCKET.hour, "Europe/Paris")).toBe("14:00");
  });

  it("says when a day is cut by the range", () => {
    expect(bucketLabel(point("2026-10-30T23:00:00.000Z", true), BUCKET.day, "Europe/Paris")).toBe(
      "Sat 31 Oct (partial)",
    );
  });
});

describe("dailyAverage", () => {
  it("divides by the range's days, not by its buckets", () => {
    expect(dailyAverage(TOTALS, "7d")).toBeCloseTo(10 / 7);
    expect(dailyAverage(TOTALS, "14d")).toBeCloseTo(10 / 14);
  });

  it("has no meaning for a range of a day or less", () => {
    expect(dailyAverage(TOTALS, "24h")).toBeNull();
  });
});

describe("retentionCut", () => {
  it("is true when the range reaches past what the logs keep", () => {
    expect(retentionCut("14d", 7)).toBe(true);
    expect(retentionCut("14d", 14)).toBe(false);
    expect(retentionCut("7d", 14)).toBe(false);
  });
});
