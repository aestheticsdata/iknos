import { PrismaService } from "@db/prisma.service";
import { RollupService } from "@maintenance/rollup.service";
import { dayChunks, HOUR_MS } from "@maintenance/rollup-plan";
import { readSamples } from "@metrics/metric-samples";
import { buildSignals, METRIC_NAMES } from "@metrics/signal-series";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

import type { Prisma } from "@generated/prisma/client";
import type { SourcePlan } from "@metrics/metric-window";
import type { INestApplication } from "@nestjs/common";

/**
 * The hourly rollup against MySQL (IKN-20).
 *
 * Every pass here is scoped to one service that exists only in this file. `catchUp` itself is not
 * driven: it aggregates every service on the box, and on a developer's database that means
 * rewriting the corpus's rollups — the planning half of it is `rollup-plan.spec.ts`.
 */

const SERVICE = "e2e-ikn20";
const SCRAPE_MS = 30_000;

let app: INestApplication;
let prisma: PrismaService;
let rollups: RollupService;

/** Six whole hours ending at the last top of the hour, so they cross no partition we cannot write. */
const end = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS);
const start = new Date(+end - 6 * HOUR_MS);

const series = {
  heartbeat: { name: "process_start_time_seconds", labelsHash: "e2e2000000000001", labels: undefined },
  requests: {
    name: "http_requests_total",
    labelsHash: "e2e2000000000002",
    labels: { method: "GET", route: "/a", status_code: "200" },
  },
};

/** A scrape every 30 s, from one interval before `start` to `end`: the counter climbs 2 per scrape. */
const rawRows = () => {
  const out: Prisma.MetricSampleCreateManyInput[] = [];
  for (let at = +start - HOUR_MS; at < +end; at += SCRAPE_MS) {
    const ts = new Date(at + 1_200);
    const n = (at - (+start - HOUR_MS)) / SCRAPE_MS;
    out.push({ ts, service: SERVICE, ...series.heartbeat, value: 1_787_000_000 });
    out.push({ ts, service: SERVICE, ...series.requests, value: 1_000 + 2 * n });
  }
  return out;
};

const rollAll = async (from: Date, to: Date) => {
  let rows = 0;
  for (const chunk of dayChunks({ from, to })) rows += await rollups.roll(chunk, { service: SERVICE });
  return rows;
};

const rollupRows = () =>
  prisma.metricRollup.findMany({
    where: { service: SERVICE },
    orderBy: [{ name: "asc" }, { ts: "asc" }],
    select: { ts: true, name: true, labelsHash: true, count: true, sum: true, min: true, max: true, last: true },
  });

const clear = async () => {
  await prisma.metricSample.deleteMany({ where: { service: SERVICE } });
  await prisma.metricRollup.deleteMany({ where: { service: SERVICE } });
};

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  rollups = new RollupService(prisma, 3);
  await clear();
  await prisma.metricSample.createMany({ data: rawRows() });
});

afterAll(async () => {
  await clear();
  await app?.close();
});

describe("RollupService.roll", () => {
  it("writes one row per series per hour, stamped with the hour's last reading", async () => {
    const inserted = await rollAll(start, end);
    const rows = await rollupRows();

    expect(inserted).toBe(2 * 6);
    const requests = rows.filter((row) => row.name === series.requests.name);
    expect(requests).toHaveLength(6);

    const first = requests[0];
    // 120 scrapes an hour at 30 s; the counter climbs 2 per scrape.
    expect(first.count).toBe(120);
    expect(first.max - first.min).toBe(2 * 119);
    expect(first.last).toBe(first.max);
    // The last reading of the hour, not its top: `:59:31.2`.
    expect(+first.ts).toBe(+start + HOUR_MS - SCRAPE_MS + 1_200);
  });

  it("replays an hour without duplicating or changing it", async () => {
    const before = await rollupRows();
    await rollAll(start, end);
    expect(await rollupRows()).toEqual(before);
  });

  it("corrects an hour that gained a late row instead of adding a second one", async () => {
    const lateTs = new Date(+start + HOUR_MS - 1_000);
    await prisma.metricSample.create({ data: { ts: lateTs, service: SERVICE, ...series.requests, value: 999_999 } });

    await rollAll(start, new Date(+start + HOUR_MS));
    const hour = (await rollupRows()).filter((row) => row.name === series.requests.name && +row.ts < +start + HOUR_MS);

    expect(hour).toHaveLength(1);
    expect(hour[0].count).toBe(121);
    expect(hour[0].last).toBe(999_999);

    await prisma.metricSample.deleteMany({ where: { service: SERVICE, ts: lateTs } });
    await rollAll(start, new Date(+start + HOUR_MS));
  });
});

describe("the seam between rollups and raw samples", () => {
  it("reads the same rate from rollups as from the raw samples they summarise", async () => {
    // Six hourly buckets read twice: all raw, then the first three from rollups.
    const raw: SourcePlan = { bucketMs: HOUR_MS, buckets: 6, boundary: 0, source: "raw" };
    const mixed: SourcePlan = { ...raw, boundary: 3, source: "mixed" };
    const query = { service: SERVICE, from: start, to: end, names: METRIC_NAMES };
    // The hour before the range too, as production has it: the first bucket is differenced
    // against the reading before it, which on the rollup side is that hour's rollup.
    await rollAll(new Date(+start - HOUR_MS), end);

    const fromRaw = buildSignals(await readSamples(prisma, { ...query, plan: raw }), start, raw);
    const fromMixed = buildSignals(await readSamples(prisma, { ...query, plan: mixed }), start, mixed);

    const rates = (signal: typeof fromRaw.throughput) => signal.points.map((point) => point.v);
    expect(rates(fromMixed.throughput).every((v) => v !== null)).toBe(true);
    for (const [i, v] of rates(fromMixed.throughput).entries()) {
      expect(v).toBeCloseTo(rates(fromRaw.throughput)[i] as number, 6);
    }
  });
});
