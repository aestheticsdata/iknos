import { describe, expect, it } from "vitest";
import { boundsFor } from "./timeRange";

const NOW = new Date("2026-08-24T10:00:00.000Z");

describe("boundsFor", () => {
  it("ends exactly at the instant it is given", () => {
    expect(boundsFor("1h", NOW).to).toBe(NOW.toISOString());
  });

  it("scales `from` with the range key", () => {
    expect(boundsFor("15m", NOW).from).toBe("2026-08-24T09:45:00.000Z");
    expect(boundsFor("1h", NOW).from).toBe("2026-08-24T09:00:00.000Z");
    expect(boundsFor("24h", NOW).from).toBe("2026-08-23T10:00:00.000Z");
    expect(boundsFor("7d", NOW).from).toBe("2026-08-17T10:00:00.000Z");
  });
});
