import { describe, expect, it, vi } from "vitest";
import { ScrapeService } from "./scrape.service";

import type { PrismaService } from "@db/prisma.service";
import type { ScrapeIo } from "./scrape.service";

/**
 * The orchestration invariants (IKN-8), tested with the IO injected: cycles never overlap, one
 * unreachable target never costs the others, and every absence is recorded as data. The pieces
 * a cycle calls — parser, prober, mappers, CPU delta — carry their own specs; these tests are
 * about what holds the pieces together.
 */

const promText = "up 1\n";

const makePrisma = (services: Array<{ name: string; metricsUrl?: string | null; healthUrl?: string | null }>) =>
  ({
    service: { findMany: vi.fn().mockResolvedValue(services) },
    metricSample: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    healthCheck: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    hostSample: { create: vi.fn().mockResolvedValue({}) },
    processSample: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }) as unknown as PrismaService & {
    service: { findMany: ReturnType<typeof vi.fn> };
    metricSample: { createMany: ReturnType<typeof vi.fn> };
    healthCheck: { createMany: ReturnType<typeof vi.fn> };
    hostSample: { create: ReturnType<typeof vi.fn> };
    processSample: { createMany: ReturnType<typeof vi.fn> };
  };

const stream = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const makeIo = (overrides: Partial<ScrapeIo> = {}): ScrapeIo => ({
  fetchMetrics: vi.fn().mockImplementation(() => Promise.resolve({ ok: true, status: 200, body: stream(promText) })),
  fetchHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: 200, body: stream('{"status":"ok"}') })),
  readProcStat: () => Promise.resolve(null),
  cpus: () => [{ times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 10 } }] as never,
  loadavg: () => [0.5, 0.4, 0.3],
  freemem: () => 4_000_000_000,
  totalmem: () => 16_000_000_000,
  statfs: () => Promise.resolve({ bavail: 1000, blocks: 4000, bsize: 4096 }),
  jlist: () => Promise.resolve(null),
  ...overrides,
});

describe("ScrapeService.scrapeTick", () => {
  it("writes rows for every service that has a metricsUrl", async () => {
    const prisma = makePrisma([
      { name: "pfa-nest-api", metricsUrl: "http://127.0.0.1:6100/api/metrics" },
      { name: "iknos-api", metricsUrl: "http://127.0.0.1:6900/api/metrics" },
    ]);
    const service = new ScrapeService(prisma, makeIo());

    await service.scrapeTick();

    expect(prisma.metricSample.createMany).toHaveBeenCalledTimes(2);
    const rows = prisma.metricSample.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ service: "pfa-nest-api", name: "up", value: 1 });
  });

  it("keeps scraping the others when one target is unreachable", async () => {
    const prisma = makePrisma([
      { name: "dead", metricsUrl: "http://127.0.0.1:1/metrics" },
      { name: "alive", metricsUrl: "http://127.0.0.1:6100/api/metrics" },
    ]);
    const fetchMetrics = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error("ECONNREFUSED")))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, body: stream(promText) }));
    const service = new ScrapeService(prisma, makeIo({ fetchMetrics }));

    await service.scrapeTick();

    expect(prisma.metricSample.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.metricSample.createMany.mock.calls[0][0].data[0].service).toBe("alive");
  });

  it("never lets two cycles overlap — the latch, not luck", async () => {
    const prisma = makePrisma([{ name: "slow", metricsUrl: "http://x/metrics" }]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMetrics = vi.fn().mockImplementation(async () => {
      await gate;
      return { ok: true, status: 200, body: stream(promText) };
    });
    const service = new ScrapeService(prisma, makeIo({ fetchMetrics }));

    const first = service.scrapeTick();
    const second = service.scrapeTick();
    release();
    await Promise.all([first, second]);

    expect(fetchMetrics).toHaveBeenCalledTimes(1);
  });
});

describe("ScrapeService.probeTick", () => {
  it("records one row per probed service, failures included as data", async () => {
    const prisma = makePrisma([
      { name: "pfa-nest-api", healthUrl: "http://127.0.0.1:6100/api/health" },
      { name: "dead", healthUrl: "http://127.0.0.1:1/health" },
    ]);
    const fetchHealth = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve({ status: 200, body: stream('{"status":"ok","version":"0.0.1"}') }))
      .mockImplementationOnce(() => Promise.reject(new Error("ECONNREFUSED")));
    const service = new ScrapeService(prisma, makeIo({ fetchHealth }));

    await service.probeTick();

    expect(prisma.healthCheck.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.healthCheck.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ service: "pfa-nest-api", ok: true, httpStatus: 200, version: "0.0.1" });
    expect(rows[1]).toMatchObject({ service: "dead", ok: false, httpStatus: null });
    expect(rows[1].error).toContain("ECONNREFUSED");
  });
});

describe("ScrapeService.sampleTick", () => {
  it("writes a host sample; cpu is null on the first reading and a number on the second", async () => {
    const prisma = makePrisma([]);
    const cpus = vi
      .fn()
      .mockReturnValueOnce([{ times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 10 } }] as never)
      .mockReturnValueOnce([{ times: { user: 200, nice: 0, sys: 100, idle: 1600, irq: 20 } }] as never);
    const service = new ScrapeService(prisma, makeIo({ cpus }));

    await service.sampleTick();
    await service.sampleTick();

    expect(prisma.hostSample.create).toHaveBeenCalledTimes(2);
    expect(prisma.hostSample.create.mock.calls[0][0].data.cpuPct).toBeNull();
    // busy goes 160 → 320 while total goes 960 → 1920: 160 busy of 960 elapsed = 16.67 %.
    expect(prisma.hostSample.create.mock.calls[1][0].data.cpuPct).toBeCloseTo(16.67, 1);
    expect(prisma.hostSample.create.mock.calls[0][0].data).toMatchObject({
      load1: 0.5,
      memTotalBytes: 16_000_000_000,
      memUsedBytes: 12_000_000_000,
    });
  });

  it("skips process rows when pm2 is unavailable — missing data, not zeros", async () => {
    const prisma = makePrisma([]);
    const service = new ScrapeService(prisma, makeIo({ jlist: () => Promise.resolve(null) }));

    await service.sampleTick();

    expect(prisma.processSample.createMany).not.toHaveBeenCalled();
  });

  it("writes one process row per pm2 process when jlist answers", async () => {
    const prisma = makePrisma([]);
    const jlist = () =>
      Promise.resolve(
        JSON.stringify([
          {
            name: "pfa-nest-api",
            pm_id: 3,
            monit: { cpu: 1, memory: 5 },
            pm2_env: { status: "online", restart_time: 2 },
          },
          { name: "iknos-api", pm_id: 4, monit: { cpu: 0, memory: 6 }, pm2_env: { status: "online", restart_time: 0 } },
        ]),
      );
    const service = new ScrapeService(prisma, makeIo({ jlist }));

    await service.sampleTick();

    expect(prisma.processSample.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.processSample.createMany.mock.calls[0][0].data).toHaveLength(2);
  });
});
