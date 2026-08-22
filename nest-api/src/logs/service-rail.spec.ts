import { describe, expect, it } from "vitest";
import { latestHealthByService, sparklinesByService } from "./service-rail";

/**
 * The arithmetic behind the enriched service rail (IKN-8): which probe row is the current one,
 * when it stops being current, and how log counts become the sixty minute-buckets of the
 * sparkline. Pure, because this is the part that would otherwise be wrong silently — the query
 * around it is a range scan anybody can read.
 */
describe("latestHealthByService", () => {
  const now = new Date("2026-08-22T21:00:00.000Z");

  it("keeps the newest row per service and maps it onto the contract", () => {
    const rows = [
      { service: "pfa", ts: new Date("2026-08-22T20:59:30Z"), httpStatus: 200, ok: true, latencyMs: 6, checks: null },
      { service: "pfa", ts: new Date("2026-08-22T20:58:00Z"), httpStatus: 503, ok: false, latencyMs: 9, checks: null },
    ];

    const health = latestHealthByService(rows, now);

    expect(health.get("pfa")).toMatchObject({ status: "ok", httpStatus: 200, latencyMs: 6 });
    expect(health.get("pfa")?.checkedAt).toBe("2026-08-22T20:59:30.000Z");
  });

  it("marks a failed probe as error, with the checks breakdown carried through", () => {
    const checks = { db: { status: "ok", latencyMs: 2 }, redis: { status: "error", latencyMs: 1001 } };
    const rows = [
      { service: "pfa", ts: new Date("2026-08-22T20:59:30Z"), httpStatus: 503, ok: false, latencyMs: 12, checks },
    ];

    expect(latestHealthByService(rows, now).get("pfa")).toMatchObject({ status: "error", checks });
  });

  it("marks a probe older than the staleness window as stale — a green dot must be earned recently", () => {
    const rows = [
      { service: "pfa", ts: new Date("2026-08-22T20:57:00Z"), httpStatus: 200, ok: true, latencyMs: 3, checks: null },
    ];

    expect(latestHealthByService(rows, now).get("pfa")?.status).toBe("stale");
  });

  it("has no entry for a service that was never probed", () => {
    expect(latestHealthByService([], now).size).toBe(0);
  });
});

describe("sparklinesByService", () => {
  const now = new Date("2026-08-22T21:00:30.000Z");
  const minuteOf = (iso: string) => Math.floor(new Date(iso).getTime() / 60_000);

  it("distributes counts into sixty buckets, oldest first, zeros where nothing happened", () => {
    const counts = [
      { service: "pfa", minute: minuteOf("2026-08-22T21:00:00Z"), n: 5 },
      { service: "pfa", minute: minuteOf("2026-08-22T20:30:00Z"), n: 2 },
    ];

    const lines = sparklinesByService(counts, now, ["pfa"]);
    const line = lines.get("pfa");

    expect(line).toHaveLength(60);
    expect(line?.at(-1)).toBe(5);
    expect(line?.at(-31)).toBe(2);
    expect(line?.filter((n) => n === 0)).toHaveLength(58);
  });

  it("gives every requested service a line — sixty zeros is a true statement about an idle service", () => {
    const lines = sparklinesByService([], now, ["idle-service"]);

    expect(lines.get("idle-service")).toEqual(Array(60).fill(0));
  });

  it("ignores counts outside the window instead of wrapping them around", () => {
    const counts = [{ service: "pfa", minute: minuteOf("2026-08-22T19:00:00Z"), n: 99 }];

    expect(sparklinesByService(counts, now, ["pfa"]).get("pfa")).toEqual(Array(60).fill(0));
  });
});
