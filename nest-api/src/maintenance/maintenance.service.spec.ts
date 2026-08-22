import { describe, expect, it, vi } from "vitest";
import { MANAGED_TABLES, MaintenanceService } from "./maintenance.service";
import { partitionName } from "./partitions";

import type { PrismaService } from "@db/prisma.service";

/**
 * The pass manages every raw time-series table, not just `log_entry` (IKN-8): the metric and
 * probe tables would otherwise pile rows into `p_future` until IKN-20, and reorganising a fat
 * `p_future` later costs a full rewrite. `metric_rollup` is deliberately not on the list — it
 * is empty until IKN-20, which owns its retention.
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
    expect(MANAGED_TABLES).not.toContain("metric_rollup");
  });

  it("creates the day window in every managed table that reports partitions", async () => {
    const prisma = makePrisma(MANAGED_TABLES.map((t) => ({ TABLE_NAME: t, PARTITION_NAME: "p_future" })));
    const service = new MaintenanceService(14, prisma, 2);

    const report = await service.run();

    // `plan` creates `daysAhead` days starting from today: two REORGANIZE per table here.
    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    for (const table of MANAGED_TABLES) {
      expect(statements.filter((s) => s.startsWith(`ALTER TABLE ${table} REORGANIZE`))).toHaveLength(2);
    }
    expect(statements.some((s) => s.includes("metric_rollup"))).toBe(false);
    expect(report.created).toHaveLength(2 * MANAGED_TABLES.length);
  });

  it("drops an expired partition only in the table that has it", async () => {
    const prisma = makePrisma([
      { TABLE_NAME: "log_entry", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p_future" },
      { TABLE_NAME: "metric_sample", PARTITION_NAME: "p20200101" },
    ]);
    const service = new MaintenanceService(14, prisma, 0);

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
    const service = new MaintenanceService(14, prisma, 0, 3);

    const report = await service.run();

    const statements = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(statements).toContain(`ALTER TABLE metric_sample DROP PARTITION ${weekOld}`);
    expect(statements).not.toContain(`ALTER TABLE log_entry DROP PARTITION ${weekOld}`);
    expect(report.dropped).toEqual([weekOld]);
  });

  it("skips a table absent from information_schema instead of failing the pass", async () => {
    // A database restored from before the IKN-8 migration: log_entry exists, the rest do not.
    const prisma = makePrisma([{ TABLE_NAME: "log_entry", PARTITION_NAME: "p_future" }]);
    const service = new MaintenanceService(14, prisma, 0);

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
    const service = new MaintenanceService(365, prisma, 0);

    await service.run();

    // metric_sample holds an older day, but the storage panel talks about the logs.
    expect(service.window().oldestPartition).toBe("2026-08-20");
  });
});
