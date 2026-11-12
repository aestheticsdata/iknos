import { describe, expect, it } from "vitest";
import { REDACTED, redactQuery, redactUrl } from "./redact-query";

/** IKN-87: the beacon's `?token=` must never be stored by the pipeline it writes into. */
describe("redactQuery", () => {
  it("replaces the token's value and leaves its neighbours byte for byte", () => {
    expect(redactQuery("a=1&token=ikt_secret&b=x%20y")).toBe(`a=1&token=${REDACTED}&b=x%20y`);
  });

  it("matches the key however it was spelled or encoded", () => {
    expect(redactQuery("TOKEN=abc")).toBe(`TOKEN=${REDACTED}`);
    expect(redactQuery("%74oken=abc")).toBe(`%74oken=${REDACTED}`);
  });

  it("redacts every occurrence, not just the first", () => {
    expect(redactQuery("token=a&token=b")).toBe(`token=${REDACTED}&token=${REDACTED}`);
  });

  it("leaves keys that merely contain the word alone", () => {
    expect(redactQuery("csrf_token_hint=1&tokens=2")).toBe("csrf_token_hint=1&tokens=2");
  });

  it("does not throw on a key that is not valid percent-encoding", () => {
    expect(redactQuery("%E0%A4%A=1&token=s")).toBe(`%E0%A4%A=1&token=${REDACTED}`);
  });

  it("returns an empty or valueless query unchanged", () => {
    expect(redactQuery("")).toBe("");
    expect(redactQuery("token")).toBe("token");
  });
});

describe("redactUrl", () => {
  it("redacts the query of a request target and keeps the path", () => {
    expect(redactUrl("/api/otlp/v1/traces?token=ikt_x")).toBe(`/api/otlp/v1/traces?token=${REDACTED}`);
  });

  it("returns a URL without a query unchanged", () => {
    expect(redactUrl("/api/logs")).toBe("/api/logs");
  });
});
