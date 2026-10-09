import { logger } from "@common/logger";
import { DEFAULT_ROLLUP_RETENTION_DAYS } from "@config/env.validation";
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
 * `metric_rollup` joined with IKN-20, on its own year-long window. `issue` stays absent: it is an
 * identity table rather than a stream, and an issue whose occurrences have all aged out still
 * answers "when did this first appear".
 */
export const MANAGED_TABLES = [
  "log_entry",
  "metric_sample",
  "health_check",
  "host_sample",
  "process_sample",
  "issue_event",
  "alert_state_change",
  "metric_rollup",
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
const RETENTION_WINDOW: Record<ManagedTable, "logs" | "metrics" | "rollups"> = {
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
  // The long history the raw window gives up (IKN-20) — `IKNOS_ROLLUP_RETENTION_DAYS`, 90 days.
  metric_rollup: "rollups",
};

/** The one table whose partitions may not go before their hours are rolled up (IKN-20). */
const ROLLED_UP_TABLE: ManagedTable = "metric_sample";

/** What the pass needs of the rollups — `RollupService`, in production. */
export type RollupGate = {
  /** Must answer before a raw partition is dropped. */
  catchUp: () => Promise<{ through: Date | null }>;
  /** Started after the boot pass, never during it — see `RollupService.catchUpInBackground`. */
  catchUpInBackground: () => void;
};

/** Which pass is running: the boot one may not wait on the rollups, the 3 a.m. one must. */
export const PASS = { boot: "boot", scheduled: "scheduled" } as const;
export type Pass = (typeof PASS)[keyof typeof PASS];

/** Everything the pass is configured with. Only `retentionDays` is required. */
export type MaintenanceOptions = {
  /** `IKNOS_RETENTION_DAYS` — logs, issue occurrences, alert history. */
  retentionDays: number;
  /**
   * Days of partitions kept ahead of today. Three in production — two missed runs still have
   * somewhere to put their rows — and widened by the tests that need the reorganisation of
   * `p_future` to reach a day they can write to.
   */
  daysAhead?: number;
  /**
   * The sample tables' own window (IKN-8). Raw metrics run to over a million rows per day — they
   * cannot ride the logs' knob, and shortening theirs must never shorten the log window with it.
   */
  metricRetentionDays?: number;
  /** `metric_rollup`'s window (IKN-20). 90 days by default. */
  rollupRetentionDays?: number;
  /** Absent in the tests that are not about rollups; there, raw partitions drop unconditionally. */
  rollups?: RollupGate;
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

  private readonly retentionDays: number;
  private readonly daysAhead: number;
  private readonly metricRetentionDays: number;
  private readonly rollupRetentionDays: number;
  private readonly rollups: RollupGate | null;

  constructor(
    private readonly prisma: PrismaService,
    options: MaintenanceOptions,
  ) {
    this.retentionDays = options.retentionDays;
    this.daysAhead = options.daysAhead ?? DAYS_AHEAD;
    this.metricRetentionDays = options.metricRetentionDays ?? options.retentionDays;
    this.rollupRetentionDays = options.rollupRetentionDays ?? DEFAULT_ROLLUP_RETENTION_DAYS;
    this.rollups = options.rollups ?? null;
  }

  /**
   * Once at boot, so a fresh deploy is correct immediately rather than at three tomorrow morning —
   * then, and only then, the rollups' own catch-up, in the background (IKN-20).
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.safeRun(PASS.boot);
    this.rollups?.catchUpInBackground();
  }

  // Kept in step with `PURGE_AT`, which is what the storage panel tells the reader (IKN-24).
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async daily(): Promise<void> {
    await this.safeRun(PASS.scheduled);
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
  private async safeRun(pass: Pass): Promise<void> {
    try {
      await this.run(pass);
    } catch (error) {
      logger.error({ err: error }, "partition maintenance failed; ingestion continues into p_future");
    }
  }

  async run(pass: Pass = PASS.scheduled): Promise<MaintenanceReport> {
    // A second caller waits for the pass in flight and reports the same result, rather than
    // issuing a REORGANIZE against a table another REORGANIZE is halfway through.
    if (this.running) return this.running;

    this.running = this.execute(pass);
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async execute(pass: Pass): Promise<MaintenanceReport> {
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

      const planned = plan(existing, new Date(), this.retentionFor(table), this.daysAhead);
      const toCreate = planned.toCreate;
      const toDrop = table === ROLLED_UP_TABLE ? await this.rolledUpOnly(planned.toDrop, pass) : planned.toDrop;
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
        rollupRetentionDays: this.rollupRetentionDays,
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
  /** Logs and issue occurrences keep the log window, the raw samples the short one, rollups their own. */
  retentionFor(table: ManagedTable): number {
    const window = RETENTION_WINDOW[table];
    if (window === "logs") return this.retentionDays;
    if (window === "rollups") return this.rollupRetentionDays;
    return this.metricRetentionDays;
  }

  /**
   * The raw partitions that may go: those whose whole day is rolled up (IKN-20).
   *
   * The rollup is asked to catch up first, so in steady state this keeps nothing — the hours it
   * guards were aggregated days ago. What it is for is the day the rollup has been failing: then
   * the raw days stay, the table grows, and the log line says why, which beats a long chart with a
   * permanent hole in it. Without a gate (the tests not about rollups) everything planned goes.
   */
  private async rolledUpOnly(toDrop: string[], pass: Pass): Promise<string[]> {
    if (this.rollups === null || toDrop.length === 0) return toDrop;
    // The boot pass is awaited by the boot, and a catch-up can take a minute: the raw days wait for
    // the 3 a.m. pass rather than holding `/health` hostage. A day late, never a hole.
    if (pass === PASS.boot) return [];

    let through: Date | null = null;
    try {
      ({ through } = await this.rollups.catchUp());
    } catch (error) {
      logger.error({ err: error }, "metric rollup failed; keeping every raw partition");
      return [];
    }

    const allowed = toDrop.filter((name) => {
      const day = dateOf(name);
      return day !== null && through !== null && +day + 86_400_000 <= +through;
    });
    const kept = toDrop.filter((name) => !allowed.includes(name));
    if (kept.length > 0) logger.warn({ kept, through }, "raw partitions kept: their hours are not rolled up yet");

    return allowed;
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
