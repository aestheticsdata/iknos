import type { SignalPoint } from "@contracts/service-signals";

/** The row shapes the host routes read and the grid they lay them on (IKN-25). */

/** One `host_sample` row as the `now` query returns it. Byte columns arrive as `bigint`. */
export type HostSampleRow = {
  ts: Date;
  cpuPct: number | null;
  load1: number;
  load5: number;
  load15: number;
  memUsedBytes: bigint;
  memTotalBytes: bigint;
  diskUsedBytes: bigint | null;
  diskTotalBytes: bigint | null;
};

/** One interval as the `series` query returns it. Every aggregate is `null` over an empty column. */
export type HostBucketRow = {
  bucket: bigint;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  load: number | null;
};

/** The grid the series is laid on. */
export type HostGrid = {
  from: Date;
  bucketMs: number;
  buckets: number;
};

export type HostSeriesPoints = {
  bucketMs: number;
  cpu: SignalPoint[];
  memory: SignalPoint[];
  disk: SignalPoint[];
  load: SignalPoint[];
  sampled: boolean;
};
