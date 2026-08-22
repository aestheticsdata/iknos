import { describe, expect, it } from "vitest";
import { cpuPctBetween, cpuTimesFromOs, parseProcStat } from "./host-stats";

/**
 * CPU is a delta between two cumulative readings (IKN-8) — the arithmetic ends up in
 * `host_sample.cpu_pct`, so it is tested pure, without a /proc or a clock. The reading comes
 * from /proc/stat on Linux (ks-b) and falls back to os.cpus() where /proc does not exist (dev
 * on macOS); both reduce to the same {busy, total} pair.
 */
describe("parseProcStat", () => {
  it("reads the aggregate cpu line: busy excludes idle and iowait", () => {
    const text = ["cpu  100 20 50 800 30 5 5 10 0 0", "cpu0 50 10 25 400 15 2 2 5 0 0", "intr 12345"].join("\n");

    // total = user+nice+system+idle+iowait+irq+softirq+steal = 1020; idle-ish = 800+30
    expect(parseProcStat(text)).toEqual({ busy: 190, total: 1020, source: "proc" });
  });

  it("returns null when the cpu line is absent or malformed", () => {
    expect(parseProcStat("intr 12345\nctxt 999")).toBeNull();
    expect(parseProcStat("cpu  abc def")).toBeNull();
    expect(parseProcStat("")).toBeNull();
  });
});

describe("cpuTimesFromOs", () => {
  it("sums busy and total across cores", () => {
    const cpus = [
      { times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 10 } },
      { times: { user: 200, nice: 20, sys: 30, idle: 700, irq: 0 } },
    ] as never;

    expect(cpuTimesFromOs(cpus)).toEqual({ busy: 410, total: 1910, source: "os" });
  });
});

describe("cpuPctBetween", () => {
  it("computes the busy share of the elapsed window", () => {
    const prev = { busy: 100, total: 1000, source: "proc" } as const;
    const curr = { busy: 150, total: 1200, source: "proc" } as const;

    expect(cpuPctBetween(prev, curr)).toBe(25);
  });

  it("is null on the first sample — no window exists yet", () => {
    expect(cpuPctBetween(null, { busy: 10, total: 100, source: "proc" })).toBeNull();
  });

  it("is null when the counters went backwards, as after a reboot", () => {
    expect(
      cpuPctBetween({ busy: 500, total: 5000, source: "proc" }, { busy: 10, total: 100, source: "proc" }),
    ).toBeNull();
  });

  it("is null when no time elapsed between readings", () => {
    const same = { busy: 100, total: 1000, source: "os" } as const;
    expect(cpuPctBetween(same, { ...same })).toBeNull();
  });

  it("clamps to the 0..100 range against rounding drift", () => {
    expect(cpuPctBetween({ busy: 0, total: 100, source: "os" }, { busy: 110, total: 200, source: "os" })).toBe(100);
  });

  it("is null across a source switch — jiffies and milliseconds must never be subtracted", () => {
    // A transient /proc/stat failure falls back to os.cpus(): different unit, different base.
    // Comparing across the switch would store a plausible-looking, meaningless percentage.
    expect(
      cpuPctBetween({ busy: 100, total: 1000, source: "proc" }, { busy: 5000, total: 90000, source: "os" }),
    ).toBeNull();
  });
});
