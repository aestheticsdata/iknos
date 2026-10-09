import type { Meta } from "./meta";
import type { SignalPoint } from "./service-signals";

/**
 * The machine behind the `ks-b` badge (IKN-25): CPU, memory, disk and load, read back from
 * `host_sample`.
 *
 * Two routes, on two clocks — the split the collector made (IKN-24) and for the same reason. `now`
 * is permanent chrome: the badge polls it all day, so it is one indexed row and nothing else.
 * `series` is a `GROUP BY` over the range the top bar is showing, and is only asked for while the
 * panel is open.
 *
 * **Every `null` means "I do not know", never zero** — the rule IKN-24 set. `statfs` can refuse,
 * the first CPU reading after a restart has no previous one to difference against, and a sampler
 * that has stopped leaves no recent row at all. None of those is a machine at 0 %.
 */

/**
 * What a reading means against the alert rules' thresholds.
 *
 * `none` is a metric no alert rule watches — CPU and memory today. It is not `ok`: a green bar
 * would claim a threshold was checked when none exists, and the day the alert engine grows a CPU
 * rule the bar starts colouring without the front changing.
 */
export const HOST_LEVEL = {
  ok: "ok",
  warning: "warning",
  critical: "critical",
  none: "none",
  unknown: "unknown",
} as const;

export type HostLevel = (typeof HOST_LEVEL)[keyof typeof HOST_LEVEL];

/**
 * The alert rule's lines, carried rather than restated — spec D3's shape, the one `AlertRow`
 * already uses. The front is a separate pnpm root and cannot import `thresholds.ts`; a threshold
 * that travels with the reading is the only way the bar and the alert cannot disagree.
 */
export type HostThresholds = {
  warnPct: number;
  criticalPct: number;
};

/** One gauge as the panel draws it: a percentage, the bytes behind it, and its level. */
export type HostGauge = {
  /** 0–100, one decimal. */
  pct: number | null;
  usedBytes: number | null;
  totalBytes: number | null;
  level: HostLevel;
};

/** The newest `host_sample` row inside the freshness window. */
export type HostReading = {
  /** 0–100. `null` on the first sample after a restart. */
  cpuPct: number | null;
  /** `none` while no alert rule watches CPU; `unknown` when `cpuPct` is `null`. */
  cpuLevel: HostLevel;
  memory: HostGauge;
  disk: HostGauge;
  load1: number;
  load5: number;
  load15: number;
  /** Logical cores — the scale a load average is read against. */
  cores: number;
  /** When the sample was taken, ISO-8601 UTC. */
  sampledAt: string;
};

export type HostNow = {
  host: string;
  /** `null` when the sampler has written nothing inside the freshness window. */
  reading: HostReading | null;
  /** The worst level among the gauges — the badge's colour. `unknown` when `reading` is `null`. */
  level: HostLevel;
  /** The disk rule's lines. */
  thresholds: HostThresholds;
  /** The server's clock when this was read. */
  observedAt: string;
  meta: Meta;
};

export type HostSeries = {
  host: string;
  from: string;
  to: string;
  bucketMs: number;
  /** Mean CPU over each interval. */
  cpu: SignalPoint[];
  /** Mean memory use over each interval, percent. */
  memory: SignalPoint[];
  /** **Peak** disk use over each interval, percent — a disk that touched 96 % did touch it. */
  disk: SignalPoint[];
  /** Mean one-minute load over each interval. */
  load: SignalPoint[];
  /** Whether any interval holds a sample at all — the panel's empty state. */
  sampled: boolean;
  /** The disk rule's lines, drawn across the disk chart. */
  thresholds: HostThresholds;
  meta: Meta;
};
