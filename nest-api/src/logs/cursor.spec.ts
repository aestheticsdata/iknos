import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("cursor", () => {
  it("round-trips a timestamp and a BigInt id", () => {
    const ts = new Date("2026-08-09T10:11:12.345Z");
    const decoded = decodeCursor(encodeCursor(ts, 9_007_199_254_740_993n));

    expect(decoded?.ts.getTime()).toBe(ts.getTime());
    // Beyond Number.MAX_SAFE_INTEGER, and exactly the value a JSON number would round to
    // 9007199254740992. This is why the id is text on the wire and a bigint in memory.
    expect(decoded?.id).toBe(9_007_199_254_740_993n);
  });

  it("keeps millisecond precision", () => {
    const ts = new Date("2026-08-09T10:11:12.007Z");
    // Truncating to seconds would make a keyset walk revisit every row in the same second.
    expect(decodeCursor(encodeCursor(ts, 1n))?.ts.toISOString()).toBe(ts.toISOString());
  });

  it("returns null for garbage rather than throwing", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    // Decodes cleanly as base64url, and is still not a cursor.
    expect(decodeCursor(Buffer.from("hello").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("123:abc").toString("base64url"))).toBeNull();
  });
});
