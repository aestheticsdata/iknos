import { BUCKET } from "@contracts/traffic";
import { describe, expect, it } from "vitest";
import { bucketFor, bucketGrid, localHour, localKey, safeTimeZone } from "./buckets";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PARIS = "Europe/Paris";

describe("bucketFor", () => {
  it("lands every range in the top bar between 60 and 170 bars (IKN-86)", () => {
    const to = new Date("2026-10-31T09:00:00Z");
    const MIN = 60_000;
    expect(bucketFor(new Date(+to - 15 * MIN), to)).toBe(BUCKET.s15);
    expect(bucketFor(new Date(+to - HOUR), to)).toBe(BUCKET.m1);
    expect(bucketFor(new Date(+to - DAY), to)).toBe(BUCKET.m10);
    expect(bucketFor(new Date(+to - 7 * DAY), to)).toBe(BUCKET.h1);
    expect(bucketFor(new Date(+to - 14 * DAY), to)).toBe(BUCKET.h2);
    expect(bucketFor(new Date(+to - 31 * DAY), to)).toBe(BUCKET.day);
  });
});

describe("localKey", () => {
  it("files a late-evening UTC request on the reader's next day", () => {
    expect(localKey(new Date("2026-10-30T23:30:00Z"), { tz: PARIS, bucket: BUCKET.day })).toBe("2026-10-31");
  });

  it("keys hours in the reader's zone", () => {
    expect(localKey(new Date("2026-10-30T23:30:00Z"), { tz: PARIS, bucket: BUCKET.h1 })).toBe("2026-10-31T00");
  });

  it("floors to the bucket's slice of the wall clock", () => {
    const at = new Date("2026-10-31T13:47:38Z"); // 14:47:38 in Paris
    expect(localKey(at, { tz: PARIS, bucket: BUCKET.h2 })).toBe("2026-10-31T14");
    expect(localKey(at, { tz: PARIS, bucket: BUCKET.m10 })).toBe("2026-10-31T14:40");
    expect(localKey(at, { tz: PARIS, bucket: BUCKET.m1 })).toBe("2026-10-31T14:47");
    expect(localKey(at, { tz: PARIS, bucket: BUCKET.s15 })).toBe("2026-10-31T14:47:30");
  });

  it("starts ten-minute buckets on the local ten, even at a quarter-hour offset", () => {
    // Kathmandu is UTC+5:45: 08:20 UTC is 14:05 local, in the 14:00 bucket.
    expect(localKey(new Date("2026-10-31T08:20:00Z"), { tz: "Asia/Kathmandu", bucket: BUCKET.m10 })).toBe(
      "2026-10-31T14:00",
    );
  });
});

describe("localHour", () => {
  it("reads the wall-clock hour", () => {
    expect(localHour(new Date("2026-10-31T13:05:00Z"), PARIS)).toBe(14);
    expect(localHour(new Date("2026-10-30T23:30:00Z"), PARIS)).toBe(0);
  });
});

describe("bucketGrid", () => {
  it("gives a rolling fortnight past two weeks eight-plus calendar days, partial at both ends", () => {
    const from = new Date("2026-10-04T08:00:00Z"); // 10:00 in Paris, summer time
    const to = new Date(+from + 20 * DAY);
    const grid = bucketGrid({ from, to, tz: PARIS, retentionDays: 31, now: to });

    expect(grid).toHaveLength(21);
    expect(grid[0].key).toBe("2026-10-04");
    expect(grid[0].partial).toBe(true);
    expect(grid.at(-1)?.partial).toBe(true);
    expect(grid.slice(1, -1).some((slot) => slot.partial)).toBe(false);
    // The first bucket starts at local midnight, before the range does.
    expect(grid[0].t).toBe("2026-10-03T22:00:00.000Z");
  });

  it("keeps the 25-hour day of the clock change as one bucket", () => {
    const grid = bucketGrid({
      from: new Date("2026-10-08T12:00:00Z"),
      to: new Date("2026-10-27T12:00:00Z"),
      tz: PARIS,
      retentionDays: 31,
      now: new Date("2026-10-27T12:00:00Z"),
    });

    const sunday = grid.findIndex((slot) => slot.key === "2026-10-25");
    expect(grid[sunday].t).toBe("2026-10-24T22:00:00.000Z");
    expect(grid[sunday + 1].t).toBe("2026-10-25T23:00:00.000Z");
  });

  it("marks the buckets before the retention cut as unavailable", () => {
    const to = new Date("2026-10-31T09:00:00Z");
    const grid = bucketGrid({ from: new Date(+to - 14 * DAY), to, tz: PARIS, retentionDays: 7, now: to });

    const firstAvailable = grid.findIndex((slot) => slot.available);
    expect(firstAvailable).toBeGreaterThan(0);
    expect(grid.slice(firstAvailable).every((slot) => slot.available)).toBe(true);
    expect(Date.parse(grid[firstAvailable].t) + 2 * HOUR).toBeGreaterThan(+to - 7 * DAY);
  });

  it("lays a week out in 168 hours, the one in progress partial", () => {
    const to = new Date("2026-10-31T09:30:00Z");
    const grid = bucketGrid({ from: new Date(+to - 7 * DAY), to, tz: PARIS, retentionDays: 14, now: to });

    // 169 local hours touched, less one: the repeated 02:00 of the clock change is one key.
    expect(grid).toHaveLength(168);
    expect(grid[0].key).toBe("2026-10-24T11");
    expect(grid.at(-1)?.key).toBe("2026-10-31T10");
    expect(grid.at(-1)?.partial).toBe(true);
  });

  it("lays a day out in ten-minute buckets", () => {
    const to = new Date("2026-10-31T09:35:00Z");
    const grid = bucketGrid({ from: new Date(+to - DAY), to, tz: PARIS, retentionDays: 14, now: to });

    expect(grid).toHaveLength(145);
    expect(grid[0].key).toBe("2026-10-30T10:30");
    expect(grid.at(-1)?.key).toBe("2026-10-31T10:30");
  });

  it("lays a quarter-hour out in fifteen-second buckets, none partial when the edges fall on one", () => {
    const to = new Date("2026-10-31T09:30:00Z");
    const grid = bucketGrid({ from: new Date(+to - 15 * 60_000), to, tz: PARIS, retentionDays: 14, now: to });

    expect(grid).toHaveLength(60);
    expect(grid.some((slot) => slot.partial)).toBe(false);
  });
});

describe("safeTimeZone", () => {
  it("keeps a zone Intl knows and falls back to Paris otherwise", () => {
    expect(safeTimeZone("America/New_York")).toBe("America/New_York");
    expect(safeTimeZone("Mars/Base")).toBe(PARIS);
    expect(safeTimeZone(undefined)).toBe(PARIS);
  });
});
