import { DISK_CRITICAL_PCT, DISK_WARN_PCT } from "@alerts/thresholds";
import { HOST_LEVEL } from "@contracts/host";
import { PrismaService } from "@db/prisma.service";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { HostNow, HostSeries } from "@contracts/host";
import type { INestApplication } from "@nestjs/common";

/**
 * The machine panel's two routes, end to end (IKN-25).
 *
 * The series is checked against rows seeded two hours back, a window the test app's own sampler
 * never writes into, so the aggregates are known exactly: a mean for CPU and memory, the **peak**
 * for disk.
 */

let app: INestApplication;
let prisma: PrismaService;
let cookie: string;

const GiB = 1024n ** 3n;
const windowEnd = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 2 * 3_600_000);
const windowStart = new Date(+windowEnd - 5 * 60_000);
const fresh = new Date();

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  cookie = await login(app);

  const at = (minute: number, second: number) => new Date(+windowStart + minute * 60_000 + second * 1000);
  await prisma.hostSample.createMany({
    data: [
      // Minute 1: two samples. CPU means to 30, memory to 50 %, disk peaks at 90 %.
      {
        ts: at(1, 0),
        cpuPct: 20,
        load1: 1,
        load5: 1,
        load15: 1,
        memUsedBytes: 4n * GiB,
        memTotalBytes: 10n * GiB,
        diskUsedBytes: 80n * GiB,
        diskTotalBytes: 100n * GiB,
      },
      {
        ts: at(1, 30),
        cpuPct: 40,
        load1: 2,
        load5: 1,
        load15: 1,
        memUsedBytes: 6n * GiB,
        memTotalBytes: 10n * GiB,
        diskUsedBytes: 90n * GiB,
        diskTotalBytes: 100n * GiB,
      },
      // Minute 3: statfs refused — disk unknown, not zero.
      {
        ts: at(3, 0),
        cpuPct: null,
        load1: 0.5,
        load5: 1,
        load15: 1,
        memUsedBytes: 2n * GiB,
        memTotalBytes: 10n * GiB,
        diskUsedBytes: null,
        diskTotalBytes: null,
      },
      // And a fresh one, so `now` has something to read whether or not the sampler has run yet.
      {
        ts: fresh,
        cpuPct: 5,
        load1: 0.1,
        load5: 0.1,
        load15: 0.1,
        memUsedBytes: 1n * GiB,
        memTotalBytes: 10n * GiB,
        diskUsedBytes: 10n * GiB,
        diskTotalBytes: 100n * GiB,
      },
    ],
  });
});

afterAll(async () => {
  await prisma?.hostSample.deleteMany({
    where: { OR: [{ ts: { gte: windowStart, lt: windowEnd } }, { ts: fresh }] },
  });
  await app?.close();
});

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);

const seriesUrl = (from: Date, to: Date) =>
  `/api/host/series?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

describe("session", () => {
  it("refuses both host routes to a caller with no cookie", async () => {
    const server = request(app.getHttpServer());
    await server.get("/api/host/now").expect(401);
    await server.get(seriesUrl(windowStart, windowEnd)).expect(401);
  });
});

describe("GET /api/host/now", () => {
  it("reads the newest sample and carries the disk rule's own lines", async () => {
    const body = (await get("/api/host/now").expect(200)).body as HostNow;

    expect(body.host).toBe("ks-b");
    expect(body.reading).not.toBeNull();
    expect(body.reading?.cores).toBeGreaterThan(0);
    expect(body.reading?.memory.totalBytes).toBeGreaterThan(0);
    expect(body.thresholds).toEqual({ warnPct: DISK_WARN_PCT, criticalPct: DISK_CRITICAL_PCT });
    expect(Object.values(HOST_LEVEL)).toContain(body.level);
  });
});

describe("GET /api/host/series", () => {
  it("means CPU and memory over an interval, and keeps the disk's peak", async () => {
    const body = (await get(seriesUrl(windowStart, windowEnd)).expect(200)).body as HostSeries;

    expect(body.bucketMs).toBe(60_000);
    expect(body.cpu).toHaveLength(5);
    expect(body.sampled).toBe(true);

    expect(body.cpu[1].v).toBe(30);
    expect(body.memory[1].v).toBe(50);
    expect(body.disk[1].v).toBe(90);
    expect(body.load[1].v).toBe(1.5);

    // An interval nothing was sampled in is null, not zero.
    expect(body.cpu[0].v).toBeNull();
    // A refused statfs is unknown, and so is the restart's first CPU reading.
    expect(body.disk[3].v).toBeNull();
    expect(body.cpu[3].v).toBeNull();
    expect(body.memory[3].v).toBe(20);
  });

  it("says so when the range holds no sample at all", async () => {
    const from = new Date(+windowStart - 3_600_000);
    const body = (await get(seriesUrl(from, new Date(+from + 5 * 60_000))).expect(200)).body as HostSeries;

    expect(body.sampled).toBe(false);
    expect(body.cpu.every((p) => p.v === null)).toBe(true);
  });

  it("refuses a range without both bounds", async () => {
    await get("/api/host/series").expect(400);
  });
});
