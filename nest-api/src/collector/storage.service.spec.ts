import { describe, expect, it, vi } from "vitest";
import { CACHE_TTL_MS, StorageService } from "./storage.service";

import type { PrismaService } from "@db/prisma.service";
import type { MaintenanceService } from "@maintenance/maintenance.service";

const window = () => ({
  retentionDays: 14,
  oldestPartition: "2026-08-08",
  lastRunAt: new Date("2026-08-21T03:00:04Z"),
});

const build = (rows: unknown[] = [{ name: "log_entry", bytes: 4_200_000_000n }]) => {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const service = new StorageService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    { window } as unknown as MaintenanceService,
  );
  return { service, queryRaw };
};

/**
 * The cache is the point of this class, and the reason it is tested at all: the ticket asks that
 * this panel not show up in the log queries' response times, and "we called it rarely" is not a
 * property anyone can check by reading the controller.
 */
describe("StorageService", () => {
  it("reads real sizes and marks only the pruned table with a retention", async () => {
    const { service } = build([
      { name: "log_entry", bytes: 4_200_000_000n },
      { name: "app_user", bytes: 16_384n },
    ]);

    const snapshot = await service.read();
    expect(snapshot.tables).toEqual([
      { name: "log_entry", bytes: 4_200_000_000, retentionDays: 14 },
      { name: "app_user", bytes: 16_384, retentionDays: null },
    ]);
    expect(snapshot.totalBytes).toBe(4_200_016_384);
    expect(snapshot.oldestPartition).toBe("2026-08-08");
    expect(snapshot.purgeAt).toBe("03:00");
  });

  it("puts the biggest table first, whatever order MySQL answered in", async () => {
    const { service } = build([
      { name: "app_user", bytes: 16_384n },
      { name: "log_entry", bytes: 4_200_000_000n },
      { name: "ingest_offset", bytes: 32_768n },
    ]);

    const snapshot = await service.read();
    expect(snapshot.tables.map((t) => t.name)).toEqual(["log_entry", "ingest_offset", "app_user"]);
  });

  it("survives an engine that reports no size at all", async () => {
    const { service } = build([{ name: "log_entry", bytes: null }]);
    const snapshot = await service.read();
    expect(snapshot.tables[0].bytes).toBe(0);
  });

  it("queries once and serves the rest of the window from memory", async () => {
    const { service, queryRaw } = build();

    await service.read(1_000);
    await service.read(1_000 + CACHE_TTL_MS - 1);
    await service.read(1_000 + CACHE_TTL_MS - 1);

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("goes back to MySQL once the reading has expired", async () => {
    const { service, queryRaw } = build();

    await service.read(1_000);
    await service.read(1_000 + CACHE_TTL_MS + 1);

    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent cold reads into one query", async () => {
    const { service, queryRaw } = build();

    // Three tabs opening the panel in the same tick. Without the in-flight guard the cache is only
    // a cache after the first answer lands, and a cold start pays for every one of them.
    await Promise.all([service.read(1_000), service.read(1_000), service.read(1_000)]);

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure — the next caller retries rather than inheriting the error", async () => {
    const { service, queryRaw } = build();
    queryRaw.mockRejectedValueOnce(new Error("db down"));

    await expect(service.read(1_000)).rejects.toThrow("db down");
    await expect(service.read(1_000)).resolves.toBeDefined();
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
