import { describe, expect, it } from "vitest";
import { verifyCsrf } from "./csrf.util";

describe("verifyCsrf", () => {
  it("accepts the matching token", () => {
    expect(verifyCsrf("abc123", "abc123")).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    expect(verifyCsrf("abc123", "abc124")).toBe(false);
  });

  it("rejects a prefix", () => {
    // timingSafeEqual throws outright on a length mismatch, so this case has to be handled
    // before it — and the obvious handling, comparing lengths and returning early, is correct
    // here only because the token length is fixed and public.
    expect(verifyCsrf("abc123", "abc")).toBe(false);
  });

  it("rejects empty tokens, including two of them", () => {
    expect(verifyCsrf("abc123", "")).toBe(false);
    expect(verifyCsrf("", "abc123")).toBe(false);
    // The one that matters: a session holding no token must never let a tokenless request
    // through on the grounds that the two are equal.
    expect(verifyCsrf("", "")).toBe(false);
  });
});
