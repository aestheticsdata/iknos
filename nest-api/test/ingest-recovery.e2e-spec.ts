import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaService } from "@db/prisma.service";
import { Tailer } from "@ingest/tailer";
import { persistBatch, Writer } from "@ingest/writer";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The two Done items nothing else exercises: a restart in the middle of a batch loses nothing
 * and duplicates nothing (exact count), and a rotation continues without intervention.
 *
 * The tailer and writer are driven by hand — `poll()` and `flush()` are ordinary methods — so
 * these run in milliseconds instead of waiting on the production intervals.
 */

const prisma = new PrismaService();
const services: string[] = [];

const wire = () => {
  const writer = new Writer({ persist: (r, o) => persistBatch(prisma, r, o) });
  return { writer, makeTailer: (pattern: string) => new Tailer(pattern, (chunk) => writer.submit(chunk)) };
};

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: { in: services } } });
  await prisma.ingestOffset.deleteMany({});
  await prisma.$disconnect();
});

describe("ingest recovery", () => {
  it("a crash mid-batch loses nothing and duplicates nothing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-crash-"));
    const service = `t${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    services.push(service);
    const file = path.join(dir, `${service}-out.log`);

    const wave = (from: number, n: number) => `${Array.from({ length: n }, (_, i) => `line ${from + i}`).join("\n")}\n`;

    // Session 1 sees two waves — two polls, two chunks. One flush drains the first chunk only
    // (the second exceeds the batch budget), and then the process "crashes": the 300 queued
    // records of wave two and their offset never reach the database.
    const s1 = wire();
    const t1 = s1.makeTailer(`${dir}/*.log`);
    t1.hydrate(await prisma.ingestOffset.findMany());
    await writeFile(file, wave(0, 300));
    await t1.poll();
    await appendFile(file, wave(300, 300));
    await t1.poll();
    await s1.writer.flush();
    expect(s1.writer.written).toBe(300);
    expect(s1.writer.queuedRecords).toBe(300);

    // Session 2 boots from the stored offsets, exactly as onApplicationBootstrap does. The
    // committed offset accounts for precisely wave one, so the re-read starts at byte 300×N —
    // nothing lost, nothing twice.
    const s2 = wire();
    const t2 = s2.makeTailer(`${dir}/*.log`);
    t2.hydrate(await prisma.ingestOffset.findMany());
    await t2.poll();
    while (s2.writer.queuedRecords > 0) await s2.writer.flush();

    expect(await prisma.logEntry.count({ where: { service } })).toBe(600);
    const distinct = await prisma.logEntry.groupBy({ by: ["message"], where: { service } });
    expect(distinct).toHaveLength(600);
  });

  it("a rotation continues without intervention", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-rot-"));
    const service = `t${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    services.push(service);
    const file = path.join(dir, `${service}-out.log`);

    const { writer, makeTailer } = wire();
    const tailer = makeTailer(`${dir}/*.log`);

    await writeFile(file, "before rotation\n");
    await tailer.poll();

    // What `pm2 reloadLogs` does: the file is moved aside and a fresh one appears at the same
    // path — new inode, size below the stored offset. Both signals mean "start from zero".
    await rename(file, `${file}.old`);
    await writeFile(file, "after rotation\n");
    await tailer.poll();

    await appendFile(file, "and it keeps going\n");
    await tailer.poll();

    while (writer.queuedRecords > 0) await writer.flush();

    const rows = await prisma.logEntry.findMany({ where: { service }, orderBy: { id: "asc" } });
    expect(rows.map((r) => r.message)).toEqual(["before rotation", "after rotation", "and it keeps going"]);
  });
});
