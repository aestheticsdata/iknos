import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@alerts/thresholds";
import { HOST_LEVEL } from "@contracts/host";
import { describe, expect, it } from "vitest";
import { fillHostSeries, overallLevel, toReading } from "./host-series";

import type { HostSampleRow } from "./interfaces/host-types";

/**
 * The machine panel's numbers (IKN-25).
 *
 * The failures worth catching are the ones that would make the panel disagree with the alert or
 * with the box: a disk coloured green at the very percentage the rule fires on, a refused `statfs`
 * drawn as an empty disk, and a week chart squeezed into the three days that are still kept.
 */

const GiB = 1024n ** 3n;

const sample = (over: Partial<HostSampleRow> = {}): HostSampleRow => ({
  ts: new Date("2026-10-09T12:00:00.000Z"),
  cpuPct: 12.345,
  load1: 0.4567,
  load5: 0.3,
  load15: 0.2,
  memUsedBytes: 3n * GiB,
  memTotalBytes: 8n * GiB,
  diskUsedBytes: 40n * GiB,
  diskTotalBytes: 100n * GiB,
  ...over,
});

/** Bytes for a disk at exactly `pct` of a 1 000 000-byte volume. */
const diskAt = (pct: number) => ({ diskUsedBytes: BigInt(Math.round(pct * 10_000)), diskTotalBytes: 1_000_000n });

describe("toReading", () => {
  it("reports percentages to one decimal and loads to two, the precision htop and uptime print", () => {
    const reading = toReading(sample(), 4);

    expect(reading.cpuPct).toBe(12.3);
    expect(reading.memory.pct).toBe(37.5);
    expect(reading.disk.pct).toBe(40);
    expect(reading.load1).toBe(0.46);
    expect(reading.cores).toBe(4);
    expect(reading.sampledAt).toBe("2026-10-09T12:00:00.000Z");
  });

  it("levels the disk on the rule's own lines, and not at them", () => {
    // The rule tests `>`: at exactly 85 % it is not pending, so neither is the bar.
    expect(toReading(sample(diskAt(DISK_WARN_PCT)), 4).disk.level).toBe(HOST_LEVEL.ok);
    expect(toReading(sample(diskAt(DISK_WARN_PCT + 0.1)), 4).disk.level).toBe(HOST_LEVEL.warning);
    expect(toReading(sample(diskAt(DISK_CRITICAL_PCT)), 4).disk.level).toBe(HOST_LEVEL.warning);
    expect(toReading(sample(diskAt(DISK_CRITICAL_PCT + 0.1)), 4).disk.level).toBe(HOST_LEVEL.critical);
  });

  it("levels before rounding, so 85.04 % is amber even though it prints as 85.0", () => {
    const reading = toReading(sample(diskAt(85.04)), 4);

    expect(reading.disk.pct).toBe(85);
    expect(reading.disk.level).toBe(HOST_LEVEL.warning);
  });

  it("leaves CPU and memory unlevelled — no alert rule watches them", () => {
    const reading = toReading(sample({ cpuPct: 99, memUsedBytes: 8n * GiB }), 4);

    expect(reading.cpuLevel).toBe(HOST_LEVEL.none);
    expect(reading.memory.level).toBe(HOST_LEVEL.none);
  });

  it("reads a refused statfs as unknown, never as an empty disk", () => {
    const reading = toReading(sample({ diskUsedBytes: null, diskTotalBytes: null }), 4);

    expect(reading.disk).toEqual({ pct: null, usedBytes: null, totalBytes: null, level: HOST_LEVEL.unknown });
  });

  it("reads a zero-byte total as unknown rather than dividing by it", () => {
    expect(toReading(sample({ diskTotalBytes: 0n }), 4).disk.pct).toBeNull();
  });

  it("keeps the first CPU reading after a restart as unknown", () => {
    const reading = toReading(sample({ cpuPct: null }), 4);

    expect(reading.cpuPct).toBeNull();
    expect(reading.cpuLevel).toBe(HOST_LEVEL.unknown);
  });
});

describe("overallLevel", () => {
  it("is unknown with no reading — a stopped sampler is not a healthy machine", () => {
    expect(overallLevel(null)).toBe(HOST_LEVEL.unknown);
  });

  it("follows the disk", () => {
    expect(overallLevel(toReading(sample(), 4))).toBe(HOST_LEVEL.ok);
    expect(overallLevel(toReading(sample(diskAt(90)), 4))).toBe(HOST_LEVEL.warning);
    expect(overallLevel(toReading(sample(diskAt(97)), 4))).toBe(HOST_LEVEL.critical);
  });

  it("is not dragged grey by an unread CPU when the disk is fine", () => {
    expect(overallLevel(toReading(sample({ cpuPct: null }), 4))).toBe(HOST_LEVEL.ok);
  });

  it("is none when nothing watched could be read", () => {
    expect(overallLevel(toReading(sample({ diskUsedBytes: null }), 4))).toBe(HOST_LEVEL.none);
  });
});

describe("fillHostSeries", () => {
  const from = new Date("2026-10-09T12:00:00.000Z");
  const grid = { from, bucketMs: 60_000, buckets: 4 };

  it("lays the rows on the full grid, with null where nothing was sampled", () => {
    const series = fillHostSeries([{ bucket: 2n, cpu: 10.04, memory: 50, disk: 40.06, load: 0.123 }], grid);

    expect(series.cpu.map((p) => p.v)).toEqual([null, null, 10, null]);
    expect(series.disk.map((p) => p.v)).toEqual([null, null, 40.1, null]);
    expect(series.load.map((p) => p.v)).toEqual([null, null, 0.12, null]);
    expect(series.cpu.map((p) => p.t)).toEqual([
      "2026-10-09T12:00:00.000Z",
      "2026-10-09T12:01:00.000Z",
      "2026-10-09T12:02:00.000Z",
      "2026-10-09T12:03:00.000Z",
    ]);
    expect(series.sampled).toBe(true);
    expect(series.bucketMs).toBe(60_000);
  });

  it("keeps a null aggregate null — an interval of refused statfs is not 0 %", () => {
    const series = fillHostSeries([{ bucket: 0n, cpu: null, memory: 20, disk: null, load: 0.1 }], grid);

    expect(series.cpu[0].v).toBeNull();
    expect(series.disk[0].v).toBeNull();
    expect(series.memory[0].v).toBe(20);
  });

  it("says when the range holds no sample at all", () => {
    const series = fillHostSeries([], grid);

    expect(series.sampled).toBe(false);
    expect(series.cpu).toHaveLength(4);
  });
});
