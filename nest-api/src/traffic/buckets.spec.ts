import { BUCKET } from "@contracts/traffic";
import { describe, expect, it } from "vitest";
import { bucketFor, bucketGrid, localHour, localKey, safeTimeZone } from "./buckets";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PARIS = "Europe/Paris";

describe("bucketFor", () => {
  it("is hourly up to a day and daily beyond", () => {
    const to = new Date("2026-10-31T09:00:00Z");
    expect(bucketFor(new Date(+to - DAY), to)).toBe(BUCKET.hour);
    expect(bucketFor(new Date(+to - 7 * DAY), to)).toBe(BUCKET.day);
  });
});

describe("localKey", () => {
  it("files a late-evening UTC request on the reader's next day", () => {
    expect(localKey(new Date("2026-10-30T23:30:00Z"), { tz: PARIS, bucket: BUCKET.day })).toBe("2026-10-31");
  });

  it("keys hours in the reader's zone", () => {
    expect(localKey(new Date("2026-10-30T23:30:00Z"), { tz: PARIS, bucket: BUCKET.hour })).toBe("2026-10-31T00");
  });
});

describe("localHour", () => {
  it("reads the wall-clock hour", () => {
    expect(localHour(new Date("2026-10-31T13:05:00Z"), PARIS)).toBe(14);
    expect(localHour(new Date("2026-10-30T23:30:00Z"), PARIS)).toBe(0);
  });
});

describe("bucketGrid", () => {
  it("gives a rolling week eight calendar days, partial at both ends", () => {
    const from = new Date("2026-10-24T08:00:00Z"); // 10:00 in Paris, summer time
    const to = new Date(+from + 7 * DAY);
    const grid = bucketGrid({ from, to, tz: PARIS, retentionDays: 14, now: to });

    expect(grid.map((slot) => slot.key)).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(grid.map((slot) => slot.partial)).toEqual([true, false, false, false, false, false, false, true]);
    // The first bucket starts at local midnight, before the range does.
    expect(grid[0].t).toBe("2026-10-23T22:00:00.000Z");
  });

  it("keeps the 25-hour day of the clock change as one bucket", () => {
    const grid = bucketGrid({
      from: new Date("2026-10-24T12:00:00Z"),
      to: new Date("2026-10-27T12:00:00Z"),
      tz: PARIS,
      retentionDays: 14,
      now: new Date("2026-10-27T12:00:00Z"),
    });

    expect(grid.map((slot) => slot.key)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(grid[2].t).toBe("2026-10-25T23:00:00.000Z");
  });

  it("marks the days before the retention cut as unavailable", () => {
    const to = new Date("2026-10-31T09:00:00Z");
    const grid = bucketGrid({ from: new Date(+to - 14 * DAY), to, tz: PARIS, retentionDays: 7, now: to });

    expect(grid).toHaveLength(15);
    expect(grid.slice(0, 7).every((slot) => !slot.available)).toBe(true);
    expect(grid.slice(7).every((slot) => slot.available)).toBe(true);
  });

  it("lays a day out in hours, none of them partial", () => {
    const to = new Date("2026-10-31T09:30:00Z");
    const grid = bucketGrid({ from: new Date(+to - DAY), to, tz: PARIS, retentionDays: 14, now: to });

    expect(grid).toHaveLength(25);
    expect(grid[0].key).toBe("2026-10-30T10");
    expect(grid.at(-1)?.key).toBe("2026-10-31T10");
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
