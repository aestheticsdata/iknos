import { describe, expect, it, vi } from "vitest";
import { MANAGED_TABLES, MaintenanceService } from "./maintenance.service";
import { partitionName } from "./partitions";

import type { PrismaService } from "@db/prisma.service";

/**
 * The pass manages every raw time-series table, not just `log_entry` (IKN-8): the metric and
 * probe tables would otherwise pile rows into `p_future`, and reorganising a fat `p_future`
 * later costs a full rewrite. `metric_rollup` joined the list with IKN-20, on its own window.
 *
 * The DDL these tests capture goes through `$executeRawUnsafe`; the table names come from the
 * exported whitelist and nowhere else.
 */
describe("MaintenanceService over the managed tables", () => {
  const makePrisma = (rows: Array<{ TABLE_NAME: string; PARTITION_NAME: string }>) =>
    ({
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    }) as unknown as PrismaService & {
      $queryRaw: ReturnType<typeof vi.fn>;
      $executeRawUnsafe: ReturnType<typeof vi.fn>;
    };

  it("lists exactly the five raw tables, rollup excluded", () => {
    expect(MANAGED_TABLES).toContain("log_entry");
    expect(MANAGED_TABLES).toContain("metric_sample");
    expect(MANAGED_TABLES).toContain("health_check");
    expect(MANAGED_TABLES).toContain("host_sample");
    expect(MANAGED_TABLES).toContain("process_sample");
    // On its own year-long window since IKN-20.
    expect(MANAGED_TABLES).toContain("metric_rollup");
  });

  it("creates the day window in every managed table that reports partitions", async () => {
    const prisma = makePrisma(MANAGED_TABLES.map((t) => ({ TABLE_NAME: t, PARTITION_NAME: "p_future" })));
    const service = new MaintenanceService(prisma, { retentionDays: 14, daysAhead: 2 });

    const report = await service.run();

    // `plan` creates `daysAhead` days starting from today: two REORGANIZE per table here.
    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    for (const table of MANAGED_TABLES) {
      expect(statements.filter((s) => s.startsWith(`ALTER TABLE ${table} REORGANIZE`))).toHaveLength(2);
    }
    expect(report.created).toHaveLength(2 * MANAGED_TABLES.length);
  });

  it("drops an expired partition only in the table that has it", async () => {
    const prisma = makePrisma([
      { TABLE_NAME: "log_entry", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p20200101" },
    ]);
    const service = new MaintenanceService(prisma, { retentionDays: 14, daysAhead: 0 });

    const report = await service.run();

    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements).toContain("ALTER TABLE metric_sample DROP PARTITION p20200101");
    expect(statements.filter((s) => s.includes("DROP PARTITION"))).toHaveLength(1);
    expect(report.dropped).toContain("p20200101");
  });

  it("applies the metric retention to the sample tables and the log retention to log_entry", async () => {
    // ~1.4M metric rows/day/service means the sample tables cannot ride the logs' fourteen-day
    // knob: they get their own, shorter one (IKNOS_METRIC_RETENTION_DAYS), and shortening it
    // must never shorten the log window with it.
    const weekOld = partitionName(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const prisma = makePrisma([
      { TABLE_NAME: "log_entry", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "log_entry", PARTITION_NAME: weekOld },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: weekOld },
    ]);
    const service = new MaintenanceService(prisma, { retentionDays: 14, daysAhead: 0, metricRetentionDays: 3 });

    const report = await service.run();

    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements).toContain(`ALTER TABLE metric_sample DROP PARTITION ${weekOld}`);
    expect(statements).not.toContain(`ALTER TABLE log_entry DROP PARTITION ${weekOld}`);
    expect(report.dropped).toEqual([weekOld]);
  });

  it("keeps issue occurrences on the log window, not the shorter sample one", async () => {
    // IKN-9: `issue_event` is a stream and follows IKN-11's retention. Before this was a
    // per-table lookup it was `table === "log_entry" ? logs : metrics`, so every table added to
    // MANAGED_TABLES silently inherited three days — and a 48h occurrence chart drawn over a
    // three-day table is right for two days and wrong forever after.
    const weekOld = partitionName(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const prisma = makePrisma([
      { TABLE_NAME: "issue_event", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "issue_event", PARTITION_NAME: weekOld },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: weekOld },
    ]);
    const service = new MaintenanceService(prisma, { retentionDays: 14, daysAhead: 0, metricRetentionDays: 3 });

    await service.run();

    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements).toContain(`ALTER TABLE metric_sample DROP PARTITION ${weekOld}`);
    expect(statements).not.toContain(`ALTER TABLE issue_event DROP PARTITION ${weekOld}`);
    expect(service.retentionForTable("issue_event")).toBe(14);
    expect(service.retentionForTable("metric_sample")).toBe(3);
    // `issue` itself is not in the pass at all — an identity table, honestly never pruned.
    expect(service.retentionForTable("issue")).toBeNull();
  });

  it("skips a table absent from information_schema instead of failing the pass", async () => {
    // A database restored from before the IKN-8 migration: log_entry exists, the rest do not.
    const prisma = makePrisma([{ TABLE_NAME: "log_entry", PARTITION_NAME: "p_future" }]);
    const service = new MaintenanceService(prisma, { retentionDays: 14, daysAhead: 0 });

    await service.run();

    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements.every((s) => s.startsWith("ALTER TABLE log_entry "))).toBe(true);
  });

  it("keeps the storage window's oldest day sourced from log_entry alone", async () => {
    const prisma = makePrisma([
      { TABLE_NAME: "log_entry", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "log_entry", PARTITION_NAME: "p20260820" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p20260810" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
    ]);
    const service = new MaintenanceService(prisma, { retentionDays: 365, daysAhead: 0 });

    await service.run();

    // metric_sample holds an older day, but the storage panel talks about the logs.
    expect(service.window().oldestPartition).toBe("2026-08-20");
  });
});

describe("the purge waits for the rollups (IKN-20)", () => {
  const makePrisma = (rows: Array<{ TABLE_NAME: string; PARTITION_NAME: string }>) =>
    ({
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    }) as unknown as PrismaService & { $executeRawUnsafe: ReturnType<typeof vi.fn> };

  const day = (offset: number) => partitionName(new Date(Date.now() - offset * 86_400_000));
  const oldDay = day(10);
  const olderDay = day(11);
  const rows = [
    { TABLE_NAME: "metric_sample", PARTITION_NAME: olderDay },
    { TABLE_NAME: "metric_sample", PARTITION_NAME: oldDay },
    { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
  ];
  const drops = (prisma: { $executeRawUnsafe: ReturnType<typeof vi.fn> }) =>
    prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string).filter((sql) => sql.includes("DROP PARTITION"));

  it("asks the rollups to catch up, then drops only the days they cover", async () => {
    const prisma = makePrisma(rows);
    // Rolled up through the end of `olderDay` and not a minute of `oldDay`.
    const through = new Date(Date.now() - 10 * 86_400_000);
    through.setUTCHours(0, 0, 0, 0);
    const catchUp = vi.fn().mockResolvedValue({ through });

    await new MaintenanceService(prisma, {
      retentionDays: 3,
      daysAhead: 0,
      rollups: { catchUp, catchUpInBackground: vi.fn() },
    }).run();

    expect(catchUp).toHaveBeenCalledOnce();
    expect(drops(prisma)).toEqual([`ALTER TABLE metric_sample DROP PARTITION ${olderDay}`]);
  });

  it("keeps every raw day when the rollup fails", async () => {
    const prisma = makePrisma(rows);
    const catchUp = vi.fn().mockRejectedValue(new Error("lock wait timeout"));

    await new MaintenanceService(prisma, {
      retentionDays: 3,
      daysAhead: 0,
      rollups: { catchUp, catchUpInBackground: vi.fn() },
    }).run();

    expect(drops(prisma)).toEqual([]);
  });

  it("keeps metric_rollup on its own window, 90 days by default", () => {
    const service = new MaintenanceService(makePrisma([]), { retentionDays: 14, metricRetentionDays: 3 });
    expect(service.retentionForTable("metric_rollup")).toBe(90);
  });
});

describe("the boot pass never waits on the rollups (IKN-20)", () => {
  it("keeps raw days for the 3 a.m. pass, then starts the catch-up in the background", async () => {
    const day = partitionName(new Date(Date.now() - 10 * 86_400_000));
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { TABLE_NAME: "metric_sample", PARTITION_NAME: day },
        { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
      ]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    } as unknown as PrismaService & { $executeRawUnsafe: ReturnType<typeof vi.fn> };
    const catchUp = vi.fn();
    const catchUpInBackground = vi.fn();
    const service = new MaintenanceService(prisma, {
      retentionDays: 3,
      daysAhead: 0,
      rollups: { catchUp, catchUpInBackground },
    });

    await service.onApplicationBootstrap();

    expect(catchUp).not.toHaveBeenCalled();
    expect(catchUpInBackground).toHaveBeenCalledOnce();
    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements.some((sql) => sql.includes("DROP PARTITION"))).toBe(false);
  });
});
