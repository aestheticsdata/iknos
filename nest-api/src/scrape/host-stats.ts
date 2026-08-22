/**
 * CPU utilisation as a delta between cumulative readings (IKN-8).
 *
 * The reading comes from /proc/stat on Linux — ks-b, the machine that matters — and falls back
 * to `os.cpus()` where /proc does not exist, so dev on macOS still exercises the same
 * arithmetic. Both reduce to one `{busy, total}` pair; the percentage is only ever computed
 * between two of them, which is why the first sample after boot is honestly `null` rather
 * than a number computed against nothing.
 */

import type os from "node:os";

/**
 * `source` matters as much as the numbers: /proc/stat counts USER_HZ jiffies, `os.cpus()`
 * counts milliseconds. A delta across the two would be a plausible-looking lie, so the pair
 * carries where it came from and `cpuPctBetween` refuses to subtract across a switch.
 */
export type CpuTimes = { busy: number; total: number; source: "proc" | "os" };

/**
 * The aggregate `cpu ` line of /proc/stat: user nice system idle iowait irq softirq steal.
 * Busy is everything but idle and iowait; guest fields are already folded into user by the
 * kernel and are not read.
 */
export function parseProcStat(text: string): CpuTimes | null {
  const line = text.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) return null;

  const fields = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (fields.length < 8 || fields.some((n) => !Number.isFinite(n))) return null;

  const [user, nice, system, idle, iowait, irq, softirq, steal] = fields;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { busy: total - idle - iowait, total, source: "proc" };
}

/** The same pair from `os.cpus()`, summed across cores. */
export function cpuTimesFromOs(cpus: os.CpuInfo[]): CpuTimes {
  let busy = 0;
  let total = 0;
  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    busy += user + nice + sys + irq;
    total += user + nice + sys + irq + idle;
  }
  return { busy, total, source: "os" };
}

/**
 * The busy share of the window between two readings, in percent — or `null` when there is no
 * window: first sample, counters that went backwards (reboot), or no elapsed time at all.
 */
export function cpuPctBetween(prev: CpuTimes | null, curr: CpuTimes): number | null {
  if (prev === null || prev.source !== curr.source) return null;

  const busyDelta = curr.busy - prev.busy;
  const totalDelta = curr.total - prev.total;
  if (totalDelta <= 0 || busyDelta < 0) return null;

  return Math.min(100, Math.max(0, (100 * busyDelta) / totalDelta));
}
