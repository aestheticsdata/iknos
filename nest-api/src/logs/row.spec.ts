import { describe, expect, it } from "vitest";
import { toLogRow } from "./row";

import type { RawLogRow } from "./row";

const raw = (over: Partial<RawLogRow> = {}): RawLogRow => ({
  id: 1n,
  ts: new Date("2026-08-09T10:11:12.345Z"),
  service: "pfa-api",
  level: 30,
  levelName: "info",
  message: "hello",
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  ...over,
});

describe("toLogRow", () => {
  it("carries an id past 2^53 without losing a digit", () => {
    // The exact failure this guards: as a JSON number, 9007199254740993 becomes ...992. Since the
    // cursor is built from the id, one rounded value silently repeats or skips a row.
    const row = toLogRow(raw({ id: 9_007_199_254_740_993n }));

    expect(row.id).toBe("9007199254740993");
    expect(typeof row.id).toBe("string");
  });

  it("survives JSON.stringify", () => {
    // A BigInt anywhere in the payload makes JSON.stringify throw outright — the first log row
    // to reach a response would 500 the route.
    expect(() => JSON.stringify(toLogRow(raw()))).not.toThrow();
  });

  it("emits the timestamp as ISO-8601 in UTC", () => {
    expect(toLogRow(raw()).ts).toBe("2026-08-09T10:11:12.345Z");
  });
});
