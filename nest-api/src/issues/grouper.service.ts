import { readJsonColumn } from "@common/json-column";
import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { coalesce } from "./coalesce";
import { ERROR_LEVEL, errorFieldsOf, isGroupable } from "./error-fields";
import { EventCap } from "./event-cap";
import { culpritOf, fingerprintOf, normaliseFrames } from "./fingerprint";

import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { GroupableRow } from "./coalesce";

/**
 * The grouper (IKN-9): committed error rows in, `issue` and `issue_event` out.
 *
 * **Why this is a pass over the table and not a hook in the ingest path.** The obvious design
 * fingerprints each record as the writer commits it. It cannot work, for four reasons that only
 * showed up against the real code: `Writer` holds a persist-only closure and has no database
 * handle; its post-commit loop is unguarded, so an upsert that threw would escape `flush()` after
 * the queue counters had already moved; `flushSafely` has no reentrancy latch, so a slow pass
 * would stack on the 500 ms interval; and — the one that decides it — an uninstrumented app's
 * exception arrives as a dozen separate rows, which can only be rejoined by something that sees
 * them together. That is `coalesce`, and it needs the rows committed and ordered.
 *
 * So: a latched interval, the same lifecycle shape as `ScrapeService` and `IngestService`, off
 * the ingest hot path entirely. An error becomes an issue a few seconds late, which for a tool
 * with one reader who is not watching in real time costs nothing.
 */

/** How often the pass runs. */
export const GROUP_INTERVAL_MS = 15_000;

/**
 * How far behind `now` the pass stops reading.
 *
 * The high-water mark only advances monotonically if nothing can still be written *behind* it.
 * Rows reach `log_entry` in batches up to half a second apart, from files polled every second,
 * carrying timestamps the app itself stamped — so "committed" and "recent" are not the same
 * instant. Reading only what has settled makes the watermark exact and removes the alternative,
 * which is a grace window that re-reads and therefore double-counts on every restart.
 *
 * An undercount of one occurrence is a silent, bounded, one-off error. A double count compounds
 * and is on screen. This picks the first.
 */
export const SETTLE_MS = 30_000;

/** Rows per pass. At 15 s this is ~130 error lines a second sustained, far past ks-b's worst. */
export const BATCH_LIMIT = 2_000;

/** `issue_event` rows per issue per minute. See `EventCap`. */
export const EVENTS_PER_MINUTE = 20;

/** How far back a cold start with no issues at all looks. */
export const INITIAL_LOOKBACK_MS = 60 * 60_000;

/**
 * The largest `UNSIGNED BIGINT`, used as the id half of a reseeded watermark.
 *
 * A watermark carried in memory is an exact `(ts, id)` pair. One recovered after a restart is
 * not: `MAX(issue.last_seen)` gives back the millisecond, and nothing says which of the rows
 * sharing it had been reached. Seeding the id at zero re-reads every one of them and counts them
 * twice — which is how this was first written, and what `issue-grouping.e2e-spec.ts` caught.
 *
 * The sentinel resolves the millisecond the other way: everything stamped `last_seen` is treated
 * as done. The cost is that a row at exactly that millisecond which had *not* been grouped is
 * skipped — an undercount of one occurrence, once, at process start. That is the same trade
 * `SETTLE_MS` makes, for the same reason: an undercount is silent, bounded and does not compound,
 * and a double count is on screen and does.
 */
const ALL_OF_THAT_MS = 18_446_744_073_709_551_615n;

type RawRow = {
  id: bigint;
  ts: Date;
  service: string;
  level: number;
  levelName: string;
  message: string;
  traceId: string | null;
  attrs: unknown;
};

/** One fingerprint's contribution from a single pass, folded before anything is written. */
type Pending = {
  fingerprint: string;
  service: string;
  type: string | null;
  message: string;
  culprit: string | null;
  level: number;
  levelName: string;
  firstTs: Date;
  lastTs: Date;
  count: number;
  /** The newest occurrence, kept for `issue.sample` and for the event rows. */
  sample: { ts: Date; traceId: string | null; stack: string | null; message: string };
};

@Injectable()
export class GrouperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private grouping = false;
  private highWater: { ts: Date; id: bigint } | null = null;
  private readonly cap: EventCap;

  constructor(
    private readonly prisma: PrismaService,
    perMinute: number = EVENTS_PER_MINUTE,
  ) {
    this.cap = new EventCap(perMinute);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), GROUP_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One latched cycle. Never throws: a grouper that took the process down with it would trade a
   * missing issues list for a missing everything, and the failure is a log line the collector
   * ingests — so it is queryable in the tool it broke in.
   */
  async tick(): Promise<void> {
    if (this.grouping) return;
    this.grouping = true;
    try {
      await this.pass(Date.now());
    } catch (err) {
      logger.error({ err }, "issue grouping cycle failed");
    } finally {
      this.grouping = false;
    }
  }

  /**
   * Read what has settled, rejoin it, fold it, write it. Returns how many rows it consumed, so a
   * test can drive it to exhaustion without watching the clock.
   */
  async pass(now: number): Promise<number> {
    const from = await this.watermark(now);
    const settledTo = new Date(now - SETTLE_MS);
    if (from.ts >= settledTo) return 0;

    const rows = await this.read(from, settledTo);
    if (rows.length === 0) return 0;

    // The watermark advances over everything read, not everything grouped. A row the predicate
    // rejected has still been seen, and re-reading it next pass would be work with no answer.
    const last = rows[rows.length - 1];
    this.highWater = { ts: last.ts, id: last.id };

    const pending = this.fold(rows);
    if (pending.size > 0) await this.write(pending, now);

    return rows.length;
  }

  /**
   * Where to resume, seeded once per process.
   *
   * `MAX(issue.last_seen)` *is* the watermark: `last_seen` is updated for every occurrence,
   * including those the event cap kept out of `issue_event`, so it is the newest moment this
   * installation has grouped. No state table, and nothing to keep in step with one.
   */
  private async watermark(now: number): Promise<{ ts: Date; id: bigint }> {
    if (this.highWater !== null) return this.highWater;

    const rows = await this.prisma.$queryRaw<{ seen: Date | null }[]>`
      SELECT MAX(last_seen) AS seen FROM issue`;
    const seen = rows[0]?.seen ?? null;

    this.highWater =
      seen === null ? { ts: new Date(now - INITIAL_LOOKBACK_MS), id: 0n } : { ts: seen, id: ALL_OF_THAT_MS };
    return this.highWater;
  }

  /**
   * The settled window, in `(ts, id)` order.
   *
   * Keyset rather than an offset, and `>= ts` with the id tie-break rather than `> ts`, because
   * `log_entry` routinely holds several rows at one millisecond — a whole stack, in fact, which
   * is the case that matters most here.
   *
   * `level >= ERROR_LEVEL` before anything else: it is the first term of the `(level, ts)` index,
   * and it is also what keeps a stack's continuation lines in the result, since PM2 routes them
   * to `-error.log` and the parser stamps them `error` too. They are needed — `coalesce` cannot
   * rejoin what the query filtered out.
   */
  private async read(from: { ts: Date; id: bigint }, to: Date): Promise<GroupableRow[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT id, ts, service, level, level_name AS levelName, message, trace_id AS traceId, attrs
        FROM log_entry
       WHERE level >= ${ERROR_LEVEL}
         AND ts <= ${to}
         AND (ts > ${from.ts} OR (ts = ${from.ts} AND id > ${from.id}))
       ORDER BY ts ASC, id ASC
       LIMIT ${BATCH_LIMIT}`;

    return rows.map((row) => ({
      id: BigInt(row.id),
      ts: row.ts,
      service: row.service,
      level: Number(row.level),
      levelName: row.levelName,
      message: row.message,
      traceId: row.traceId,
      attrs: readJsonColumn(row.attrs),
    }));
  }

  /**
   * Rows → one `Pending` per distinct fingerprint.
   *
   * **Folding before writing is what keeps this off the database.** A pass over a bad minute may
   * hold two thousand rows and three distinct errors; upserting per occurrence would be two
   * thousand round trips for three answers. `event_count` is summed here and applied once.
   */
  private fold(rows: GroupableRow[]): Map<string, Pending> {
    const pending = new Map<string, Pending>();

    for (const exception of coalesce(rows)) {
      const fields = errorFieldsOf(exception);
      if (!isGroupable(exception, fields)) continue;

      const { head } = exception;
      const fingerprint = fingerprintOf({
        service: head.service,
        type: fields.type,
        stack: fields.stack,
        message: fields.message,
      });

      const sample = { ts: head.ts, traceId: head.traceId, stack: fields.stack, message: fields.message };
      const existing = pending.get(fingerprint);

      if (existing === undefined) {
        pending.set(fingerprint, {
          fingerprint,
          service: head.service,
          type: fields.type,
          message: fields.message,
          culprit: culpritOf(normaliseFrames(fields.stack)),
          level: head.level,
          levelName: head.levelName,
          firstTs: head.ts,
          lastTs: head.ts,
          count: 1,
          sample,
        });
        continue;
      }

      existing.count += 1;
      // Rows arrive in `(ts, id)` order, so the last one seen is the newest — the sample the
      // modal shows is the most recent stack rather than whichever happened to be first.
      existing.lastTs = head.ts;
      existing.sample = sample;
    }

    return pending;
  }

  private async write(pending: Map<string, Pending>, now: number): Promise<void> {
    for (const one of pending.values()) await this.upsert(one);

    const ids = await this.idsFor([...pending.keys()]);
    const events: Prisma.IssueEventCreateManyInput[] = [];

    for (const one of pending.values()) {
      const issueId = ids.get(one.fingerprint);
      if (issueId === undefined) continue;

      // One sample row per fingerprint per pass, and only while the minute has room. `count` was
      // already applied in full by the upsert above, so a refused row loses a sample and not a
      // number.
      if (!this.cap.allow(one.fingerprint, now)) continue;

      events.push({
        ts: one.sample.ts,
        issueId,
        service: one.service,
        traceId: one.sample.traceId,
        releaseTag: null,
        message: one.sample.message,
        stack: one.sample.stack,
        attrs: undefined,
      });
    }

    if (events.length > 0) await this.prisma.issueEvent.createMany({ data: events });
  }

  /**
   * One issue, created or folded into the existing row.
   *
   * `INSERT … ON DUPLICATE KEY UPDATE` on the unique fingerprint rather than a read-then-write:
   * two passes can never run at once here, but the API's mutations can land between a read and a
   * write, and the guarantee should not depend on that being unlikely.
   *
   * **The assignment order is load-bearing.** MySQL evaluates them left to right and later ones
   * see the earlier writes, so `regression` is computed while `status` still holds its old value.
   * Swapping the two lines makes every resolved issue reopen as a non-regression, which is the
   * one case IKN-9 says must stand out.
   *
   * `first_seen` appears only in the INSERT half. It is never updated, by construction rather
   * than by discipline: there is no assignment that could drift it.
   */
  private async upsert(one: Pending): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO issue
        (fingerprint, service, type, message, culprit, level, level_name,
         status, first_seen, last_seen, event_count, sample)
      VALUES
        (${one.fingerprint}, ${one.service}, ${one.type}, ${one.message}, ${one.culprit},
         ${one.level}, ${one.levelName}, 'unresolved', ${one.firstTs}, ${one.lastTs}, ${one.count},
         ${JSON.stringify({ ts: one.sample.ts, traceId: one.sample.traceId, stack: one.sample.stack })})
      AS new
      ON DUPLICATE KEY UPDATE
        regression  = (issue.status = 'resolved') OR issue.regression,
        status      = IF(issue.status = 'resolved', 'unresolved', issue.status),
        last_seen   = GREATEST(issue.last_seen, new.last_seen),
        event_count = issue.event_count + new.event_count,
        message     = new.message,
        culprit     = new.culprit,
        level       = new.level,
        level_name  = new.level_name,
        sample      = new.sample`;
  }

  private async idsFor(fingerprints: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ id: number; fingerprint: string }[]>`
      SELECT id, fingerprint FROM issue WHERE fingerprint IN (${Prisma.join(fingerprints)})`;

    return new Map(rows.map((row) => [row.fingerprint, Number(row.id)]));
  }
}
