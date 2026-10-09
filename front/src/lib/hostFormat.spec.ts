import { describe, expect, it } from "vitest";
import { BADGE_TONE, badgeHint, formatHostPct, formatLoad, GAUGE_TONE } from "./hostFormat";
import { HOST_LEVEL } from "./interfaces/hostTypes";

import type { HostNow, HostReading } from "./interfaces/hostTypes";

const reading = (diskPct: number | null): HostReading => ({
  cpuPct: 12.3,
  cpuLevel: HOST_LEVEL.none,
  memory: { pct: 40, usedBytes: 4, totalBytes: 10, level: HOST_LEVEL.none },
  disk: { pct: diskPct, usedBytes: null, totalBytes: null, level: HOST_LEVEL.warning },
  load1: 0.4,
  load5: 0.3,
  load15: 0.2,
  cores: 4,
  sampledAt: "2026-10-09T12:00:00.000Z",
});

const now = (over: Partial<HostNow>): HostNow => ({
  host: "ks-b",
  reading: reading(87.25),
  level: HOST_LEVEL.warning,
  thresholds: { warnPct: 85, criticalPct: 95 },
  observedAt: "2026-10-09T12:00:01.000Z",
  meta: { tookMs: 1 },
  ...over,
});

describe("tones", () => {
  it("paints the rule's verdicts, and leaves unwatched gauges grey rather than green", () => {
    expect(GAUGE_TONE[HOST_LEVEL.ok]).toBe("ok");
    expect(GAUGE_TONE[HOST_LEVEL.warning]).toBe("warn");
    expect(GAUGE_TONE[HOST_LEVEL.critical]).toBe("error");
    expect(GAUGE_TONE[HOST_LEVEL.none]).toBe("neutral");
  });

  it("keeps the badge quiet until a line is crossed", () => {
    expect(BADGE_TONE[HOST_LEVEL.ok]).toBe("neutral");
    expect(BADGE_TONE[HOST_LEVEL.warning]).toBe("warn");
    expect(BADGE_TONE[HOST_LEVEL.critical]).toBe("error");
    expect(BADGE_TONE[HOST_LEVEL.unknown]).toBe("neutral");
  });
});

describe("formatHostPct", () => {
  it("keeps one decimal, so 84.6 never prints as a breach of 85", () => {
    expect(formatHostPct(84.6)).toBe("84.6");
    expect(formatHostPct(5)).toBe("5.0");
  });

  it("prints absence as absence, never 0.0", () => {
    expect(formatHostPct(null)).toBe("—");
  });
});

describe("formatLoad", () => {
  it("prints two decimals, as uptime does", () => {
    expect(formatLoad(0.4)).toBe("0.40");
    expect(formatLoad(12.345)).toBe("12.35");
  });
});

describe("badgeHint", () => {
  it("says the level in words, with the disk figure behind it", () => {
    expect(badgeHint(now({}), "ks-b")).toBe("ks-b · past the warning line · disk 87.3% — open the machine panel");
  });

  it("says when nothing recent was sampled", () => {
    expect(badgeHint(now({ reading: null, level: HOST_LEVEL.unknown }), "ks-b")).toBe(
      "ks-b · no recent sample — open the machine panel",
    );
    expect(badgeHint(null, "ks-b")).toBe("ks-b · no recent sample — open the machine panel");
  });
});
