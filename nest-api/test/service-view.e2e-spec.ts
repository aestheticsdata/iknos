import { PrismaService } from "@db/prisma.service";
import { SignalsService } from "@metrics/signals.service";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { ServiceRuntime } from "@contracts/service-runtime";
import type { ServiceSignals } from "@contracts/service-signals";
import type { Prisma } from "@generated/prisma/client";
import type { INestApplication } from "@nestjs/common";

/**
 * The two routes the service view reads, end to end (IKN-13).
 *
 * What is asserted here is **shape and refusal**, not values: the arithmetic is held to worked
 * examples by the unit specs beside it, and the numbers a live database happens to hold depend on
 * whether the collector has scraped anything this minute. What cannot be checked there is that the
 * routes are guarded, that an unknown service is a 404 rather than an empty view, and that a
 * service nobody scrapes is answered without inventing a series for it.
 */

const SCRAPED = "e2e-scraped";
const BARE = "e2e-bare";

let app: INestApplication;
let cookie: string;
let prisma: PrismaService;

/** An hour ending now — the window the view's default asks for, on a grid the API will bucket. */
const window = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 3_600_000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
};

beforeAll(async () => {
  app = await buildTestApp();
  cookie = await login(app);
  prisma = app.get(PrismaService);

  /*
   * Two registry rows, because the interesting difference is between them: one carries a
   * `metricsUrl` and one does not, and the second is most of the registry on the real box.
   * Neither URL is ever fetched — nothing in these routes scrapes.
   */
  await prisma.service.deleteMany({ where: { name: { in: [SCRAPED, BARE] } } });
  await prisma.service.createMany({
    data: [
      {
        name: SCRAPED,
        pm2Name: SCRAPED,
        metricsUrl: "http://127.0.0.1:9/metrics",
        healthUrl: "http://127.0.0.1:9/health",
      },
      { name: BARE, pm2Name: BARE, metricsUrl: null, healthUrl: null },
    ],
  });
});

afterAll(async () => {
  await prisma?.service.deleteMany({ where: { name: { in: [SCRAPED, BARE] } } });
  await prisma?.metricSample.deleteMany({ where: { service: SCRAPED } });
  await prisma?.metricRollup.deleteMany({ where: { service: SCRAPED } });
  await app?.close();
});

/**
 * One scrape's worth of rows at `ts` — the heartbeat that proves the interval was watched, and a
 * request counter at `served`.
 *
 * The heartbeat is what `coveredIntervals` reads, so a counter seeded without it is a counter in an
 * interval the API will refuse to quote — which is correct, and would make every assertion below
 * about `null`.
 */
const scrape = (ts: Date, served: number) => [
  { ts, service: SCRAPED, name: "process_start_time_seconds", labelsHash: "e2e0000000000000", value: 1_787_000_000 },
  {
    ts,
    service: SCRAPED,
    name: "http_requests_total",
    labels: { route: "/api/dossiers", method: "GET", status_code: "200" },
    labelsHash: "e2e1111111111111",
    value: served,
  },
];

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);

describe("session", () => {
  it("refuses both routes to a caller with no cookie", async () => {
    // Neither carries `@Public()`, and the guard is global — this is the assertion that the absence
    // of a decorator is what keeps them shut, rather than nobody having pointed a browser at them.
    const server = request(app.getHttpServer());

    await server.get(`/api/services/${SCRAPED}/runtime`).expect(401);
    await server.get(`/api/services/${SCRAPED}/signals?${window()}`).expect(401);
  });
});

describe("GET /api/services/:service/runtime", () => {
  it("says which sources exist for the service, and nulls the readings it does not have", async () => {
    const body = (await get(`/api/services/${SCRAPED}/runtime`).expect(200)).body as ServiceRuntime;

    expect(body.service).toBe(SCRAPED);
    expect(body.scraped).toBe(true);
    expect(body.probed).toBe(true);
    // Nothing has scraped or probed this fixture, so every reading is absent — and absent is
    // `null`, never a confident zero.
    expect(body.process).toBeNull();
    expect(body.probe).toBeNull();
    expect(body.release).toBeNull();
    expect(body.runtime).toEqual({
      heapUsedBytes: null,
      heapTotalBytes: null,
      eventLoopLagMs: null,
      pool: null,
      observedAt: null,
    });
    expect(Number.isNaN(Date.parse(body.observedAt))).toBe(false);
  });

  it("distinguishes a service nobody scrapes from one whose readings are simply missing", async () => {
    // The whole difference between "this service exposes no /metrics" and "the collector has not
    // been past yet" — two empty tiles that need two different sentences under them.
    const body = (await get(`/api/services/${BARE}/runtime`).expect(200)).body as ServiceRuntime;

    expect(body.scraped).toBe(false);
    expect(body.probed).toBe(false);
    expect(body.runtime).toBeNull();
  });

  it("answers 404 for a name that is not in the registry", async () => {
    // Not an empty view: a name the rail cannot offer is a hand-written URL or a service disabled
    // since the page loaded, and both deserve to be told rather than shown something that looks
    // like an outage.
    await get("/api/services/not-a-service/runtime").expect(404);
  });
});

describe("GET /api/services/:service/signals", () => {
  it("covers the whole requested range, with nulls where nothing can be quoted", async () => {
    const body = (await get(`/api/services/${SCRAPED}/signals?${window()}`).expect(200)).body as ServiceSignals;

    expect(body.scraped).toBe(true);
    expect(body.source).toBe("raw");
    // An hour, floored to a minute per interval: metrics are samples, not events, and a bucket
    // narrower than the scrape cadence measures the scrape's punctuality.
    expect(body.bucketMs).toBe(60_000);
    expect(body.throughput.points).toHaveLength(60);
    expect(body.errorRate.points).toHaveLength(60);
    expect(body.p95.points).toHaveLength(60);

    // The x axis stays the range that was asked for, whatever the data does.
    expect(body.throughput.points[0].t).toBe(body.from);
    expect(body.throughput.points.every((point) => point.v === null)).toBe(true);
    expect(body.throughput.value).toBeNull();
    expect(body.p95.value).toBeNull();
  });

  it("answers an unscraped service without inventing a series for it", async () => {
    const body = (await get(`/api/services/${BARE}/signals?${window()}`).expect(200)).body as ServiceSignals;

    expect(body.scraped).toBe(false);
    expect(body.source).toBe("none");
    // Empty, not a run of nulls: a null point invites the reader to wonder when the interval will
    // fill, and this service has no series to fill it.
    expect(body.throughput.points).toEqual([]);
    expect(body.p95.points).toEqual([]);
  });

  it("reports a real rate from real rows", async () => {
    // The point of this one is that the raw query runs against a non-empty result at all: every
    // other assertion in this file is about shape, and a `$queryRaw` returning the right shape of
    // nothing would satisfy all of them.
    const to = new Date();
    const from = new Date(to.getTime() - 5 * 60_000);
    // Six readings a minute apart, ten requests between each — including one before `from`, which
    // is the priming interval the first difference is taken against.
    const rows = [0, 1, 2, 3, 4, 5].flatMap((i) => scrape(new Date(from.getTime() + (i - 1) * 60_000), 1_000 + i * 10));
    await prisma.metricSample.createMany({ data: rows });

    const body = (
      await get(`/api/services/${SCRAPED}/signals?from=${from.toISOString()}&to=${to.toISOString()}`).expect(200)
    ).body as ServiceSignals;

    expect(body.source).toBe("raw");
    // Ten requests a minute is a sixth of a request a second, and the headline is the whole window.
    expect(body.throughput.value).toBeCloseTo(10 / 60, 6);
    expect(body.throughput.points.filter((point) => point.v !== null).length).toBeGreaterThanOrEqual(3);
    // Nothing failed, which is a measured zero rather than an absence.
    expect(body.errorRate.value).toBe(0);

    await prisma.metricSample.deleteMany({ where: { service: SCRAPED } });
  });

  it("stitches the rollups to the raw samples across the seam", async () => {
    /*
     * The only place the rollup query runs, and the only end-to-end check that the two halves are
     * cut on a bucket boundary rather than overlapping or leaving a hole.
     *
     * Driven through a hand-built `SignalsService` rather than over HTTP, and that is a safety
     * property rather than convenience. The cliff sits at `now − IKNOS_METRIC_RETENTION_DAYS`, so
     * moving it into a window this suite can seed would mean setting that variable — which
     * `MaintenanceModule` reads as well, and which its boot-time pass turns into `DROP PARTITION`.
     * A test that narrowed it to put the seam somewhere convenient would delete every sample older
     * than the seam from the developer's own database on the way in. It did, once.
     *
     * Constructed directly, the window is an argument: six hours, with a twelve-hour range around
     * it, so both halves land inside a partition that already exists and nothing is dropped.
     */
    const now = new Date();
    const to = now;
    const from = new Date(now.getTime() - 12 * 3_600_000);
    const hour = 3_600_000;

    /*
     * One counter, hourly, climbing by sixty an hour and never restarting — written into whichever
     * table the API will read that hour from, and never both. Hours before `from` too, because the
     * first interval of any range is differenced against a reading outside it.
     */
    const rollups: Prisma.MetricRollupCreateManyInput[] = [];
    const raw: Prisma.MetricSampleCreateManyInput[] = [];
    const cliff = now.getTime() - 6 * hour;

    for (let hourIndex = -2; hourIndex <= 12; hourIndex += 1) {
      const ts = new Date(from.getTime() + hourIndex * hour);
      const value = 1_000 + 60 * (hourIndex + 2);

      if (ts.getTime() < cliff) {
        rollups.push(
          ...scrape(ts, value).map((row) => ({
            ts: row.ts,
            service: row.service,
            name: row.name,
            ...(row.labels ? { labels: row.labels } : {}),
            labelsHash: row.labelsHash,
            count: 1,
            sum: row.value,
            min: row.value,
            max: row.value,
            last: row.value,
          })),
        );
      } else {
        raw.push(...scrape(ts, value));
      }
    }

    await prisma.metricRollup.createMany({ data: rollups });
    await prisma.metricSample.createMany({ data: raw });

    // A quarter of a day, so the seam falls six hours back — inside the window seeded above.
    const signals = new SignalsService(prisma, 0.25);
    const body = await signals.signals(SCRAPED, from, to, now);

    expect(body.source).toBe("mixed");
    // Hourly aggregates cannot be cut finer than an hour, whatever the span would otherwise choose.
    expect(body.bucketMs % hour).toBe(0);

    const known = body.throughput.points.filter((point) => point.v !== null);
    expect(known.length).toBeGreaterThan(0);
    // Sixty requests an hour throughout, on both sides of the seam and across it. A bucket served
    // twice would read double here, and one served by neither would be missing from `known`.
    for (const point of known) expect(point.v).toBeCloseTo(60 / 3600, 4);

    await prisma.metricRollup.deleteMany({ where: { service: SCRAPED } });
    await prisma.metricSample.deleteMany({ where: { service: SCRAPED } });
  });

  it("refuses a window it cannot prune partitions with", async () => {
    // The same rule the log routes enforce, and for the same reason: `metric_sample` is partitioned
    // by day, and one forgotten parameter would turn a page load into a scan of the whole window.
    await get(`/api/services/${SCRAPED}/signals`).expect(400);
    await get(`/api/services/${SCRAPED}/signals?from=2026-08-23T12:00:00Z`).expect(400);
    await get(`/api/services/${SCRAPED}/signals?from=nonsense&to=alsononsense`).expect(400);
  });
});
