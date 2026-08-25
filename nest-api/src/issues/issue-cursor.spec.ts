import { describe, expect, it } from "vitest";
import { decodeIssueCursor, encodeIssueCursor } from "./issue-cursor";

/**
 * The cursor is the only thing standing between a reader scrolling the issues list and a page
 * that repeats or skips rows, and it is handed to them through a URL — so both halves are
 * exercised, the round trip and the garbage.
 */

describe("issue cursor", () => {
  it("round-trips an instant and an id", () => {
    const at = Date.UTC(2026, 7, 25, 14, 3, 9, 471);
    expect(decodeIssueCursor(encodeIssueCursor(at, 4_211))).toEqual({ key: at, id: 4_211 });
  });

  it("round-trips a count, which is what the volume sort pages on", () => {
    expect(decodeIssueCursor(encodeIssueCursor(0, 7))).toEqual({ key: 0, id: 7 });
    expect(decodeIssueCursor(encodeIssueCursor(1_204, 7))).toEqual({ key: 1_204, id: 7 });
  });

  it("is opaque — nothing readable, nothing a caller would edit by hand", () => {
    expect(encodeIssueCursor(1, 2)).not.toContain(":");
  });

  it("answers null for anything that will not decode", () => {
    // Every one of these is a URL somebody could arrive with, and none is worth a 400.
    expect(decodeIssueCursor("")).toBeNull();
    expect(decodeIssueCursor("not-a-cursor")).toBeNull();
    expect(decodeIssueCursor(Buffer.from("123").toString("base64url"))).toBeNull();
    expect(decodeIssueCursor(Buffer.from("abc:4").toString("base64url"))).toBeNull();
    expect(decodeIssueCursor(Buffer.from("4:abc").toString("base64url"))).toBeNull();
    expect(decodeIssueCursor(Buffer.from("4:1.5").toString("base64url"))).toBeNull();
  });
});
