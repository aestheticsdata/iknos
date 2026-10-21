import { describe, expect, it } from "vitest";
import { RECONNECT_CEILING_MS, reconnectDelay } from "./reconnectDelay";

describe("reconnectDelay", () => {
  it("starts at one second", () => {
    expect(reconnectDelay(0)).toBe(1000);
  });

  it("doubles with each failed attempt", () => {
    expect([1, 2, 3, 4].map(reconnectDelay)).toEqual([2000, 4000, 8000, 16_000]);
  });

  /**
   * The ceiling is the point (IKN-79): a tail refused by nginx's connection cap has to keep asking,
   * because the slot frees on its own, but not so often that the retries are what holds the cap full.
   */
  it("stops growing at the ceiling, however long the outage", () => {
    expect(reconnectDelay(5)).toBe(RECONNECT_CEILING_MS);
    expect(reconnectDelay(500)).toBe(RECONNECT_CEILING_MS);
  });
});
