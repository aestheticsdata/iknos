import { describe, expect, it } from "vitest";
import { dayStarts } from "./logDays";
import { calendarDay } from "./zone";

import type { LogFeedItem, LogRow } from "./logTypes";

const row = (key: string, ts: string): LogFeedItem => ({ kind: "row", key, row: { ts } as LogRow });
const gap = (key: string): LogFeedItem => ({ kind: "gap", key, dropped: 3 });

describe("calendarDay", () => {
  it("names the day in the zone, not in UTC", () => {
    // 23:30Z on the 21st is already the 22nd in Paris (CEST, +02:00).
    expect(calendarDay("2026-08-21T23:30:00.000Z", "UTC")).toEqual({ key: "2026-08-21", label: "Fri 2026-08-21" });
    expect(calendarDay("2026-08-21T23:30:00.000Z", "Europe/Paris")).toEqual({
      key: "2026-08-22",
      label: "Sat 2026-08-22",
    });
  });

  it("returns null for something that is not an instant", () => {
    expect(calendarDay("not a date", "UTC")).toBeNull();
  });
});

describe("dayStarts", () => {
  it("marks the first row, then each row that opens a new day — newest first, as the table lists", () => {
    const items = [
      row("a", "2026-08-22T08:00:00.000Z"),
      row("b", "2026-08-22T01:00:00.000Z"),
      row("c", "2026-08-21T22:00:00.000Z"),
      row("d", "2026-08-20T12:00:00.000Z"),
    ];

    expect([...dayStarts(items, "UTC")]).toEqual([
      ["a", "Sat 2026-08-22"],
      ["c", "Fri 2026-08-21"],
      ["d", "Thu 2026-08-20"],
    ]);
  });

  it("moves the boundary with the zone", () => {
    // In Paris, c (22:00Z → 00:00 the 22nd) belongs to the same day as a and b.
    const items = [row("a", "2026-08-22T08:00:00.000Z"), row("c", "2026-08-21T22:00:00.000Z")];
    expect([...dayStarts(items, "Europe/Paris").keys()]).toEqual(["a"]);
  });

  it("does not let a gap row break a day", () => {
    const items = [row("a", "2026-08-22T08:00:00.000Z"), gap("g"), row("b", "2026-08-22T07:00:00.000Z")];
    expect([...dayStarts(items, "UTC").keys()]).toEqual(["a"]);
  });

  it("is empty for an empty list", () => {
    expect(dayStarts([], "UTC").size).toBe(0);
  });
});
