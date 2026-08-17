import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IngestService } from "../src/ingest/ingest.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { LogBus } from "../src/stream/log-bus";

import type { LogRecord } from "../src/ingest/log-record";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The whole pipeline, wall-clock included: a file on disk grows, and rows appear in MySQL. Slow
 * by construction — the poll interval is real time — which is why it is one test and not a suite.
 */

const prisma = new PrismaService();
const services: string[] = [];

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: { in: services } } });
  await prisma.ingestOffset.deleteMany({});
  await prisma.$disconnect();
});

describe("tail roundtrip", () => {
  it("gets a line written to a file into the database, and onto the bus", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-"));
    const service = `t${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    services.push(service);
    const file = path.join(dir, `${service}-out.log`);
    await writeFile(file, "first line\n");

    const bus = new LogBus();
    const published: LogRecord[] = [];
    bus.subscribe((r) => published.push(r));

    const ingest = new IngestService(`${dir}/*.log`, bus, prisma);
    await ingest.onApplicationBootstrap();

    // Append after startup, proving new bytes are picked up and not just the contents present
    // at boot.
    await sleep(1500);
    await appendFile(file, "second line\n");
    await sleep(2500);

    await ingest.onApplicationShutdown();

    expect(await prisma.logEntry.count({ where: { service } })).toBe(2);

    // The bus saw exactly what the database did — published after commit, so the counts agree.
    expect(published.filter((r) => r.service === service)).toHaveLength(2);

    const stats = ingest.stats();
    expect(stats.written).toBe(2);
    expect(stats.dropped).toBe(0);
    expect(stats.files.some((f) => f.filePath === file && f.byteOffset > 0)).toBe(true);
  }, 20_000);
});
