import { describe, expect, it } from "vitest";
import {
  type GaugeRow,
  HEAP_TOTAL,
  HEAP_USED,
  LOOP_LAG_P99,
  newestBySeries,
  POOL,
  toChecks,
  toNodeRuntime,
  toProbeSummary,
  toProcessFacts,
} from "./runtime-facts";

/**
 * The header chips, the health pills and the runtime gauges (IKN-13).
 *
 * The failures worth catching here are the quiet ones: a pool collapsed to whichever `state` was
 * written last, an event-loop lag reported in seconds under a millisecond label, and a probe that
 * keeps its green pill for a day after the collector stopped answering.
 */

const NOW = new Date("2026-08-23T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const gauge = (name: string, value: number, labels: unknown = null, ts: Date = NOW, hash = name): GaugeRow => ({
  ts,
  name,
  labelsHash: hash,
  labels,
  value,
});

describe("newestBySeries", () => {
  it("keeps one reading per series, not per metric name", () => {
    // The pool is three series under one name. Keyed on the name alone, the tile would show
    // whichever `state` happened to be written last and call it the pool.
    const rows = [
      gauge(POOL, 1, { state: "active" }, ago(30_000), "pool-active"),
      gauge(POOL, 9, { state: "idle" }, ago(30_000), "pool-idle"),
      gauge(POOL, 0, { state: "waiting" }, ago(30_000), "pool-waiting"),
      gauge(POOL, 2, { state: "active" }, NOW, "pool-active"),
    ];

    const newest = newestBySeries(rows);

    expect(newest).toHaveLength(3);
    expect(newest.find((row) => row.labelsHash === "pool-active")?.value).toBe(2);
  });
});

describe("toNodeRuntime", () => {
  const rows = [
    gauge(HEAP_USED, 94_572_784),
    gauge(HEAP_TOTAL, 214_220_800),
    gauge(LOOP_LAG_P99, 0.011_370_495),
    gauge(POOL, 3, { state: "active" }, NOW, "pool-active"),
    gauge(POOL, 7, { state: "idle" }, NOW, "pool-idle"),
    gauge(POOL, 0, { state: "waiting" }, NOW, "pool-waiting"),
  ];

  it("converts the event-loop lag out of seconds", () => {
    // Prometheus publishes it in seconds; every latency in this product is milliseconds, and
    // `0.011` under a `ms` label reads as a suspiciously fast event loop rather than as a bug.
    expect(toNodeRuntime(rows).eventLoopLagMs).toBeCloseTo(11.370_495, 6);
  });

  it("reads the pool out of its three state series", () => {
    expect(toNodeRuntime(rows).pool).toEqual({ active: 3, idle: 7, waiting: 0 });
  });

  it("has no pool at all for a service that exports none", () => {
    // Not `0/0/0`: an empty bar says "no connections in use" about a service that has no
    // connections to use.
    const withoutPool = rows.filter((row) => row.name !== POOL);

    expect(toNodeRuntime(withoutPool).pool).toBeNull();
  });

  it("carries each gauge's absence independently", () => {
    // A service may export a heap and no pool, or a pool and no lag. One nullable object for all
    // four would blank three-quarters of a tile because one exporter was missing.
    const heapOnly = [gauge(HEAP_USED, 1_000)];
    const runtime = toNodeRuntime(heapOnly);

    expect(runtime.heapUsedBytes).toBe(1_000);
    expect(runtime.heapTotalBytes).toBeNull();
    expect(runtime.eventLoopLagMs).toBeNull();
    expect(runtime.pool).toBeNull();
  });

  it("ages against the least fresh reading it is showing", () => {
    const mixed = [gauge(HEAP_USED, 1_000, null, ago(90_000)), gauge(HEAP_TOTAL, 2_000, null, NOW)];

    expect(toNodeRuntime(mixed).observedAt).toBe(ago(90_000).toISOString());
  });

  it("has nothing to say when no gauge was found", () => {
    expect(toNodeRuntime([])).toEqual({
      heapUsedBytes: null,
      heapTotalBytes: null,
      eventLoopLagMs: null,
      pool: null,
      observedAt: null,
    });
  });
});

describe("toProbeSummary", () => {
  const base = { httpStatus: 200, ok: true, latencyMs: 6, error: null, checks: null };

  it("maps a recent successful probe onto an ok pill", () => {
    expect(toProbeSummary({ ...base, ts: ago(10_000) }, NOW).status).toBe("ok");
  });

  it("maps a recent failed probe onto an error pill, keeping what the probe learned", () => {
    const failed = { ...base, ts: ago(10_000), httpStatus: null, ok: false, error: "fetch failed" };
    const summary = toProbeSummary(failed, NOW);

    expect(summary).toMatchObject({ status: "error", httpStatus: null, error: "fetch failed" });
  });

  it("marks a probe past the staleness window as stale, whatever it said", () => {
    // A green pill has to be earned by a recent answer. This one succeeded, ten minutes ago, and
    // what stopped is the answering — which is a different fact from a service being down.
    expect(toProbeSummary({ ...base, ts: ago(600_000) }, NOW).status).toBe("stale");
  });

  it("uses the same threshold the rail's dot does", () => {
    // Imported from `service-rail`, not restated: two thresholds would put an amber dot beside a
    // green pill for one probe, with no way to tell which was right.
    expect(toProbeSummary({ ...base, ts: ago(89_000) }, NOW).status).toBe("ok");
    expect(toProbeSummary({ ...base, ts: ago(91_000) }, NOW).status).toBe("stale");
  });
});

describe("toChecks", () => {
  it("keeps the names the service used, in the order it sent them", () => {
    // PFA calls its database `db` and the mockup draws `mysql`. Translating would be Iknos
    // asserting which engine sits behind a word only the service knows the truth of.
    const checks = { db: { status: "ok", latencyMs: 1 }, redis: { status: "ok", latencyMs: 1 } };

    expect(toChecks(checks)).toEqual([
      { name: "db", status: "ok", latencyMs: 1 },
      { name: "redis", status: "ok", latencyMs: 1 },
    ]);
  });

  it("reads a breakdown the driver handed back as text", () => {
    expect(toChecks('{"db":{"status":"error","latencyMs":1001}}')).toEqual([
      { name: "db", status: "error", latencyMs: 1001 },
    ]);
  });

  it("keeps a dependency that reported no timing, and says its latency is unknown", () => {
    expect(toChecks({ redis: { status: "ok" } })).toEqual([{ name: "redis", status: "ok", latencyMs: null }]);
  });

  it("keeps a dependency that reported no status either, rather than dropping the row", () => {
    expect(toChecks({ redis: { latencyMs: 2 } })).toEqual([{ name: "redis", status: "unknown", latencyMs: 2 }]);
  });

  it("has no pills for a body that carried no breakdown", () => {
    expect(toChecks(null)).toEqual([]);
    expect(toChecks("not json")).toEqual([]);
    expect(toChecks([{ db: "ok" }])).toEqual([]);
  });
});

describe("toProcessFacts", () => {
  it("reports when the process started rather than how long it has been up", () => {
    // The reading does not age, so the arithmetic happens at display time — a payload cached for
    // thirty seconds must not claim the process started thirty seconds later than it did.
    const facts = toProcessFacts({
      ts: NOW,
      pm2Id: 3,
      status: "online",
      restarts: 7,
      nodeVersion: "24.11.1",
      startedAt: ago(6 * 86_400_000),
    });

    expect(facts).toEqual({
      pm2Id: 3,
      status: "online",
      restarts: 7,
      nodeVersion: "24.11.1",
      startedAt: "2026-08-17T12:00:00.000Z",
      observedAt: "2026-08-23T12:00:00.000Z",
    });
  });

  it("carries through what PM2 did not say", () => {
    const facts = toProcessFacts({
      ts: NOW,
      pm2Id: null,
      status: "stopped",
      restarts: 0,
      nodeVersion: null,
      startedAt: null,
    });

    expect(facts.startedAt).toBeNull();
    expect(facts.nodeVersion).toBeNull();
  });
});
