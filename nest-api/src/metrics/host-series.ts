import { diskLevel } from "@alerts/thresholds";
import { HOST_LEVEL, type HostGauge, type HostLevel, type HostReading } from "@contracts/host";

import type { SignalPoint } from "@contracts/service-signals";
import type { HostBucketRow, HostGrid, HostSampleRow, HostSeriesPoints } from "./interfaces/host-types";

/**
 * Everything the host routes decide about what a number means (IKN-25), kept out of the queries
 * so it can be tested against worked examples — the split `signal-series.ts` made.
 */

/** One decimal, the precision `df -h` and `htop` print a percentage at. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Two decimals, the precision `uptime` prints a load average at. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A used/total pair as a percentage, or `null` when there is none to take.
 *
 * A null or zero total is a reading `statfs` refused, never an empty disk — `null`, not 0 %.
 */
function percentOf(used: bigint | null, total: bigint | null): number | null {
  if (used === null || total === null || total === 0n) return null;
  return (Number(used) / Number(total)) * 100;
}

/**
 * A used/total pair as a gauge, levelled by `levelOf` — or `none` when no alert rule watches it.
 */
function gauge(used: bigint | null, total: bigint | null, levelOf: ((pct: number) => HostLevel) | null): HostGauge {
  const pct = percentOf(used, total);
  if (pct === null) return { pct: null, usedBytes: null, totalBytes: null, level: HOST_LEVEL.unknown };

  return {
    pct: round1(pct),
    usedBytes: Number(used),
    totalBytes: Number(total),
    // Levelled before rounding, exactly as the rule sees it: 85.04 % is past the line, and
    // rounding first would print it as a green 85.0.
    level: levelOf === null ? HOST_LEVEL.none : levelOf(pct),
  };
}

/**
 * The newest row as the panel's headline values.
 *
 * Only the disk is levelled: it is the only gauge an alert rule watches (`disk_space`, IKN-10),
 * and colouring CPU or memory on numbers no alert shares is the disagreement the ticket exists to
 * rule out.
 */
export function toReading(row: HostSampleRow, cores: number): HostReading {
  return {
    cpuPct: row.cpuPct === null ? null : round1(row.cpuPct),
    cpuLevel: row.cpuPct === null ? HOST_LEVEL.unknown : HOST_LEVEL.none,
    memory: gauge(row.memUsedBytes, row.memTotalBytes, null),
    disk: gauge(row.diskUsedBytes, row.diskTotalBytes, diskLevel),
    load1: round2(row.load1),
    load5: round2(row.load5),
    load15: round2(row.load15),
    cores,
    sampledAt: row.ts.toISOString(),
  };
}

/** Worst first — what the badge shows when two gauges disagree. */
const SEVERITY_ORDER: HostLevel[] = [HOST_LEVEL.critical, HOST_LEVEL.warning, HOST_LEVEL.ok];

/**
 * The badge's colour: the worst level any gauge reached.
 *
 * `none` and `unknown` on a single gauge do not drag the badge grey — a CPU no rule watches says
 * nothing about the machine. With no reading at all the badge is `unknown`, because a sampler that
 * has stopped is not a healthy machine.
 */
export function overallLevel(reading: HostReading | null): HostLevel {
  if (reading === null) return HOST_LEVEL.unknown;

  const levels = [reading.cpuLevel, reading.memory.level, reading.disk.level];
  return SEVERITY_ORDER.find((level) => levels.includes(level)) ?? HOST_LEVEL.none;
}

/**
 * The aggregated rows laid on the full grid, with `null` in every interval that holds no sample.
 *
 * The x-axis is always the range asked for. Raw host samples are kept for the metric retention
 * (three days by default), so the left of a `7d` chart is empty, and it must read as empty rather
 * than as a chart squeezed into the days that happen to be there.
 */
export function fillHostSeries(rows: HostBucketRow[], grid: HostGrid): HostSeriesPoints {
  const found = new Map(rows.map((row) => [Number(row.bucket), row]));
  const cpu: SignalPoint[] = [];
  const memory: SignalPoint[] = [];
  const disk: SignalPoint[] = [];
  const load: SignalPoint[] = [];

  for (let i = 0; i < grid.buckets; i++) {
    const t = new Date(+grid.from + i * grid.bucketMs).toISOString();
    const row = found.get(i);

    cpu.push({ t, v: row?.cpu == null ? null : round1(row.cpu) });
    memory.push({ t, v: row?.memory == null ? null : round1(row.memory) });
    disk.push({ t, v: row?.disk == null ? null : round1(row.disk) });
    load.push({ t, v: row?.load == null ? null : round2(row.load) });
  }

  const sampled = [cpu, memory, disk, load].some((series) => series.some((point) => point.v !== null));

  return { bucketMs: grid.bucketMs, cpu, memory, disk, load, sampled };
}
