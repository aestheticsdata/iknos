import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, deleteLogs, login, seedLogs } from "./helpers";

import type { SearchResults } from "@contracts/search";
import type { INestApplication } from "@nestjs/common";

/**
 * The ⌘K palette's route, against the real MySQL (IKN-22).
 *
 * `log_entry` is the one table these suites do not own — the local collector may be writing to it
 * while they run — so every assertion below looks for the seeded rows inside the results rather
 * than asserting on the whole list.
 */

/** The window `seedLogs` puts its default rows in: 2026-08-09, around noon UTC. */
const WINDOW = "from=2026-08-09T11:00:00Z&to=2026-08-09T13:00:00Z";

let app: INestApplication;
let cookie: string;
const seeded: string[] = [];

beforeAll(async () => {
  app = await buildTestApp();
  cookie = await login(app);
});

afterAll(async () => {
  await deleteLogs(app, seeded);
  await app?.close();
});

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);

const track = async (...args: Parameters<typeof seedLogs>) => {
  const service = await seedLogs(...args);
  seeded.push(service);
  return service;
};

describe("session", () => {
  it("refuses the palette to a caller with no cookie", async () => {
    // The route names services, paths and trace ids — a map of what runs on the host.
    await request(app.getHttpServer()).get(`/api/search?q=api&${WINDOW}`).expect(401);
  });
});

describe("GET /api/search", () => {
  it("rejects a query with no time range", async () => {
    // Two of the three sources group over the partitioned table. A missing range is a full scan.
    await get("/api/search?q=api").expect(400);
    await get("/api/search?q=api&from=2026-08-09T00:00:00Z").expect(400);
  });

  it("says nothing for a term too short to mean anything", async () => {
    // One character matches most of the table and answers with five arbitrary rows.
    const body = (await get(`/api/search?q=a&${WINDOW}`).expect(200)).body as SearchResults;
    expect(body.hits).toEqual([]);
  });

  it("answers with an empty list rather than an error for a blank term", async () => {
    const body = (await get(`/api/search?${WINDOW}`).expect(200)).body as SearchResults;
    expect(body.hits).toEqual([]);
  });

  it("finds routes in the window, busiest first, with their counts", async () => {
    await track(app, 9, { route: (i) => (i < 6 ? "/api/palette/busy" : "/api/palette/quiet") });

    const body = (await get(`/api/search?q=/api/palette&${WINDOW}`).expect(200)).body as SearchResults;
    const routes = body.hits.filter((h) => h.type === "route" && h.value.startsWith("/api/palette"));

    expect(routes.map((h) => h.value)).toEqual(["/api/palette/busy", "/api/palette/quiet"]);
    expect(routes[0].hint).toBe("6 lines");
    expect(routes[1].hint).toBe("3 lines");
  });

  it("finds a trace by the prefix that is on screen in the table", async () => {
    await track(app, 4, { traceId: () => "abc123def456" });

    const body = (await get(`/api/search?q=abc123&${WINDOW}`).expect(200)).body as SearchResults;
    const trace = body.hits.find((h) => h.type === "trace" && h.value === "abc123def456");

    expect(trace).toBeDefined();
    expect(trace?.hint).toBe("4 lines");
  });

  it("does not match a trace id from the middle, which the index cannot serve", async () => {
    await track(app, 2, { traceId: () => "zzz987middle" });

    const body = (await get(`/api/search?q=987mid&${WINDOW}`).expect(200)).body as SearchResults;
    expect(body.hits.some((h) => h.type === "trace" && h.value === "zzz987middle")).toBe(false);
  });

  it("leaves rows outside the window alone", async () => {
    await track(app, 3, {
      route: () => "/api/palette/elsewhere",
      ts: () => new Date(Date.UTC(2026, 6, 1, 12, 0, 0)),
    });

    const body = (await get(`/api/search?q=/api/palette/elsewhere&${WINDOW}`).expect(200)).body as SearchResults;
    expect(body.hits).toEqual([]);
  });

  it("caps each type independently, so one busy source cannot crowd the others out", async () => {
    // Twelve distinct routes, all matching. Without a per-type cap these would fill the list.
    await track(app, 12, { route: (i) => `/api/capped/${i}` });

    const body = (await get(`/api/search?q=/api/capped&${WINDOW}`).expect(200)).body as SearchResults;
    expect(body.hits.filter((h) => h.type === "route")).toHaveLength(5);
  });

  it("treats a wildcard in the term as a literal, not as a pattern", async () => {
    await track(app, 2, { route: (i) => (i === 0 ? "/api/100%/off" : "/api/1000/off") });

    const body = (await get(`/api/search?q=${encodeURIComponent("/api/100%")}&${WINDOW}`).expect(200))
      .body as SearchResults;
    const routes = body.hits.filter((h) => h.type === "route").map((h) => h.value);

    // Unescaped, `%` would match `/api/1000/off` too — and someone searching for a literal path
    // would silently get a neighbour's rows.
    expect(routes).toContain("/api/100%/off");
    expect(routes).not.toContain("/api/1000/off");
  });

  it("answers inside the palette's latency budget", async () => {
    const body = (await get(`/api/search?q=/api&${WINDOW}`).expect(200)).body as SearchResults;
    expect(body.meta.tookMs).toBeLessThan(200);
  });
});
