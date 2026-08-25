import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { assertDayPartition, boundaryOf, DAYS_AHEAD, dateOf, FUTURE_PARTITION, plan } from "./partitions";

import type { OnApplicationBootstrap } from "@nestjs/common";

/**
 * Every raw time-series table the pass manages (IKN-11 for `log_entry`, extended by IKN-8 for
 * the metric and probe tables and by IKN-9 for `issue_event`). Membership here is the whole
 * authorization: table names reach `$executeRawUnsafe` from this list and nowhere else.
 *
 * `metric_rollup` is deliberately absent — empty until IKN-20, which owns its retention. So is
 * `issue`, which is an identity table rather than a stream: an issue whose occurrences have all
 * aged out still answers "when did this first appear".
 */
export const MANAGED_TABLES = [
  "log_entry",
  "metric_sample",
  "health_check",
  "host_sample",
  "process_sample",
  "issue_event",
  "alert_state_change",
] as const;

type ManagedTable = (typeof MANAGED_TABLES)[number];

/**
 * Which of the two windows each managed table is pruned on.
 *
 * **Exhaustive on purpose.** This used to be `table === "log_entry" ? logs : metrics`, which
 * meant every table added to the list afterwards silently inherited the metric window — three
 * days in production. `issue_event` is the table that would have been wrong: IKN-9 says an
 * issue's occurrences follow the *log* retention, and a 48-hour chart drawn over a three-day
 * table would have been quietly right for a week and quietly wrong forever after. A `Record`
 * over `ManagedTable` cannot be added to without answering the question.
 */
const RETENTION_WINDOW: Record<ManagedTable, "logs" | "metrics"> = {
  log_entry: "logs",
  metric_sample: "metrics",
  health_check: "metrics",
  host_sample: "metrics",
  process_sample: "metrics",
  issue_event: "logs",
  // The transitions behind a kept `alert` row, exactly as `issue_event` is the occurrences behind
  // a kept `issue` — so it follows the log window, not the three-day metric one. The modal's band
  // is six hours and would survive either; what would not is someone widening it later against a
  // table that had quietly been pruned at three days all along.
  alert_state_change: "logs",
};

/** What one pass did, for the summary line and for the tests. */
export type MaintenanceReport = {
  created: string[];
  dropped: string[];
  durationMs: number;
};

/**
 * What `GET /api/collector/storage` serves (IKN-24), as ISO dates rather than partition names —
 * `p20260821` is an implementation detail of the table, `2026-08-21` is what the panel shows.
 *
 * A retention policy nobody can check from the interface is a retention policy nobody trusts,
 * which is the entire reason this exists rather than living only in a log line.
 */
export type StorageWindow = {
  retentionDays: number;
  /** The oldest day still held, `null` before the first successful pass. */
  oldestPartition: string | null;
  lastRunAt: Date | null;
};

/**
 * Keeps `log_entry` to a bounded, predictable size: three days of partitions ahead of today, and
 * nothing older than the retention window (IKN-11).
 *
 * Both halves are `ALTER TABLE`, and that is the whole design. Retention by `DROP PARTITION` is
 * instant and **returns the disk to the filesystem**, which a batched `DELETE` never does —
 * InnoDB keeps the freed pages for itself and the data file only ever grows.
 *
 * Nothing here is load-bearing for ingestion. If this job never runs, rows keep landing in
 * `p_future` and the only consequence is a table that is not pruned: degraded, not broken. That
 * is why every failure below is caught and logged rather than propagated — a maintenance job
 * that can crash the API at boot is a worse problem than the one it solves.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  private lastRunAt: Date | null = null;
  private oldest: string | null = null;
  /** One pass at a time: boot and the 3 a.m. cron can otherwise overlap and fight over the DDL. */
  private running: Promise<MaintenanceReport> | null = null;

  constructor(
    private readonly retentionDays: number,
    private readonly prisma: PrismaService,
    /**
     * Days of partitions kept ahead of today. Three in production — two missed runs still have
     * somewhere to put their rows — and widened by the tests that need the reorganisation of
     * `p_future` to reach a day they can write to.
     */
    private readonly daysAhead: number = DAYS_AHEAD,
    /**
     * The sample tables' own window (IKN-8). Raw metrics run to ~1.4M rows per day per scraped
     * service — they cannot ride the logs' knob, and shortening theirs must never shorten the
     * log window with it. Long ranges are the rollups' job (IKN-20).
     */
    private readonly metricRetentionDays: number = retentionDays,
  ) {}

  /** Once at boot, so a fresh deploy is correct immediately rather than at three tomorrow morning. */
  async onApplicationBootstrap(): Promise<void> {
    await this.safeRun();
  }

  // Kept in step with `PURGE_AT`, which is what the storage panel tells the reader (IKN-24).
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async daily(): Promise<void> {
    await this.safeRun();
  }

  window(): StorageWindow {
    return {
      retentionDays: this.retentionDays,
      oldestPartition: this.oldest,
      lastRunAt: this.lastRunAt,
    };
  }

  /**
   * The scheduled entry point. Swallows failures on purpose — see the class comment — but says
   * so loudly enough that the line is findable in Iknos itself.
   */
  private async safeRun(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      logger.error({ err: error }, "partition maintenance failed; ingestion continues into p_future");
    }
  }

  async run(): Promise<MaintenanceReport> {
    // A second caller waits for the pass in flight and reports the same result, rather than
    // issuing a REORGANIZE against a table another REORGANIZE is halfway through.
    if (this.running) return this.running;

    this.running = this.execute();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async execute(): Promise<MaintenanceReport> {
    const startedAt = Date.now();

    const rows = await this.prisma.$queryRaw<{ TABLE_NAME: string; PARTITION_NAME: string }[]>`
      SELECT TABLE_NAME, PARTITION_NAME FROM information_schema.PARTITIONS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join([...MANAGED_TABLES])})
         AND PARTITION_NAME IS NOT NULL`;

    const created: string[] = [];
    const dropped: string[] = [];
    const perTable: Record<string, { created: string[]; dropped: string[] }> = {};
    let logExisting: string[] = [];
    let logCreated: string[] = [];
    let logDropped: string[] = [];

    // Tables absent from the result — a database restored from before their migration — are
    // skipped, not failed on: the pass keeps maintaining what exists.
    for (const table of MANAGED_TABLES) {
      const existing = rows.filter((r) => r.TABLE_NAME === table).map((r) => r.PARTITION_NAME);
      if (existing.length === 0) continue;

      const { toCreate, toDrop } = plan(existing, new Date(), this.retentionFor(table), this.daysAhead);
      for (const name of toCreate) await this.create(table, name);
      for (const name of toDrop) await this.drop(table, name);

      created.push(...toCreate);
      dropped.push(...toDrop);
      perTable[table] = { created: toCreate, dropped: toDrop };
      if (table === "log_entry") {
        logExisting = existing;
        logCreated = toCreate;
        logDropped = toDrop;
      }
    }

    const toCreate = created;
    const toDrop = dropped;
    const durationMs = Date.now() - startedAt;
    this.lastRunAt = new Date();
    // The storage panel talks about the logs; the metric tables ride the same window silently.
    this.oldest = oldestDay(logExisting, logCreated, logDropped);

    // The summary line the ticket asks for, and it is ingested like any other: this job's own
    // history is readable in the tool it maintains. Per table, because "p20260808 dropped" is
    // only a statement once it says which table lost it.
    logger.info(
      {
        tables: perTable,
        durationMs,
        retentionDays: this.retentionDays,
        metricRetentionDays: this.metricRetentionDays,
        oldest: this.oldest,
      },
      "partition maintenance",
    );

    return { created: toCreate, dropped: toDrop, durationMs };
  }

  /**
   * A RANGE partition can only be added at the end, and the end is `MAXVALUE`. So the day is
   * carved off the front of `p_future` instead — which also moves whatever rows had already
   * accumulated there into the partition they belong in, at no cost once the window is being
   * kept, because in steady state `p_future` is empty.
   */
  /** Logs and issue occurrences keep the log window; the raw sample tables get the shorter one. */
  retentionFor(table: ManagedTable): number {
    return RETENTION_WINDOW[table] === "logs" ? this.retentionDays : this.metricRetentionDays;
  }

  /**
   * How many days of a given table survive the pass, or `null` if the pass does not touch it.
   *
   * Public since IKN-9 so the storage panel can print a window per table instead of one window
   * for `log_entry` and `∞` for everything else. Two answers to "how long is this kept" that can
   * disagree is the one thing that panel exists to prevent — the argument `service-rail.ts` makes
   * when it exports `STALE_AFTER_MS` rather than letting two renderings hold their own copy.
   */
  retentionForTable(table: string): number | null {
    return isManagedTable(table) ? this.retentionFor(table) : null;
  }

  private async create(table: ManagedTable, name: string): Promise<void> {
    assertManagedTable(table);
    assertDayPartition(name);
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE ${table} REORGANIZE PARTITION ${FUTURE_PARTITION} INTO (` +
        `PARTITION ${name} VALUES LESS THAN (TO_DAYS('${boundaryOf(name)}')), ` +
        `PARTITION ${FUTURE_PARTITION} VALUES LESS THAN MAXVALUE)`,
    );
  }

  private async drop(table: ManagedTable, name: string): Promise<void> {
    assertManagedTable(table);
    assertDayPartition(name);
    await this.prisma.$executeRawUnsafe(`ALTER TABLE ${table} DROP PARTITION ${name}`);
  }
}

/** Narrows an arbitrary table name to one the pass manages. */
function isManagedTable(table: string): table is ManagedTable {
  return (MANAGED_TABLES as readonly string[]).includes(table);
}

/** The companion of `assertDayPartition`: both halves of every DDL string are checked, always. */
function assertManagedTable(table: string): void {
  if (!isManagedTable(table)) {
    throw new Error(`refusing to build DDL: ${JSON.stringify(table)} is not a managed table`);
  }
}

/**
 * The oldest day the table still holds, as an ISO date.
 *
 * Computed from the plan rather than by asking MySQL a second time: the answer is already known
 * once the pass is done, and one round trip is not worth spending on a number that is about to be
 * displayed next to a fourteen-day window.
 */
function oldestDay(existing: string[], created: string[], dropped: string[]): string | null {
  const kept = [...existing, ...created]
    .filter((name) => !dropped.includes(name))
    .map(dateOf)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => +a - +b);

  return kept[0]?.toISOString().slice(0, 10) ?? null;
}
