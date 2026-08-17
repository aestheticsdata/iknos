import { describe, expect, it } from "vitest";
import { timingSafeCompare } from "./timing-safe";

describe("timingSafeCompare", () => {
  it("accepts an exact match", () => {
    expect(timingSafeCompare("s3cret-token-value", "s3cret-token-value")).toBe(true);
  });

  it("rejects a value differing by one byte", () => {
    // Same length, so the comparison is the length check's job to pass and the bytes' to fail.
    expect(timingSafeCompare("s3cret-token-value", "s3cret-token-valuE")).toBe(false);
  });

  it("rejects a different length without throwing", () => {
    // `timingSafeEqual` throws on mismatched lengths — a guard that is easy to forget and turns
    // a wrong password into a 500.
    expect(() => timingSafeCompare("short", "considerably longer")).not.toThrow();
    expect(timingSafeCompare("short", "considerably longer")).toBe(false);
  });

  it("refuses two empty strings", () => {
    // The case that matters: a server with nothing configured must not accept a caller
    // presenting nothing.
    expect(timingSafeCompare("", "")).toBe(false);
    expect(timingSafeCompare("expected", "")).toBe(false);
    expect(timingSafeCompare("", "provided")).toBe(false);
  });
});
