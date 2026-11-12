import { describe, expect, it } from "vitest";
import { hashToken, issueToken, looksLikeToken, normalizeOrigin, originAllowed, readOrigins } from "./token";

describe("issueToken", () => {
  it("returns a prefixed random token and its SHA-256, never the same twice", () => {
    const a = issueToken();
    const b = issueToken();

    expect(a.clear).toMatch(/^ikt_[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toBe(hashToken(a.clear));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.clear).not.toBe(b.clear);
  });

  it("stores nothing that contains the clear token", () => {
    const { clear, hash } = issueToken();
    expect(hash).not.toContain(clear.slice(4, 20));
  });
});

describe("looksLikeToken", () => {
  it("accepts what issueToken makes and nothing of another shape", () => {
    expect(looksLikeToken(issueToken().clear)).toBe(true);
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("Bearer abc")).toBe(false);
    expect(looksLikeToken(`ikt_${"a".repeat(500)}`)).toBe(false);
  });
});

describe("origins", () => {
  it("normalises an origin and refuses anything a browser would never send", () => {
    expect(normalizeOrigin(" https://Opifex.1991computer.com ")).toBe("https://opifex.1991computer.com");
    expect(normalizeOrigin("http://localhost:4600")).toBe("http://localhost:4600");
    expect(normalizeOrigin("https://opifex.1991computer.com/")).toBeNull();
    expect(normalizeOrigin("https://opifex.1991computer.com/app")).toBeNull();
    expect(normalizeOrigin("opifex.1991computer.com")).toBeNull();
    expect(normalizeOrigin("*")).toBeNull();
  });

  it("reads only well-formed origins back out of the JSON column", () => {
    expect(readOrigins(["https://a.test", 3, "nope", "https://B.test"])).toEqual(["https://a.test", "https://b.test"]);
    expect(readOrigins(null)).toEqual([]);
    expect(readOrigins("https://a.test")).toEqual([]);
  });

  it("allows a listed origin, refuses another, and lets a caller with no origin through", () => {
    const allowed = ["https://opifex.1991computer.com"];
    expect(originAllowed("https://opifex.1991computer.com", allowed)).toBe(true);
    expect(originAllowed("https://vidar.1991computer.com", allowed)).toBe(false);
    expect(originAllowed("null", allowed)).toBe(false);
    expect(originAllowed(undefined, allowed)).toBe(true);
  });
});
