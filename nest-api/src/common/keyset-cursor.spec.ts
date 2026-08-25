import { describe, expect, it } from "vitest";
import { decodeKeysetCursor, encodeKeysetCursor } from "./keyset-cursor";

/**
 * The cursor is the only thing standing between a reader scrolling a list and a page
 * that repeats or skips rows, and it is handed to them through a URL — so both halves are
 * exercised, the round trip and the garbage.
 */

describe("issue cursor", () => {
  it("round-trips an instant and an id", () => {
    const at = Date.UTC(2026, 7, 25, 14, 3, 9, 471);
    expect(decodeKeysetCursor(encodeKeysetCursor(at, 4_211))).toEqual({ key: at, id: 4_211 });
  });

  it("round-trips a count, which is what the volume sort pages on", () => {
    expect(decodeKeysetCursor(encodeKeysetCursor(0, 7))).toEqual({ key: 0, id: 7 });
    expect(decodeKeysetCursor(encodeKeysetCursor(1_204, 7))).toEqual({ key: 1_204, id: 7 });
  });

  it("is opaque — nothing readable, nothing a caller would edit by hand", () => {
    expect(encodeKeysetCursor(1, 2)).not.toContain(":");
  });

  it("answers null for anything that will not decode", () => {
    // Every one of these is a URL somebody could arrive with, and none is worth a 400.
    expect(decodeKeysetCursor("")).toBeNull();
    expect(decodeKeysetCursor("not-a-cursor")).toBeNull();
    expect(decodeKeysetCursor(Buffer.from("123").toString("base64url"))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from("abc:4").toString("base64url"))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from("4:abc").toString("base64url"))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from("4:1.5").toString("base64url"))).toBeNull();
  });
});
