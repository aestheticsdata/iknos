import type { Meta } from "./meta";

/**
 * The dot on a rail row: the last probe of the service's health endpoint (IKN-8).
 *
 * `stale` is its own state, not a variant of ok: a green dot must be earned by a recent answer,
 * and a probe that stopped answering is a different fact from one that answered 503. The bands:
 * a probe within 90 s is current (`ok`/`error`), older than that it is `stale`, and past a full
 * day of silence the service's `health` goes back to null — "unwatched", not an ever-older
 * amber. A stalled collector therefore shows a rail full of stale dots, never a rail that
 * pretends nothing was ever probed.
 */
export type ServiceHealth = {
  status: "ok" | "error" | "stale";
  /** The HTTP status the probe got, or null when nothing answered at all. */
  httpStatus: number | null;
  latencyMs: number | null;
  /** When the probe ran, ISO — the client ages it against its own clock at its peril; prefer status. */
  checkedAt: string;
  /** Per-dependency breakdown as the service reported it (IKN-2 shape), when the body carried one. */
  checks: Record<string, { status: string; latencyMs: number }> | null;
};

/**
 * A monitored application, as the filter list and the service rail see it.
 *
 * `health` is null for a service that has never been probed — no `healthUrl`, or no probe row
 * yet. Null, not a zeroed object: the rail omits what it does not know rather than drawing a
 * flat green dot for a service nobody has ever probed (IKN-8).
 *
 * `sparkline` is log lines per minute over the last hour, oldest first, sixty slots. Zeros are
 * a true statement about an idle service, which is why this one is never null.
 */
export type Service = {
  /** What the interface calls it. */
  name: string;
  /** What PM2 calls it — the two are allowed to differ. */
  pm2Name: string;
  enabled: boolean;
  health: ServiceHealth | null;
  sparkline: number[];
};

/** Wrapped rather than a bare array, so that every list response in the API carries a `meta`. */
export type ServiceList = {
  services: Service[];
  meta: Meta;
};
