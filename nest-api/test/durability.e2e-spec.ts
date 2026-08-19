import { randomUUID } from "node:crypto";
import { PrismaService } from "@db/prisma.service";
import { persistBatch } from "@ingest/writer";
import { afterAll, describe, expect, it } from "vitest";

import type { LogRecord } from "@ingest/log-record";

/**
 * The property the whole collector design exists for: rows and the offset that accounts for them
 * land together or not at all. A crash or a database error can therefore never silently skip log
 * lines — the offset cannot run ahead of the data.
 */

const prisma = new PrismaService();

const record = (service: string, message: string): LogRecord => ({
  ts: new Date(),
  service,
  level: 30,
  levelName: "info",
  logger: null,
  message,
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  clientIp: null,
  userId: null,
  hostname: null,
  attrs: null,
});

const services: string[] = [];
const files: string[] = [];

const fresh = () => {
  const service = `t-${randomUUID().slice(0, 8)}`;
  const filePath = `/tmp/${service}.log`;
  services.push(service);
  files.push(filePath);
  return { service, filePath };
};

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: { in: services } } });
  await prisma.ingestOffset.deleteMany({ where: { filePath: { in: files } } });
  await prisma.$disconnect();
});

describe("persistBatch", () => {
  it("lands rows and the offset together", async () => {
    const { service, filePath } = fresh();

    await persistBatch(
      prisma,
      Array.from({ length: 250 }, (_, i) => record(service, `line ${i}`)),
      [{ filePath, dev: 1n, inode: 2n, byteOffset: 4096n }],
    );

    expect(await prisma.logEntry.count({ where: { service } })).toBe(250);
    const offset = await prisma.ingestOffset.findUnique({ where: { filePath } });
    expect(offset?.byteOffset).toBe(4096n);
  });

  it("leaves no rows and no offset when the batch fails", async () => {
    const { service, filePath } = fresh();

    // `dev` is an UNSIGNED BIGINT: a negative value fails the offset upsert — the SECOND
    // statement of the transaction — which must take the already-executed createMany down
    // with it. This is the atomicity claim itself, not merely a validation check.
    await expect(
      persistBatch(prisma, [record(service, "doomed")], [{ filePath, dev: -1n, inode: 2n, byteOffset: 99n }]),
    ).rejects.toThrow();

    expect(await prisma.logEntry.count({ where: { service } })).toBe(0);
    expect(await prisma.ingestOffset.findUnique({ where: { filePath } })).toBeNull();
  });

  it("clamps a hostile line instead of poisoning the batch", async () => {
    // An 800 KB message overflows TEXT; a 64-character levelName overflows VARCHAR(16). Either
    // would fail the INSERT — and a batch that fails on shape is retried forever, which turns one
    // malformed line in one app into a permanent ingestion outage for all of them.
    const { service, filePath } = fresh();
    const hostile: LogRecord = {
      ...record(service, "x".repeat(800_000)),
      levelName: "x".repeat(64),
      traceId: "t".repeat(100),
      route: `/r/${"y".repeat(500)}`,
    };

    await persistBatch(prisma, [hostile], [{ filePath, dev: 1n, inode: 2n, byteOffset: 7n }]);

    const row = await prisma.logEntry.findFirst({ where: { service } });
    expect(row).not.toBeNull();
    expect(row?.levelName.length).toBeLessThanOrEqual(16);
    expect(row?.route?.length).toBeLessThanOrEqual(255);
  });
});
