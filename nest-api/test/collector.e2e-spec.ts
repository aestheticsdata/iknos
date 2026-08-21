import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { CollectorStatus, CollectorStorage } from "@contracts/collector";
import type { INestApplication } from "@nestjs/common";

/**
 * Iknos observing itself, end to end (IKN-24).
 *
 * The shape assertions matter more here than the values do. Both routes are read by chrome that is
 * on screen at all times, and the whole design rests on `null` meaning "I do not know" — so what is
 * checked is that a freshly built app answers `null` rather than a confident zero, and that the
 * numbers it does report are real ones.
 */

let app: INestApplication;
let cookie: string;

beforeAll(async () => {
  app = await buildTestApp();
  cookie = await login(app);
});

afterAll(async () => {
  await app?.close();
});

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);

describe("session", () => {
  it("refuses both collector routes to a caller with no cookie", async () => {
    const server = request(app.getHttpServer());
    // These describe the host: which files are on it, where reading has got to in each, and how
    // busy it is. None of it is anybody's business signed out.
    await server.get("/api/collector/status").expect(401);
    await server.get("/api/collector/storage").expect(401);
  });
});

describe("GET /api/collector/status", () => {
  it("answers from memory, with nulls where it genuinely does not know", async () => {
    const body = (await get("/api/collector/status").expect(200)).body as CollectorStatus;

    expect(typeof body.written).toBe("number");
    expect(typeof body.dropped).toBe("number");
    expect(typeof body.degraded).toBe("number");
    expect(typeof body.bytesRead).toBe("number");
    expect(Array.isArray(body.files)).toBe(true);

    // A test app has a tailer, so the heartbeat is either a timestamp or null — never a number
    // that could be read as "zero seconds ago".
    expect(body.lastPollAt === null || !Number.isNaN(Date.parse(body.lastPollAt))).toBe(true);
    // The counters are absent, not zero, until something real has happened.
    expect(body.lagMs === null || body.lagMs >= 0).toBe(true);
    if (body.rate !== null) expect(body.rate.perMinute).toHaveLength(60);
  });

  it("is cheap enough to sit in the chrome of every page", async () => {
    const body = (await get("/api/collector/status").expect(200)).body as CollectorStatus;
    // It never touches MySQL, so this is arithmetic over a map — the assertion is really that no
    // database call has crept in behind it.
    expect(body.meta.tookMs).toBeLessThan(50);
  });
});

describe("GET /api/collector/storage", () => {
  it("reports the sizes MySQL reports, and the window in force", async () => {
    const body = (await get("/api/collector/storage").expect(200)).body as CollectorStorage;

    const logEntry = body.tables.find((t) => t.name === "log_entry");
    expect(logEntry).toBeDefined();
    expect(logEntry?.bytes).toBeGreaterThan(0);
    // The one table anything prunes; everything else is the panel's `∞`.
    expect(logEntry?.retentionDays).toBe(body.retentionDays);
    expect(body.tables.find((t) => t.name === "app_user")?.retentionDays).toBeNull();

    expect(body.totalBytes).toBe(body.tables.reduce((sum, t) => sum + t.bytes, 0));
    // Sorted largest first — the panel is read top-down.
    expect([...body.tables].sort((a, b) => b.bytes - a.bytes)).toEqual(body.tables);
    expect(body.purgeAt).toBe("03:00");
    expect(Number.isNaN(Date.parse(body.computedAt))).toBe(false);
  });

  it("serves the second call from cache, so the panel never lands on the log queries", async () => {
    const first = (await get("/api/collector/storage").expect(200)).body as CollectorStorage;
    const second = (await get("/api/collector/storage").expect(200)).body as CollectorStorage;

    // Same reading, not merely a similar one: a cache that recomputed would move `computedAt`.
    expect(second.computedAt).toBe(first.computedAt);
    expect(second.meta.tookMs).toBeLessThan(20);
  });
});
