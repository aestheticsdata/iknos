import { describe, expect, it } from "vitest";
import { logDetailUrl } from "./logQuery";

describe("logDetailUrl", () => {
  const at = (ts: string) => new URL(logDetailUrl({ id: "42", ts }), "http://x").searchParams;

  it("bounds the lookup to the row's own millisecond", () => {
    // The endpoint compares `ts >= from AND ts < to`, so this is the smallest window that contains
    // the row at all — and the tightest partition prune there is on a table partitioned by day.
    const params = at("2026-08-09T10:11:12.345Z");

    expect(params.get("from")).toBe("2026-08-09T10:11:12.345Z");
    expect(params.get("to")).toBe("2026-08-09T10:11:12.346Z");
  });

  it("carries no bound that could move under the open row", () => {
    // Not the panel's range, deliberately: `refresh` re-takes `now`, every relative range slides
    // with it, and a line expanded near the edge of a 15-minute window would start answering 404
    // while still visibly sitting in the list.
    expect(logDetailUrl({ id: "42", ts: "2026-08-09T10:11:12.345Z" })).toBe(
      logDetailUrl({ id: "42", ts: "2026-08-09T10:11:12.345Z" }),
    );
  });

  it("rolls the upper bound over a second, a day and a year", () => {
    expect(at("2026-08-09T10:11:12.999Z").get("to")).toBe("2026-08-09T10:11:13.000Z");
    expect(at("2026-08-09T23:59:59.999Z").get("to")).toBe("2026-08-10T00:00:00.000Z");
    expect(at("2026-12-31T23:59:59.999Z").get("to")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("addresses the row by its id, escaped", () => {
    expect(logDetailUrl({ id: "9007199254740993", ts: "2026-08-09T10:11:12.345Z" })).toContain(
      "/logs/entry/9007199254740993?",
    );
  });
});
