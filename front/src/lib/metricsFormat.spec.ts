import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  bucketShares,
  bucketTone,
  costlyRoute,
  formatShare,
  linksToLogs,
  p95Tone,
  statusParts,
} from "./metricsFormat";

import type { RouteRow } from "./metricsTypes";

const row = (over: Partial<RouteRow>): RouteRow => ({
  method: "GET",
  route: "/api/x",
  requests: 10,
  rate: 1,
  p50: 10,
  p95: 20,
  p99: 30,
  errorRate: 0,
  share: 0.5,
  ...over,
});

describe("p95Tone and costlyRoute", () => {
  it("colours a p95 past the threshold, and only then", () => {
    expect(p95Tone(1_200, 1_000)).toBe("error");
    expect(p95Tone(1_000, 1_000)).toBe("neutral");
    expect(p95Tone(null, 1_000)).toBe("neutral");
  });

  it("names the top row costly only when it is past the line", () => {
    expect(costlyRoute([row({ p95: 1_500 }), row({ route: "/b" })], 1_000)).toMatchObject({ route: "/api/x" });
    expect(costlyRoute([row({ p95: 40 })], 1_000)).toBeNull();
    expect(costlyRoute([], 1_000)).toBeNull();
  });
});

describe("linksToLogs", () => {
  it("opens a called route, never an idle one or the unmatched bucket", () => {
    expect(linksToLogs(row({}))).toBe(true);
    expect(linksToLogs(row({ requests: 0 }))).toBe(false);
    expect(linksToLogs(row({ route: "unknown" }))).toBe(false);
  });
});

describe("formatShare", () => {
  it("keeps a sliver visible and rounds the rest", () => {
    expect(formatShare(0.004)).toBe("0.4%");
    expect(formatShare(0.384)).toBe("38%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(null)).toBe("—");
  });
});

describe("bucketLabel", () => {
  it("names the scraped bounds in milliseconds, without rounding them", () => {
    expect(bucketLabel({ fromMs: 0, toMs: 25, count: 1 })).toBe("≤ 25ms");
    expect(bucketLabel({ fromMs: 25, toMs: 100, count: 1 })).toBe("25–100ms");
    expect(bucketLabel({ fromMs: 1_000, toMs: null, count: 1 })).toBe("> 1000ms");
    expect(bucketLabel({ fromMs: 0, toMs: 5, count: 1 })).toBe("≤ 5ms");
  });
});

describe("bucketTone", () => {
  it("reads off the threshold", () => {
    expect(bucketTone({ fromMs: 0, toMs: 25, count: 0 }, 1_000)).toBe("ok");
    expect(bucketTone({ fromMs: 25, toMs: 100, count: 0 }, 1_000)).toBe("ok");
    expect(bucketTone({ fromMs: 100, toMs: 250, count: 0 }, 1_000)).toBe("info");
    expect(bucketTone({ fromMs: 500, toMs: 1_000, count: 0 }, 1_000)).toBe("warn");
    expect(bucketTone({ fromMs: 1_000, toMs: null, count: 0 }, 1_000)).toBe("error");
  });
});

describe("bucketShares", () => {
  it("divides by the observations, and has nothing to say without any", () => {
    expect(
      bucketShares([
        { fromMs: 0, toMs: 25, count: 3 },
        { fromMs: 25, toMs: null, count: 1 },
      ]),
    ).toEqual([0.75, 0.25]);
    expect(bucketShares([{ fromMs: 0, toMs: null, count: 0 }])).toEqual([null]);
  });
});

describe("statusParts", () => {
  it("always shows 2xx/4xx/5xx and the rest only when they hold something", () => {
    const parts = statusParts({ "2xx": 8, "3xx": 0, "4xx": 0, "5xx": 2, other: 0 });
    expect(parts.map((p) => p.key)).toEqual(["2xx", "4xx", "5xx"]);
    expect(parts[0].share).toBeCloseTo(0.8);

    expect(statusParts({ "2xx": 1, "3xx": 1, "4xx": 0, "5xx": 0, other: 0 }).map((p) => p.key)).toEqual([
      "2xx",
      "3xx",
      "4xx",
      "5xx",
    ]);
  });

  it("is empty with no responses", () => {
    expect(statusParts({ "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 })).toEqual([]);
  });
});
