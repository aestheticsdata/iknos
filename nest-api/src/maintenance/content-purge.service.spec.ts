import { describe, expect, it, vi } from "vitest";
import { ContentPurgeService, PURGE_BATCH_ROWS, PURGE_MAX_BATCHES } from "./content-purge.service";

import type { PrismaService } from "@db/prisma.service";

/**
 * The purge's loop, with `$executeRaw` replaced (IKN-87 v2). What MySQL makes of the statement is
 * `test/otlp-traces.e2e-spec.ts`'s question; this one is how many batches run, and when it stops.
 */

/** A database whose successive DELETEs remove these many rows each. */
const prismaDeleting = (counts: number[]) => {
  const executeRaw = vi.fn(async () => counts.shift() ?? 0);
  return { prisma: { $executeRaw: executeRaw } as unknown as PrismaService, executeRaw };
};

describe("ContentPurgeService", () => {
  it("deletes in batches until one comes back short", async () => {
    const { prisma, executeRaw } = prismaDeleting([PURGE_BATCH_ROWS, PURGE_BATCH_ROWS, 12]);
    const report = await new ContentPurgeService(prisma).purge(new Date("2026-11-12T12:00:00Z"));

    expect(report.deleted).toBe(2 * PURGE_BATCH_ROWS + 12);
    expect(report.batches).toBe(3);
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it("runs one statement when nothing has expired", async () => {
    const { prisma, executeRaw } = prismaDeleting([0]);
    expect((await new ContentPurgeService(prisma).purge()).deleted).toBe(0);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("stops at the batch ceiling and leaves the rest to the next pass", async () => {
    const { prisma } = prismaDeleting(Array.from({ length: PURGE_MAX_BATCHES + 5 }, () => PURGE_BATCH_ROWS));
    const report = await new ContentPurgeService(prisma).purge();
    expect(report.batches).toBe(PURGE_MAX_BATCHES);
  });

  it("stops after the current batch once the app is shutting down", async () => {
    const { prisma, executeRaw } = prismaDeleting([PURGE_BATCH_ROWS, PURGE_BATCH_ROWS]);
    const service = new ContentPurgeService(prisma);
    service.beforeApplicationShutdown();
    await service.purge();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("joins a pass in flight rather than starting a second", async () => {
    const { prisma, executeRaw } = prismaDeleting([3]);
    const service = new ContentPurgeService(prisma);
    const [a, b] = await Promise.all([service.purge(), service.purge()]);
    expect(a).toBe(b);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
