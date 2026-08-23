import type { Meta } from "./meta";

/**
 * The half of the service view that is true *now* rather than over a range (IKN-13): the header's
 * identity chips, the health pills, and the fourth signal tile's gauges.
 *
 * It is a separate route from `service-signals.ts` because it answers a different question and
 * ages on a different clock. The signals are "what happened over the window you picked"; this is
 * "what is the case at this instant", and re-reading it does not depend on the range selector at
 * all. One route for both would either re-run three `GROUP BY`s every time the pills refreshed, or
 * leave the pills as stale as the widest chart on screen.
 *
 * **Every `null` here means "I do not know", never "zero"** — the rule IKN-24 established for the
 * collector and the one this whole view turns on. A service nobody scrapes and a service whose
 * heap is genuinely empty are not the same fact, and the tiles say so in words rather than drawing
 * a confident `0 MB`.
 */

/**
 * One dependency as the probed service described it — the `mysql 3ms` / `redis 1ms` pills.
 *
 * `name` is the key the service used in its own `/health` body, untranslated. PFA calls its
 * database `db`; the mockup draws `mysql`. Renaming it here would be Iknos asserting which engine
 * is behind a word only the service knows the truth of — and the day a service reports `postgres`
 * the pill would still say `mysql`. What the service calls it is what the pill calls it.
 *
 * `status` is likewise the service's own vocabulary rather than a normalised enum: IKN-2 sends
 * `"ok"`, and a service that sends `"degraded"` should be able to say so without Iknos folding it
 * into a boolean it did not mean.
 */
export type ProbeCheck = {
  name: string;
  status: string;
  /** `null` when the body named the dependency but gave no timing for it. */
  latencyMs: number | null;
};

/**
 * The last probe, and whether it is recent enough to still mean anything.
 *
 * `stale` is a state of its own for exactly the reason the rail's dot has one (IKN-8): a green
 * pill has to be earned by a recent answer, and a probe that stopped arriving is a different fact
 * from one that answered 503. The staleness threshold is shared with the rail — one definition, so
 * a rail dot and a pill cannot disagree about the same probe.
 */
export type ProbeSummary = {
  status: "ok" | "error" | "stale";
  /** The HTTP status the probe got, or `null` when nothing answered at all. */
  httpStatus: number | null;
  latencyMs: number | null;
  /** The transport failure, when there was no response to read a status from. */
  error: string | null;
  /** ISO-8601 UTC. */
  checkedAt: string;
  /** Empty when the body carried no per-dependency breakdown — not `null`, because the array *is* the breakdown. */
  checks: ProbeCheck[];
};

/**
 * The PM2 facts behind the header chips, as `pm2 jlist` last reported them (IKN-8).
 *
 * `startedAt` rather than a computed uptime, deliberately: the reading does not age, so the
 * arithmetic happens at display time and a payload cached for thirty seconds does not quietly
 * claim the process started thirty seconds later than it did.
 */
export type ProcessFacts = {
  pm2Id: number | null;
  /** PM2's own word — `online`, `stopped`, `errored`. */
  status: string;
  /** The chip that turns red above zero: the one member of the header that is a symptom. */
  restarts: number;
  nodeVersion: string | null;
  /** ISO-8601 UTC, or `null` for a process PM2 reported without one. */
  startedAt: string | null;
  /** When the `pm2 jlist` reading was taken. */
  observedAt: string;
};

/**
 * The database pool, as the service exposes it (`db_pool_connections{state}`).
 *
 * Three counts and no ceiling, because the exporter publishes no ceiling: the pool's size is
 * `active + idle`, and saturation is `idle === 0` with someone `waiting`. That is a stronger
 * statement than a percentage of a configured maximum — a pool can be full and perfectly healthy
 * so long as nothing is queued behind it, and it is the queue that turns the route into 500s.
 */
export type PoolGauge = {
  active: number;
  idle: number;
  waiting: number;
};

/**
 * The fourth tile's gauges, from the newest scrape inside the freshness window.
 *
 * Every field is independently nullable because they come from independent series: a service may
 * export heap and no pool, or a pool and no event-loop lag. Folding them into one nullable object
 * would hide three-quarters of a tile because one exporter was missing.
 *
 * `eventLoopLagMs` is the **p99**, not the mean. A mean lag is flat and reassuring precisely
 * through the stalls the tile exists to show; the p99 is the number that moves when a synchronous
 * block is holding the loop, which is the only reason anyone looks at this row.
 */
export type NodeRuntime = {
  heapUsedBytes: number | null;
  heapTotalBytes: number | null;
  eventLoopLagMs: number | null;
  pool: PoolGauge | null;
  /** When the scrape these values came from happened. `null` when none of them was found. */
  observedAt: string | null;
};

export type ServiceRuntime = {
  service: string;
  pm2Name: string;
  /**
   * Whether the registry row carries a `metricsUrl` at all.
   *
   * This is what separates "this service exposes no `/metrics`" from "it does, and nothing has
   * landed in the window" — two empty tiles that need two different sentences under them. Only the
   * first is a permanent state of the world; the second is a collector to go and look at.
   */
  scraped: boolean;
  /** The same distinction for `healthUrl`: no pills at all, versus pills that have gone quiet. */
  probed: boolean;
  /**
   * The release marker, as the service reports it at `/health`.
   *
   * `null` today for every service on the box, because no deploy writes one yet. The chip renders
   * `—` rather than disappearing: the header's geometry must not change on the day this starts
   * working (design doc §8.7).
   */
  release: string | null;
  /** `null` when PM2 has said nothing about this process inside the window. */
  process: ProcessFacts | null;
  /** `null` when the service has never been probed, or not inside the window. */
  probe: ProbeSummary | null;
  /** Always present; its fields carry the absences. `null` only when the service is not scraped. */
  runtime: NodeRuntime | null;
  /** The server's clock when this snapshot was taken — the anchor for ageing the readings above. */
  observedAt: string;
  meta: Meta;
};
