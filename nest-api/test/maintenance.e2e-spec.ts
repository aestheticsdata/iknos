import { PrismaService } from "@db/prisma.service";
import { MaintenanceService } from "@maintenance/maintenance.service";
import { boundaryOf, dateOf, FUTURE_PARTITION, partitionName } from "@maintenance/partitions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The job against a real MySQL, because everything it does is DDL and DDL is exactly what a
 * mocked database cannot tell you the truth about. The arithmetic is already proven without a
 * database in `src/maintenance/partitions.spec.ts`; what is left to prove is that MySQL accepts
 * these statements, that a second run is a no-op, and that the table stays writable throughout.
 *
 * **This suite reorganises the real `log_entry`.** Everything it adds is a day partition of the
 * kind the job maintains anyway — today's window, a handful further ahead, and one long-dead day
 * it then drops — so it leaves the table in a state the job itself would produce, and takes no
 * rows with it. `p_future` is rewritten on the first pass, which on a development database with a
 * backlog is the slowest thing here, and the same thing the first run on ks-b will do.
 */

const prisma = new PrismaService();

/** A day nothing has ever been logged on, so dropping it proves the mechanism and costs nothing. */
const ANCIENT = "p20200101";
const ANCIENT_BOUNDARY = "2020-01-02";

async function partitions(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ PARTITION_NAME: string }[]>`
    SELECT PARTITION_NAME FROM information_schema.PARTITIONS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_entry'
       AND PARTITION_NAME IS NOT NULL
     ORDER BY PARTITION_ORDINAL_POSITION`;
  return rows.map((r) => r.PARTITION_NAME);
}

const today = () => partitionName(new Date());

const todayParts = (): [number, number, number] => {
  const now = new Date();
  return [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
};

/** The first day the table has no partition for — where a row still lands in `p_future`. */
async function firstUnpartitionedDay(): Promise<Date> {
  const days = (await partitions()).map(dateOf).filter((d): d is Date => d !== null);
  const last = Math.max(Date.UTC(...todayParts()), ...days.map((d) => +d));
  return new Date(last + 86_400_000);
}

/** Rows a named partition actually holds — the only way to see where MySQL put them. */
async function countIn(partition: string, service: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM log_entry PARTITION (${partition}) WHERE service = ?`,
    service,
  );
  return Number(rows[0].n);
}

const testServices: string[] = [];

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: { in: testServices } } });
  await prisma.$disconnect();
});

describe("MaintenanceService", () => {
  it("creates the window ahead and reports what it did", async () => {
    const service = new MaintenanceService(14, prisma);

    const report = await service.run();

    const names = await partitions();
    const [d0, d1, d2] = [0, 1, 2].map((i) => partitionName(new Date(Date.now() + i * 86_400_000)));
    expect(names).toContain(d0);
    expect(names).toContain(d1);
    expect(names).toContain(d2);
    // Always last: everything not yet given a day of its own lands here.
    expect(names.at(-1)).toBe(FUTURE_PARTITION);
    expect(report.created.length).toBeGreaterThanOrEqual(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("is a no-op on the second run", async () => {
    const service = new MaintenanceService(14, prisma);
    const before = await partitions();

    const report = await service.run();

    expect(report.created).toEqual([]);
    expect(report.dropped).toEqual([]);
    expect(await partitions()).toEqual(before);
  });

  it("keeps the table writable, and today's row lands in today's partition", async () => {
    const service = new MaintenanceService(14, prisma);
    const name = `t-maintenance-${Date.now()}`;
    testServices.push(name);

    await service.run();
    await prisma.logEntry.create({
      data: { ts: new Date(), service: name, level: 30, levelName: "info", message: "after maintenance" },
    });

    expect(await countIn(today(), name)).toBe(1);
  });

  it("drops a partition past the retention window", async () => {
    const service = new MaintenanceService(14, prisma);
    await service.run();

    // Split the oldest partition in two rather than appending: a RANGE partition can only be
    // added at the end, so the only way to plant a dead day is to carve it off the front.
    const oldest = (await partitions())[0];
    await prisma.$executeRawUnsafe(
      `ALTER TABLE log_entry REORGANIZE PARTITION ${oldest} INTO (` +
        `PARTITION ${ANCIENT} VALUES LESS THAN (TO_DAYS('${ANCIENT_BOUNDARY}')), ` +
        `PARTITION ${oldest} VALUES LESS THAN (TO_DAYS('${boundaryOf(oldest)}')))`,
    );
    expect(await partitions()).toContain(ANCIENT);

    const report = await service.run();

    expect(report.dropped).toContain(ANCIENT);
    expect(await partitions()).not.toContain(ANCIENT);
  });

  /**
   * The outage case. While the job is down every row lands in `p_future`, whatever day it belongs
   * to; the next pass carves days off the front of it, and each carve sweeps the rows belonging to
   * that day out of `p_future` and into it. Rows are relocated, never dropped.
   *
   * Proved by widening the window ahead rather than by counting: a row that sat in `p_future`
   * untouched would satisfy a count and prove nothing about the reorganisation that actually runs.
   * The day is chosen past the last partition that exists, so the test says the same thing on a
   * fresh database and on the hundredth run, and it drops the partition it added on the way out.
   */
  it("relocates rows out of p_future instead of losing them", async () => {
    const name = `t-outage-${Date.now()}`;
    testServices.push(name);

    const day = await firstUnpartitionedDay();
    const target = partitionName(day);
    await prisma.logEntry.create({
      data: { ts: day, service: name, level: 30, levelName: "info", message: "written during the outage" },
    });
    expect(await countIn(FUTURE_PARTITION, name)).toBe(1);

    // Wide enough to reach that day, which is what makes the sweep happen inside this test.
    const daysAhead = Math.round((+day - Date.UTC(...todayParts())) / 86_400_000) + 1;
    await new MaintenanceService(14, prisma, daysAhead).run();

    expect(await countIn(target, name)).toBe(1);
    expect(await countIn(FUTURE_PARTITION, name)).toBe(0);

    // Restored: nothing but this test has ever written to a day that far ahead.
    await prisma.$executeRawUnsafe(`ALTER TABLE log_entry DROP PARTITION ${target}`);
  });

  it("reports the window it is enforcing", async () => {
    const service = new MaintenanceService(9, prisma);

    expect(service.window().lastRunAt).toBeNull();
    await service.run();

    const w = service.window();
    expect(w.retentionDays).toBe(9);
    expect(w.oldestPartition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.lastRunAt).toBeInstanceOf(Date);
  });

  /**
   * A database that refuses the DDL must not take the API down with it: ingestion carries on
   * writing into `p_future`, which is the whole point of the table shipping with one.
   */
  it("survives a database that will not answer", async () => {
    const dead = { $queryRaw: () => Promise.reject(new Error("gone")) } as unknown as PrismaService;
    const service = new MaintenanceService(14, dead);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(service.window().lastRunAt).toBeNull();
  });
});
