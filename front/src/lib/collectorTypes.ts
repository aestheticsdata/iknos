/**
 * What the two collector routes return, restated — the authoritative copies are
 * `nest-api/src/contracts/collector.ts`, like every other contract in this front end.
 *
 * The rule the whole of IKN-24 turns on is in the types: **every `null` here means "I do not
 * know", and none of them mean zero.** A collector that has just started and a collector that has
 * died both have nothing to report, and the interface has to be able to tell them apart — so a
 * cold start renders a neutral pastille, never a confident `lag 0ms`.
 */

import type { Meta } from "@lib/logTypes";

/** Mirrors `contracts/collector.ts`. */
export type CollectorFile = {
  filePath: string;
  byteOffset: number;
};

/** Mirrors `contracts/collector.ts`. Sixty minute-buckets, oldest first. */
export type IngestRate = {
  perMinute: number[];
  lines: number;
  bytes: number;
};

/** Mirrors `contracts/collector.ts`. */
export type CollectorStatus = {
  lagMs: number | null;
  lastWrittenAt: string | null;
  /** The tailer's heartbeat. The only signal that says whether the collector is alive. */
  lastPollAt: string | null;
  written: number;
  dropped: number;
  degraded: number;
  queued: number;
  bytesRead: number;
  rate: IngestRate | null;
  files: CollectorFile[];
  /** The server's clock when the snapshot was taken — see `ageOfPoll`. */
  observedAt: string;
  meta: Meta;
};

/** Mirrors `contracts/collector.ts`. */
export type StorageTable = {
  name: string;
  bytes: number;
  /** `null` for a table nothing prunes — the panel's `∞`. */
  retentionDays: number | null;
};

/** Mirrors `contracts/collector.ts`. */
export type CollectorStorage = {
  tables: StorageTable[];
  totalBytes: number;
  retentionDays: number;
  oldestPartition: string | null;
  lastPurgeAt: string | null;
  purgeAt: string;
  disk: { freeBytes: number; totalBytes: number } | null;
  computedAt: string;
  meta: Meta;
};

/**
 * The four things the pastille can say.
 *
 * `unknown` is a first-class state and not an error: it is what a cold start looks like, and what
 * an unreachable API looks like. Folding it into `ok` would make a dead collector look healthy;
 * folding it into `down` would cry wolf every time the process restarts.
 */
export type CollectorHealth = "unknown" | "ok" | "warn" | "down";

/**
 * How long the heartbeat may go unstamped before the collector is presumed dead.
 *
 * The tailer polls every second, so anything past a handful of seconds is already abnormal; forty
 * five is generous enough to ride out a long GC pause or a poll blocked on a slow disk, and still
 * turns the pastille red inside the minute the ticket asks for.
 */
export const POLL_STALE_MS = 45_000;

/**
 * When lag stops being normal.
 *
 * The writer flushes every 500 ms, so healthy lag is under a second and this is twenty times that.
 * Deliberately not tighter: ks-b runs one person's side projects, a two-second stall while MySQL
 * checkpoints is not an incident, and an amber pastille that appears every few minutes is one
 * nobody looks at by the end of the week.
 */
export const LAG_WARN_MS = 10_000;

/**
 * How long lines may sit queued with nothing being written before the writer is presumed stuck.
 *
 * This catches the one failure the heartbeat alone cannot see: a tailer polling happily into a
 * writer whose every batch is failing. The queue grows, nothing lands, and `lastPollAt` stays
 * perfectly fresh — so without this the pastille would be green over a pipeline storing nothing.
 *
 * Thirty seconds against a 500 ms flush interval: long enough that an ordinary slow batch never
 * trips it, short enough to notice before the queue reaches its ceiling and starts dropping.
 */
export const WRITE_STALL_MS = 30_000;

/**
 * How stale the heartbeat is, in milliseconds, entirely without comparing two machines' clocks.
 *
 * `observedAt - lastPollAt` is server-minus-server. `now - receivedAt` is browser-minus-browser.
 * Neither subtraction crosses machines, so a laptop whose clock is a minute off still ages the
 * heartbeat correctly — which matters, because that skew is otherwise indistinguishable from the
 * collector having stopped.
 */
export const ageOfPoll = (status: CollectorStatus, receivedAt: number, now: number): number | null => {
  if (status.lastPollAt === null) return null;

  const atSnapshot = Date.parse(status.observedAt) - Date.parse(status.lastPollAt);
  if (Number.isNaN(atSnapshot)) return null;

  return Math.max(0, atSnapshot) + Math.max(0, now - receivedAt);
};

/**
 * The pastille's state.
 *
 * Ordered by what it would be negligent to hide: a collector that has stopped outranks a lag
 * reading, because a stale lag can look perfectly healthy — it is simply the last value measured
 * before everything stopped, frozen in place.
 *
 * **Dropped lines deliberately do not colour this.** The counter is cumulative from process start,
 * so a single burst at four in the morning would leave the pastille amber for days — and chrome
 * that has been amber for days is chrome nobody reads. The number is shown in the ingest card,
 * where it is a fact rather than an alarm.
 */
export const healthOf = (status: CollectorStatus | null, receivedAt: number, now: number): CollectorHealth => {
  if (status === null) return "unknown";

  const age = ageOfPoll(status, receivedAt, now);
  // No pass has ever completed: the process is up but the collector has not got going yet.
  if (age === null) return "unknown";
  if (age > POLL_STALE_MS) return "down";

  if (isWriteStalled(status)) return "warn";
  if (status.lagMs !== null && status.lagMs > LAG_WARN_MS) return "warn";
  return "ok";
};

/**
 * Lines waiting, and nothing being written.
 *
 * A queue on its own is normal — it is where every line spends its first half-second. What is not
 * normal is a queue that has been non-empty while no batch has committed, which is what a database
 * outage looks like from here: the tailer keeps reading, the writer keeps failing and retrying, and
 * every other signal on this route stays reassuring.
 *
 * Both timestamps are the server's, so the subtraction never crosses machines.
 */
const isWriteStalled = (status: CollectorStatus): boolean => {
  if (status.queued === 0) return false;
  if (status.lastWrittenAt === null) return true;

  const since = Date.parse(status.observedAt) - Date.parse(status.lastWrittenAt);
  return !Number.isNaN(since) && since > WRITE_STALL_MS;
};

/** The tone each state paints in. `unknown` is grey on purpose — it is not a warning. */
export const HEALTH_TONE: Record<CollectorHealth, "ok" | "warn" | "error" | "neutral"> = {
  unknown: "neutral",
  ok: "ok",
  warn: "warn",
  down: "error",
};
