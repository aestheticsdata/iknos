import { describe, expect, it } from "vitest";
import { labelsHash } from "./labels-hash";
import { toMetricRows } from "./metric-rows";

/**
 * Samples → `metric_sample` rows (IKN-8). The mapper is where storability is decided: MySQL
 * DOUBLE holds neither Inf nor NaN, so non-finite values are dropped here — the parser reported
 * them faithfully, the table simply cannot keep them.
 */
describe("toMetricRows", () => {
  const ts = new Date("2026-08-22T20:00:00.000Z");

  it("maps a labelled sample with its hash, and keeps ts and service", () => {
    const rows = toMetricRows("pfa-nest-api", ts, [{ name: "a", labels: { method: "GET" }, value: 1 }]);

    expect(rows).toEqual([
      {
        service: "pfa-nest-api",
        ts,
        name: "a",
        labels: { method: "GET" },
        labelsHash: labelsHash({ method: "GET" }),
        value: 1,
      },
    ]);
  });

  it("omits the labels column for an unlabelled series but still hashes the empty set", () => {
    const rows = toMetricRows("s", ts, [{ name: "b", labels: null, value: 2 }]);

    expect(rows[0]).not.toHaveProperty("labels");
    expect(rows[0].labelsHash).toBe(labelsHash(null));
  });

  it("drops non-finite values — a DOUBLE cannot store them", () => {
    const rows = toMetricRows("s", ts, [
      { name: "inf", labels: null, value: Number.POSITIVE_INFINITY },
      { name: "nan", labels: null, value: Number.NaN },
      { name: "ok", labels: null, value: 3 },
    ]);

    expect(rows.map((r) => r.name)).toEqual(["ok"]);
  });

  it("drops a sample whose name exceeds the column rather than corrupting it by truncation", () => {
    const rows = toMetricRows("s", ts, [{ name: "m".repeat(129), labels: null, value: 1 }]);

    expect(rows).toEqual([]);
  });
});
