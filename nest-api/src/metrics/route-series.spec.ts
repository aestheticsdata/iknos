import { describe, expect, it } from "vitest";
import { buildRouteDetail, buildRouteRows, compareRoutes, distributionOf, statusSplitOf } from "./route-series";
import { DURATION_BUCKET, type MetricRow, PROCESS_START, REQUESTS_TOTAL } from "./signal-series";

import type { RouteRow } from "@contracts/route-metrics";
import type { SourcePlan } from "./metric-window";

/**
 * Rows → the routes table and the route detail (IKN-23).
 *
 * The cases are the ones where a plausible answer is the wrong one: two methods on one path summed
 * into one row, a route's p95 taken from the service's histogram, a range p99 averaged from the
 * per-minute ones, and bucket bounds re-labelled into round numbers.
 */

const FROM = new Date("2026-10-09T12:00:00.000Z");
const MINUTE = 60_000;
const PLAN: SourcePlan = { bucketMs: MINUTE, buckets: 3, boundary: 0, source: "raw" };

const row = (name: string, series: string, labels: unknown, bucket: number, value: number): MetricRow => ({
  bucket,
  ts: FROM.getTime() + bucket * MINUTE + MINUTE / 2,
  name,
  series,
  labels,
  value,
});

const scraped = (buckets: number[]): MetricRow[] =>
  buckets.map((bucket) => row(PROCESS_START, "proc", null, bucket, 1_787_481_637));

/** A counter's readings from the priming interval on. */
const counter = (name: string, labels: Record<string, string>, values: number[]): MetricRow[] =>
  values.map((value, index) => row(name, JSON.stringify(labels), labels, index - 1, value));

const requests = (method: string, route: string, status: string, values: number[]) =>
  counter(REQUESTS_TOTAL, { method, route, status_code: status }, values);

const bucket = (method: string, route: string, le: string, values: number[]) =>
  counter(DURATION_BUCKET, { le, method, route }, values);

/*
 *   GET  /api/spendings/:id — 10 requests a minute, all ≤ 50 ms
 *   POST /api/spendings/:id —  2 requests a minute, all between 0.5 s and 1 s, one 5xx in all
 *   GET  /api/idle          — present, never called in the range
 */
const ROWS: MetricRow[] = [
  ...scraped([-1, 0, 1, 2]),
  ...requests("GET", "/api/spendings/:id", "200", [100, 110, 120, 130]),
  ...bucket("GET", "/api/spendings/:id", "0.05", [100, 110, 120, 130]),
  ...bucket("GET", "/api/spendings/:id", "0.5", [100, 110, 120, 130]),
  ...bucket("GET", "/api/spendings/:id", "1", [100, 110, 120, 130]),
  ...bucket("GET", "/api/spendings/:id", "+Inf", [100, 110, 120, 130]),
  ...requests("POST", "/api/spendings/:id", "201", [10, 12, 13, 15]),
  ...requests("POST", "/api/spendings/:id", "500", [0, 0, 1, 1]),
  ...bucket("POST", "/api/spendings/:id", "0.05", [0, 0, 0, 0]),
  ...bucket("POST", "/api/spendings/:id", "0.5", [0, 0, 0, 0]),
  ...bucket("POST", "/api/spendings/:id", "1", [10, 12, 14, 16]),
  ...bucket("POST", "/api/spendings/:id", "+Inf", [10, 12, 14, 16]),
  ...requests("GET", "/api/idle", "200", [5, 5, 5, 5]),
  ...bucket("GET", "/api/idle", "+Inf", [5, 5, 5, 5]),
];

describe("buildRouteRows", () => {
  const rows = buildRouteRows(ROWS, PLAN);

  it("keeps two methods on one path as two routes, worst p95 first", () => {
    expect(rows.map((r) => `${r.method} ${r.route}`)).toEqual([
      "POST /api/spendings/:id",
      "GET /api/spendings/:id",
      "GET /api/idle",
    ]);
  });

  it("takes each route's percentiles from its own histogram", () => {
    const [post, get] = rows;
    // Everything POST did is in the 0.5 → 1 bucket; the interpolation lands inside it.
    expect(post.p50).toBeCloseTo(750);
    expect(post.p95).toBeCloseTo(975);
    // Everything GET did is under 50 ms.
    expect(get.p95).toBeCloseTo(47.5);
  });

  it("counts requests, rate, errors and share over the range", () => {
    const [post, get, idle] = rows;
    expect(get.requests).toBe(30);
    expect(post.requests).toBe(6);
    expect(get.rate).toBeCloseTo(30 / 180);
    expect(post.errorRate).toBeCloseTo((1 / 6) * 100);
    expect(get.share).toBeCloseTo(30 / 36);
    expect(idle.share).toBe(0);
  });

  it("answers a route nobody called with nulls, not zeros", () => {
    const idle = rows[2];
    expect(idle.requests).toBe(0);
    expect(idle.p95).toBeNull();
    expect(idle.errorRate).toBeNull();
  });

  it("leaves out series that carry no route", () => {
    const stray = counter(REQUESTS_TOTAL, { method: "GET", status_code: "200" }, [1, 2, 3, 4]);
    expect(buildRouteRows([...ROWS, ...stray], PLAN)).toHaveLength(3);
  });
});

describe("compareRoutes", () => {
  const base: RouteRow = {
    method: "GET",
    route: "/a",
    requests: 1,
    rate: null,
    p50: null,
    p95: null,
    p99: null,
    errorRate: null,
    share: null,
  };

  it("puts a missing p95 last and breaks ties on traffic", () => {
    const sorted = [
      { ...base, route: "/none" },
      { ...base, route: "/fast", p95: 10 },
      { ...base, route: "/busy", p95: 10, requests: 50 },
    ].sort(compareRoutes);
    expect(sorted.map((r) => r.route)).toEqual(["/busy", "/fast", "/none"]);
  });
});

describe("buildRouteDetail", () => {
  it("serves the route's own series, and the range figure is recomputed rather than averaged", () => {
    const detail = buildRouteDetail({
      rows: ROWS,
      from: FROM,
      plan: PLAN,
      target: { method: "POST", route: "/api/spendings/:id" },
    });
    expect(detail).not.toBeNull();
    expect(detail?.p95.points).toHaveLength(3);
    expect(detail?.p95.value).toBe(detail?.summary.p95);
    expect(detail?.status).toEqual({ "2xx": 5, "3xx": 0, "4xx": 0, "5xx": 1, other: 0 });
  });

  it("is null for a route the rows do not contain", () => {
    expect(
      buildRouteDetail({ rows: ROWS, from: FROM, plan: PLAN, target: { method: "PUT", route: "/api/spendings/:id" } }),
    ).toBeNull();
  });
});

describe("distributionOf", () => {
  it("keeps the scraped bounds, in milliseconds, and differences the cumulative counts", () => {
    expect(
      distributionOf([
        { le: Number.POSITIVE_INFINITY, count: 10 },
        { le: 0.025, count: 4 },
        { le: 0.1, count: 7 },
      ]),
    ).toEqual([
      { fromMs: 0, toMs: 25, count: 4 },
      { fromMs: 25, toMs: 100, count: 3 },
      { fromMs: 100, toMs: null, count: 3 },
    ]);
  });

  it("repairs a count that went backwards rather than reporting a negative interval", () => {
    const out = distributionOf([
      { le: 0.1, count: 5 },
      { le: 0.5, count: 4 },
      { le: Number.POSITIVE_INFINITY, count: 6 },
    ]);
    expect(out.map((b) => b.count)).toEqual([5, 0, 1]);
  });
});

describe("statusSplitOf", () => {
  it("files anything that is not a three-digit code under other", () => {
    const split = statusSplitOf(
      new Map([
        ["404", [1, 2]],
        ["", [3, 0]],
      ]),
      [true, false],
    );
    expect(split).toEqual({ "2xx": 0, "3xx": 0, "4xx": 1, "5xx": 0, other: 3 });
  });
});
