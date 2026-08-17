import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, deleteLogs, login, seedLogs } from "./helpers";

import type { INestApplication } from "@nestjs/common";
import type { Bucket } from "../src/contracts/histogram";
import type { LogRow } from "../src/contracts/log-row";

/**
 * The read side, against the real MySQL.
 *
 * Every suite here seeds under its own random service name and filters on it, because `log_entry`
 * is the one table these tests do not own — the local collector may well be writing to it while
 * they run.
 */

/** Wide enough that the assertions do not depend on when the suite happens to run. */
const WIDE = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

/** The window `seedLogs` puts its default rows in: 2026-08-09, around noon UTC. */
const HOUR = "from=2026-08-09T11:00:00Z&to=2026-08-09T13:00:00Z";

let app: INestApplication;
let cookie: string;
const seeded: string[] = [];

const track = async (...args: Parameters<typeof seedLogs>) => {
  const service = await seedLogs(...args);
  seeded.push(service);
  return service;
};

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);

beforeAll(async () => {
  app = await buildTestApp();
  // Once for the suite: signing in clears every other session for the account.
  cookie = await login(app);
});

afterAll(async () => {
  await deleteLogs(app, seeded);
  await app?.close();
});

describe("session", () => {
  it("refuses every log route to a caller with no cookie", async () => {
    const server = request(app.getHttpServer());

    await server.get(`/api/logs?${WIDE}`).expect(401);
    await server.get(`/api/logs/histogram?${WIDE}`).expect(401);
    await server.get(`/api/logs/trace/abc123?${WIDE}`).expect(401);
    await server.get("/api/services").expect(401);
    // The stream especially: an endpoint that hijacks the response is exactly where a guard gets
    // forgotten, and it would be a permanent unauthenticated firehose of every line on the box.
    await server.get(`/api/logs/stream?${WIDE}`).expect(401);
  });
});

describe("GET /api/logs", () => {
  it("rejects a query with no time range", async () => {
    // Unbounded means every partition, which is the one thing the schema is built to avoid.
    await get("/api/logs").expect(400);
    await get("/api/logs?from=2026-08-09T00:00:00Z").expect(400);
    await get("/api/logs?to=2026-08-10T00:00:00Z").expect(400);
  });

  it("rejects a range that is not a range", async () => {
    await get("/api/logs?from=yesterday&to=today").expect(400);
    await get("/api/logs?from=2026-08-10T00:00:00Z&to=2026-08-09T00:00:00Z").expect(400);
  });

  it("paginates without gaps or repeats", async () => {
    const service = await track(app, 120);

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page++) {
      const url = `/api/logs?${WIDE}&service=${service}&limit=50${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await get(url).expect(200);

      for (const row of res.body.rows as LogRow[]) seen.push(row.message);
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(cursor).toBeNull();
  });

  it("caps the page size the caller asks for", async () => {
    const service = await track(app, 250);
    const res = await get(`/api/logs?${WIDE}&service=${service}&limit=100000`).expect(200);

    expect(res.body.rows.length).toBe(200);
  });

  it("returns rows newest first", async () => {
    const service = await track(app, 20);
    const res = await get(`/api/logs?${WIDE}&service=${service}`).expect(200);

    const times = (res.body.rows as LogRow[]).map((r) => r.ts);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("returns the id as a string", async () => {
    const service = await track(app, 1);
    const res = await get(`/api/logs?${WIDE}&service=${service}`).expect(200);

    expect(typeof res.body.rows[0].id).toBe("string");
    expect(res.body.rows[0].id).toMatch(/^\d+$/);
  });

  it("finds paths and trace ids by substring", async () => {
    const service = await track(app, 3, {
      message: (i) =>
        ["GET /api/users/42 -> 200 trace=9f2c1b7a4e", "GET /api/users/4 -> 200 trace=11112222ff", "unrelated"][
          i
        ] as string,
    });

    // Both searches are ones FULLTEXT could not have served: its tokenizer shreds a path into
    // words and drops a hex id as noise. Dropping the index was the price of partitioning, and
    // this is what was bought with it.
    const path = await get(`/api/logs?${WIDE}&service=${service}&q=${encodeURIComponent("/api/users/42")}`).expect(200);
    expect(path.body.rows).toHaveLength(1);

    const trace = await get(`/api/logs?${WIDE}&service=${service}&q=9f2c1b7a4e`).expect(200);
    expect(trace.body.rows).toHaveLength(1);
  });

  it("escapes LIKE metacharacters in the search term", async () => {
    const service = await track(app, 2, {
      message: (i) => ["cache hit rate 100% today", "1005 requests served"][i] as string,
    });

    const res = await get(`/api/logs?${WIDE}&service=${service}&q=${encodeURIComponent("100%")}`).expect(200);

    // Unescaped, `%` is a wildcard and this would also match "1005 requests served".
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].message).toContain("100%");
  });

  it("combines every filter at once", async () => {
    const service = await track(app, 12, {
      level: (i) => [30, 40, 50][i % 3] as number,
      route: (i) => (i % 2 === 0 ? "/api/exports" : "/api/dossiers"),
      statusCode: (i) => (i % 4 === 0 ? 500 : 200),
      message: (i) => `request ${i} finished`,
    });

    const res = await get(
      `/api/logs?${WIDE}&service=${service}&level=warn&route=${encodeURIComponent("/api/exports")}` +
        `&status=500&q=${encodeURIComponent("finished")}`,
    ).expect(200);

    // i must satisfy: level >= 40 (i%3 != 0), route even (i%2 == 0), status 500 (i%4 == 0).
    // i%4==0 implies i%2==0, so the survivors are i in {4, 8} — 0 is excluded by the level.
    const rows = res.body.rows as LogRow[];
    expect(rows.map((r) => r.message).sort()).toEqual(["request 4 finished", "request 8 finished"]);
  });

  it("accepts a level as a name or as a number", async () => {
    const service = await track(app, 9, { level: (i) => [30, 40, 50][i % 3] as number });

    const named = await get(`/api/logs?${WIDE}&service=${service}&level=warn`).expect(200);
    const numeric = await get(`/api/logs?${WIDE}&service=${service}&level=40`).expect(200);

    expect(named.body.rows).toHaveLength(6);
    expect(numeric.body.rows.map((r: LogRow) => r.id)).toEqual(named.body.rows.map((r: LogRow) => r.id));
  });

  it("rejects a level that is neither", async () => {
    await get(`/api/logs?${WIDE}&level=quite-bad`).expect(400);
  });

  it("treats an unreadable cursor as no cursor", async () => {
    const service = await track(app, 3);
    // It arrives from a URL, so a truncated copy-paste means "start from the top", not "400".
    const res = await get(`/api/logs?${WIDE}&service=${service}&cursor=not-a-cursor`).expect(200);

    expect(res.body.rows).toHaveLength(3);
  });

  it("reports how long the query took", async () => {
    const service = await track(app, 1);
    const res = await get(`/api/logs?${WIDE}&service=${service}`).expect(200);

    expect(res.body.meta.tookMs).toBeGreaterThanOrEqual(0);
    expect(res.body.meta.tookMs).toBeLessThan(10_000);
  });
});

describe("GET /api/logs/histogram", () => {
  it("rejects a request with no window", async () => {
    await get("/api/logs/histogram").expect(400);
  });

  it("returns buckets that total the same as the search", async () => {
    const service = await track(app, 30, { level: (i) => [30, 40, 50][i % 3] as number });

    const hist = await get(`/api/logs/histogram?${HOUR}&service=${service}`).expect(200);
    const total = (hist.body.buckets as Bucket[]).reduce((n, b) => n + b.error + b.warn + b.info, 0);

    // Ten of each, and `error` is level >= 50 so a fatal would be counted rather than dropped.
    expect(total).toBe(30);
    const errors = (hist.body.buckets as Bucket[]).reduce((n, b) => n + b.error, 0);
    expect(errors).toBe(10);

    const search = await get(`/api/logs?${HOUR}&service=${service}&limit=200`).expect(200);
    expect(search.body.rows).toHaveLength(total);
  });

  it("covers the whole range, quiet intervals included", async () => {
    const service = await track(app, 1);
    const res = await get(`/api/logs/histogram?${HOUR}&service=${service}`).expect(200);

    // Two hours in five-minute steps. A short array would let the chart's x-axis shrink to
    // wherever the logs happen to be, which reads as "this is the whole range".
    expect(res.body.bucketMs).toBe(300_000);
    expect(res.body.buckets).toHaveLength(24);
    expect((res.body.buckets as Bucket[]).filter((b) => b.error + b.warn + b.info === 0).length).toBe(23);
    expect(res.body.buckets[0].t).toBe("2026-08-09T11:00:00.000Z");
  });

  it("keeps the bucket count bounded whatever the range", async () => {
    // Filtered to a service with no rows: what is under test is the granularity the server picks,
    // and asking a week and then eighty years of every partition would be a slow way to assert it.
    const empty = await track(app, 0);

    for (const range of [
      "from=2026-08-02T00:00:00Z&to=2026-08-09T00:00:00Z",
      "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z",
    ]) {
      const res = await get(`/api/logs/histogram?${range}&service=${empty}`).expect(200);
      expect(res.body.buckets.length).toBeGreaterThan(0);
      expect(res.body.buckets.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("GET /api/logs/trace/:traceId", () => {
  // Fresh per run. The trace route deliberately does not filter by service, so a hard-coded id
  // would be found again in whatever a previously failed run left behind.
  const TRACE = randomUUID().replace(/-/g, "").slice(0, 12);

  it("returns the trace in timestamp order and nothing else", async () => {
    const service = await track(app, 6, {
      // Interleaved: half the rows carry the trace, half do not, and the ones that do are seeded
      // out of order so that a missing ORDER BY would show.
      traceId: (i) => (i % 2 === 0 ? TRACE : null),
      ts: (i) => new Date(Date.UTC(2026, 7, 9, 12, 0, 0) + [40, 5, 10, 15, 25, 30][i] * 1000),
      durationMs: (i) => (i === 4 ? 250 : null),
      message: (i) => `step ${i}`,
    });

    const res = await get(`/api/logs/trace/${TRACE}?${HOUR}&service=${service}`).expect(200);

    const rows = res.body.rows as LogRow[];
    expect(rows.map((r) => r.message)).toEqual(["step 2", "step 4", "step 0"]);
    expect(rows.every((r) => r.traceId === TRACE)).toBe(true);
    // 12:00:10 to 12:00:40, plus nothing (the last row has no duration).
    expect(res.body.totalMs).toBe(30_000);
    expect(res.body.traceId).toBe(TRACE);
    expect(res.body.truncated).toBe(false);
  });

  it("says so when a trace is longer than it will return", async () => {
    const long = randomUUID().replace(/-/g, "").slice(0, 12);
    await track(app, 501, {
      traceId: () => long,
      ts: (i) => new Date(Date.UTC(2026, 7, 9, 12, 0, 0) + i * 10),
    });

    const res = await get(`/api/logs/trace/${long}?${HOUR}`).expect(200);

    expect(res.body.rows).toHaveLength(500);
    // A cut timeline that does not admit it is a claim about the request that is not true.
    expect(res.body.truncated).toBe(true);
  });

  it("requires a window like every other route", async () => {
    await get(`/api/logs/trace/${TRACE}`).expect(400);
  });

  it("400s a malformed trace id and 200s an unknown one", async () => {
    await get(`/api/logs/trace/not-a-trace-id!?${HOUR}`).expect(400);

    // A well-formed question whose answer is "nothing" is information, not a 404.
    const res = await get(`/api/logs/trace/deadbeef?${HOUR}`).expect(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.totalMs).toBe(0);
  });
});

describe("GET /api/services", () => {
  it("returns the registry with a meta", async () => {
    const res = await get("/api/services").expect(200);

    expect(Array.isArray(res.body.services)).toBe(true);
    expect(res.body.meta.tookMs).toBeGreaterThanOrEqual(0);
    for (const service of res.body.services) {
      expect(Object.keys(service).sort()).toEqual(["enabled", "name", "pm2Name"]);
      // Health and sparkline arrive with IKN-8. Absent, never present and zero.
      expect(service).not.toHaveProperty("health");
    }
  });
});
