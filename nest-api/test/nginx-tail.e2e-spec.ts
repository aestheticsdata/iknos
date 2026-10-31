import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaService } from "@db/prisma.service";
import { IngestService } from "@ingest/ingest.service";
import { NginxSource } from "@ingest/nginx-source";
import { LogBus } from "@stream/log-bus";
import { afterAll, describe, expect, it } from "vitest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The nginx half of the pipeline, wall-clock included: a registry row names a file, the file
 * grows, and rows appear in MySQL. Slow by construction — the poll interval is real time — which
 * is why it is one test and not a suite, exactly as `tail-roundtrip` is.
 */

const prisma = new PrismaService();
const services: string[] = [];

const line = (ip: string, route: string, status: number) =>
  `${ip} - - [16/Sep/2026:14:02:31 +0200] "GET ${route} HTTP/2.0" ${status} 512 "-" "curl/8.4.0"\n`;

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: { in: services } } });
  await prisma.service.deleteMany({ where: { name: { in: services } } });
  await prisma.ingestOffset.deleteMany({});
  await prisma.$disconnect();
});

describe("nginx tail roundtrip", () => {
  it("reads a file named by a registry row, and survives its rotation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-nginx-"));
    const service = `n${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    services.push(service);
    const file = path.join(dir, "site.access.log");

    await writeFile(file, line("203.0.113.5", "/", 200));
    // The registry is the whole configuration — this row is what makes the file readable at all.
    await prisma.service.create({
      data: { name: service, pm2Name: service, logGlob: file, enabled: true },
    });

    const ingest = new IngestService([new NginxSource(prisma, null)], new LogBus(), prisma);
    await ingest.onApplicationBootstrap();

    // Appended after startup, proving new bytes are picked up rather than only what was present
    // at boot.
    await sleep(1500);
    await appendFile(file, line("198.51.100.7", "/wp-login.php", 404));

    // Rotate the way logrotate does: move the file aside and start a new one. The inode changes,
    // which is what makes the replacement detectable rather than silently producing garbage from
    // a byte offset that now means something else.
    await sleep(1500);
    await rename(file, `${file}.1`);
    await writeFile(file, line("203.0.113.9", "/after-rotation", 500));

    await sleep(2500);
    await ingest.onApplicationShutdown();

    const rows = await prisma.logEntry.findMany({
      where: { service },
      orderBy: { id: "asc" },
      select: { clientIp: true, route: true, statusCode: true, httpMethod: true, levelName: true, logger: true },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.route)).toEqual(["/", "/wp-login.php", "/after-rotation"]);
    expect(rows.map((r) => r.clientIp)).toEqual(["203.0.113.5", "198.51.100.7", "203.0.113.9"]);
    // The level bands are what make these rows reachable from the existing filters.
    expect(rows.map((r) => r.levelName)).toEqual(["info", "warn", "error"]);
    expect(rows.every((r) => r.logger === "nginx.access")).toBe(true);
    expect(rows.every((r) => r.httpMethod === "GET")).toBe(true);
  }, 20_000);

  it("files each line of the shared log under the site whose host it ends on (IKN-84)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-nginx-shared-"));
    const service = `h${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    services.push(service);
    const host = `${service}.example.test`;
    const shared = path.join(dir, "access.log");

    // ks-b's `main` format: combined, then `$http_x_forwarded_for`, then `$host`.
    const hosted = (route: string, to: string) => `${line("203.0.113.5", route, 200).trimEnd()} "-" "${to}"\n`;
    await writeFile(
      shared,
      [
        hosted("/mine", host),
        hosted("/someone-elses", "unclaimed.example.test"),
        // Written before the host was appended to the format: no site to file it under.
        `${line("203.0.113.5", "/before", 200).trimEnd()} "-"\n`,
        hosted("/mine-too", host.toUpperCase()),
      ].join(""),
    );
    await prisma.service.create({ data: { name: service, pm2Name: service, hosts: `${host} www.${host}` } });

    const ingest = new IngestService([new NginxSource(prisma, shared)], new LogBus(), prisma);
    await ingest.onApplicationBootstrap();
    await sleep(2500);
    await ingest.onApplicationShutdown();

    const rows = await prisma.logEntry.findMany({
      where: { service },
      orderBy: { id: "asc" },
      select: { route: true },
    });
    expect(rows.map((r) => r.route)).toEqual(["/mine", "/mine-too"]);
    expect(await prisma.logEntry.count({ where: { route: "/someone-elses" } })).toBe(0);
  }, 20_000);
});
