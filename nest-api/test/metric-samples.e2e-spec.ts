import { PrismaService } from "@db/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { readSamples } from "@metrics/metric-samples";
import { gridStart } from "@metrics/metric-window";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

import type { SourcePlan } from "@metrics/metric-window";
import type { MetricRow } from "@metrics/signal-series";
import type { INestApplication } from "@nestjs/common";

/**
 * The two metric scans against MySQL, old shape against new (IKN-66).
 *
 * The rewrite swapped `ROW_NUMBER() OVER (… ORDER BY ts DESC, id DESC)` for a `GROUP BY` and a join
 * back. Both are meant to keep the last reading of each series in each interval; the only way to
 * know they keep the *same* one is to run both on one fixture and compare row for row. The window
 * shape is written out here as the reference — it is what the API served until this ticket.
 */

const SERVICE = "e2e-ikn66";
const MINUTE = 60_000;
const NAMES = ["http_requests_total", "process_start_time_seconds"];

let app: INestApplication;
let prisma: PrismaService;

const to = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
const from = new Date(to.getTime() - 10 * MINUTE);

/** Ten one-minute intervals — the boundary decides which table answers the whole range. */
const plan = (boundary: number): SourcePlan => ({
  bucketMs: MINUTE,
  buckets: 10,
  boundary,
  source: boundary === 0 ? "raw" : "rollup",
});
const RAW = plan(0);
const ROLLUP = plan(10);

type Reading = { ts: Date; name: string; hash: string; labels: Prisma.InputJsonValue | null; value: number };

/**
 * Three series, four readings a minute with jitter, from one interval before `from` (the priming
 * one) to the end — the shape a real scrape leaves, irregular seconds included.
 */
const readings = (): Reading[] => {
  const out: Reading[] = [];
  const series = [
    { name: "http_requests_total", hash: "e2e6600000000001", labels: { route: "/a", status_code: "200" } },
    { name: "http_requests_total", hash: "e2e6600000000002", labels: { route: "/b", status_code: "500" } },
    { name: "process_start_time_seconds", hash: "e2e6600000000003", labels: null },
  ];
  let n = 0;
  for (let i = -MINUTE; i < 10 * MINUTE; i += 15_000) {
    n += 1;
    const ts = new Date(from.getTime() + i + ((n * 7919) % 900));
    for (const s of series) out.push({ ts, ...s, value: s.labels === null ? 1_787_000_000 : n * 3 });
  }
  return out;
};

/** The reference: the window-function scan exactly as it shipped before IKN-66. */
async function windowShape(table: "metric_sample" | "metric_rollup", p: SourcePlan): Promise<MetricRow[]> {
  const anchor = gridStart(from, p.bucketMs, -1);
  const bucketSec = p.bucketMs / 1000;
  const windowFrom = gridStart(from, p.bucketMs, -1);
  const value = table === "metric_sample" ? Prisma.raw("value") : Prisma.raw("last");

  const rows = await prisma.$queryRaw<
    { bucket: bigint; ts: Date; name: string; labelsHash: string; labels: unknown; value: number }[]
  >`
    SELECT bucket, ts, name, labelsHash, labels, value
      FROM (
        SELECT CAST(FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec}) AS SIGNED) - 1 AS bucket,
               ts, name, labels_hash AS labelsHash, labels, ${value} AS value,
               ROW_NUMBER() OVER (
                 PARTITION BY name, labels_hash, FLOOR(TIMESTAMPDIFF(SECOND, ${anchor}, ts) / ${bucketSec})
                 ORDER BY ts DESC, id DESC
               ) AS rn
          FROM ${Prisma.raw(table)}
         WHERE service = ${SERVICE}
           AND name IN (${Prisma.join(NAMES)})
           AND ts >= ${windowFrom}
           AND ts <  ${to}
      ) ranked
     WHERE ranked.rn = 1`;

  return rows.map((row) => ({
    bucket: Number(row.bucket),
    ts: row.ts.getTime(),
    name: row.name,
    series: row.labelsHash,
    labels: row.labels,
    value: Number(row.value),
  }));
}

/** Order-free comparison: the scans promise a set of rows, not a sequence. */
const sorted = (rows: MetricRow[]) =>
  rows
    .map((row) => ({ ...row, labels: JSON.stringify(row.labels) }))
    .sort((a, b) => a.series.localeCompare(b.series) || a.bucket - b.bucket);

const clear = async () => {
  await prisma.metricSample.deleteMany({ where: { service: SERVICE } });
  await prisma.metricRollup.deleteMany({ where: { service: SERVICE } });
};

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  await clear();

  const data = readings();
  await prisma.metricSample.createMany({
    data: data.map((r) => ({
      ts: r.ts,
      service: SERVICE,
      name: r.name,
      ...(r.labels === null ? {} : { labels: r.labels }),
      labelsHash: r.hash,
      value: r.value,
    })),
  });

  /*
   * The rollup fixture is written newest first, on purpose: a job backfilling a missed hour gives
   * an older `ts` a newer `id`, and the rollup scan must not care. `MAX(id)` would pick the oldest
   * reading of every interval here.
   */
  await prisma.metricRollup.createMany({
    data: [...data].reverse().map((r) => ({
      ts: r.ts,
      service: SERVICE,
      name: r.name,
      ...(r.labels === null ? {} : { labels: r.labels }),
      labelsHash: r.hash,
      count: 1,
      sum: r.value,
      min: r.value,
      max: r.value,
      last: r.value,
    })),
  });
});

afterAll(async () => {
  await clear();
  await app?.close();
});

describe("the grouped scans against the window-function shape", () => {
  it("return the same rows from metric_sample", async () => {
    const reference = await windowShape("metric_sample", RAW);
    const rows = await readSamples(prisma, { service: SERVICE, from, to, plan: RAW, names: NAMES });

    expect(reference.length).toBeGreaterThan(20);
    expect(sorted(rows)).toEqual(sorted(reference));
  });

  it("return the same rows from metric_rollup, whatever order they were written in", async () => {
    const reference = await windowShape("metric_rollup", ROLLUP);
    const rows = await readSamples(prisma, { service: SERVICE, from, to, plan: ROLLUP, names: NAMES });

    expect(reference.length).toBeGreaterThan(20);
    expect(sorted(rows)).toEqual(sorted(reference));
  });
});

describe("the MAX(id) assumption", () => {
  it("keeps the higher id when two readings of a series share a ts in one interval", async () => {
    /*
     * Two rows one scrape can produce for one series — same `ts`, written one after the other.
     * The window shape broke the tie on `id DESC`; the grouping takes `MAX(id)`. Same answer, and
     * this is the case where the two could have parted.
     */
    const ts = new Date(from.getTime() + 5 * MINUTE + 59_000);
    const hash = "e2e6600000000009";
    const base = { ts, service: SERVICE, name: "process_start_time_seconds", labelsHash: hash };
    await prisma.metricSample.create({ data: { ...base, value: 1 } });
    await prisma.metricSample.create({ data: { ...base, value: 2 } });

    const rows = await readSamples(prisma, { service: SERVICE, from, to, plan: RAW, names: NAMES });
    const kept = rows.filter((row) => row.series === hash);

    expect(kept).toHaveLength(1);
    expect(kept[0].value).toBe(2);
    expect(kept[0].bucket).toBe(5);

    await prisma.metricSample.deleteMany({ where: { service: SERVICE, labelsHash: hash } });
  });
});
