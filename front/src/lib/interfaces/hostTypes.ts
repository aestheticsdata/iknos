/**
 * What the two host routes return, restated — the authoritative copy is
 * `nest-api/src/contracts/host.ts`, like every other contract in this front end (IKN-25).
 *
 * **Every `null` means "I do not know", never zero.** A refused `statfs`, the first CPU reading
 * after a restart, and a sampler that has stopped are none of them a machine at 0 %.
 */

import type { Meta } from "@lib/logTypes";
import type { SignalPoint } from "@lib/serviceTypes";

/**
 * Mirrors `contracts/host.ts`. `none` is a gauge no alert rule watches — CPU and memory today —
 * and it is drawn neutral rather than green: green would claim a threshold was checked.
 */
export const HOST_LEVEL = {
  ok: "ok",
  warning: "warning",
  critical: "critical",
  none: "none",
  unknown: "unknown",
} as const;

export type HostLevel = (typeof HOST_LEVEL)[keyof typeof HOST_LEVEL];

/** Mirrors `contracts/host.ts`. The disk alert rule's own lines, carried with every reading. */
export type HostThresholds = {
  warnPct: number;
  criticalPct: number;
};

/** Mirrors `contracts/host.ts`. */
export type HostGauge = {
  pct: number | null;
  usedBytes: number | null;
  totalBytes: number | null;
  level: HostLevel;
};

/** Mirrors `contracts/host.ts`. */
export type HostReading = {
  cpuPct: number | null;
  cpuLevel: HostLevel;
  memory: HostGauge;
  disk: HostGauge;
  load1: number;
  load5: number;
  load15: number;
  cores: number;
  sampledAt: string;
};

/** Mirrors `contracts/host.ts`. */
export type HostNow = {
  host: string;
  reading: HostReading | null;
  level: HostLevel;
  thresholds: HostThresholds;
  observedAt: string;
  meta: Meta;
};

/** Mirrors `contracts/host.ts`. */
export type HostSeries = {
  host: string;
  from: string;
  to: string;
  bucketMs: number;
  cpu: SignalPoint[];
  memory: SignalPoint[];
  disk: SignalPoint[];
  load: SignalPoint[];
  sampled: boolean;
  thresholds: HostThresholds;
  meta: Meta;
};
