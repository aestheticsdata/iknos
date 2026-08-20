import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaService } from "@db/prisma.service";
import { INGEST_TOKEN_HEADER } from "@ingest/http-ingest.controller";
import { MAX_EVENTS_PER_REQUEST } from "@ingest/http-ingest.service";
import { LogBus } from "@stream/log-bus";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, clearRateLimits, deleteLogs, login } from "./helpers";

import type { LogRecord } from "@ingest/log-record";
import type { INestApplication } from "@nestjs/common";

/**
 * `POST /api/ingest` — the browser's way in (IKN-29).
 *
 * The token and the origin list are read once when the controller is constructed, so both are
 * placed in the environment before the app is built. `fileParallelism` is off, so no other suite
 * observes them.
 */

const TOKEN = "test-ingest-token-long-enough";
const ALLOWED_ORIGIN = "https://iknos.test";

let app: INestApplication;
let prisma: PrismaService;
let service: string;
const seeded: string[] = [];

const event = (over: Record<string, unknown> = {}) => ({
  "@timestamp": "2026-08-09T12:00:00.000Z",
  "log.level": "error",
  message: "TypeError: undefined is not a function",
  "url.path": "/dossiers/8821",
  "trace.id": "b7e41c02a9d3",
  ...over,
});

const post = (body: object) =>
  request(app.getHttpServer()).post("/api/ingest").set(INGEST_TOKEN_HEADER, TOKEN).send(body);

beforeAll(async () => {
  process.env.IKNOS_INGEST_TOKEN = TOKEN;
  process.env.IKNOS_INGEST_ORIGINS = `${ALLOWED_ORIGIN}, https://pfa.test`;

  app = await buildTestApp();
  prisma = app.get(PrismaService);
  await clearRateLimits(app);

  service = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  seeded.push(service);
  await prisma.service.create({ data: { name: service, pm2Name: service } });
});

afterAll(async () => {
  await deleteLogs(app, seeded);
  await prisma?.service.deleteMany({ where: { name: { in: seeded } } });
  await app?.close();

  // `delete`, never `= undefined`: assigning undefined to a `process.env` entry stores the
  // *string* "undefined", which is nine characters and would fail the token's length rule at the
  // next boot — with a message about a variable nobody thought they had set.
  delete process.env.IKNOS_INGEST_TOKEN;
  delete process.env.IKNOS_INGEST_ORIGINS;
});

describe("POST /api/ingest", () => {
  describe("who may write", () => {
    it("refuses a request with no token", async () => {
      await request(app.getHttpServer()).post("/api/ingest").send({ service, events: [] }).expect(401);
    });

    it("refuses a wrong token", async () => {
      await request(app.getHttpServer())
        .post("/api/ingest")
        .set(INGEST_TOKEN_HEADER, `${TOKEN.slice(0, -1)}X`)
        .send({ service, events: [] })
        .expect(401);
    });

    it("does not demand a session, and does not demand a CSRF token either", async () => {
      // The whole point: a page on another domain has neither and never will. If this ever
      // starts answering 401 or 403 to a valid token, `@Public()` has been lost.
      await post({ service, events: [] }).expect(202);
    });

    it("refuses a service the registry does not know", async () => {
      await post({ service: "not-a-registered-service", events: [event()] }).expect(400);
    });

    it("refuses a service that exists but is disabled", async () => {
      const off = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      seeded.push(off);
      await prisma.service.create({ data: { name: off, pm2Name: off, enabled: false } });

      // Disabling a service has to stop its writes, not merely hide it from the filter list.
      await post({ service: off, events: [event()] }).expect(400);
      expect(await prisma.logEntry.count({ where: { service: off } })).toBe(0);
    });
  });

  describe("origin", () => {
    it("accepts an allowed origin", async () => {
      await post({ service, events: [] }).set("Origin", ALLOWED_ORIGIN).expect(202);
    });

    it("refuses an origin off the list", async () => {
      await post({ service, events: [] }).set("Origin", "https://evil.test").expect(403);
    });

    it("accepts a caller that sent no origin at all", async () => {
      // curl, or a pino HTTP transport. Demanding an Origin would lock out every non-browser.
      await post({ service, events: [] }).expect(202);
    });
  });

  describe("what gets stored", () => {
    it("produces the same columns a tailed line would", async () => {
      const res = await post({ service, events: [event()] }).expect(202);
      expect(res.body).toEqual({ accepted: 1, rejected: 0 });

      const row = await prisma.logEntry.findFirst({ where: { service }, orderBy: { id: "desc" } });

      // Promoted exactly as the collector promotes them — same parser, so this cannot drift.
      expect(row?.level).toBe(50);
      expect(row?.levelName).toBe("error");
      expect(row?.message).toBe("TypeError: undefined is not a function");
      expect(row?.route).toBe("/dossiers/8821");
      expect(row?.traceId).toBe("b7e41c02a9d3");
      expect(row?.ts.toISOString()).toBe("2026-08-09T12:00:00.000Z");
    });

    it("keeps unpromoted fields in attrs rather than dropping them", async () => {
      await post({
        service,
        events: [event({ message: "with extras", componentStack: "at <Rail>", release: "abc123" })],
      }).expect(202);

      const row = await prisma.logEntry.findFirst({ where: { service, message: "with extras" } });

      expect(row?.attrs).toMatchObject({ componentStack: "at <Rail>", release: "abc123" });
      // Never both a column and an attribute.
      expect(row?.attrs).not.toHaveProperty("message");
      expect(row?.attrs).not.toHaveProperty("log.level");
    });

    it("lets the rest of a batch through when one event is unusable", async () => {
      const marker = randomUUID().slice(0, 8);
      const res = await post({
        service,
        events: [event({ message: `first ${marker}` }), "not an object", null, event({ message: `last ${marker}` })],
      }).expect(202);

      // A malformed entry costs itself and nothing else — the same rule the collector applies to
      // a bad line, for the same reason.
      expect(res.body).toEqual({ accepted: 2, rejected: 2 });
      expect(await prisma.logEntry.count({ where: { service, message: { contains: marker } } })).toBe(2);
    });

    it("stores a bare event that is not ECS at all", async () => {
      // A front that just posts `{msg}` still gets a row. Degraded beats dropped.
      const res = await post({ service, events: [{ msg: "plain object, no ecs" }] }).expect(202);
      expect(res.body).toEqual({ accepted: 1, rejected: 0 });

      const row = await prisma.logEntry.findFirst({ where: { service, message: "plain object, no ecs" } });
      expect(row?.levelName).toBe("info");
    });

    it("refuses a batch above the ceiling", async () => {
      const events = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, (_, i) => event({ message: `over ${i}` }));
      await post({ service, events }).expect(400);

      expect(await prisma.logEntry.count({ where: { service, message: { startsWith: "over " } } })).toBe(0);
    });

    it("refuses a body that is not the expected shape", async () => {
      await post({ events: [event()] }).expect(400);
      await post({ service, events: "not an array" }).expect(400);
    });
  });

  /**
   * The preflight, for fronts on other domains (pfa-front is the first).
   *
   * JSON body + `X-Iknos-Token` make the POST non-simple, so the browser asks first. Without
   * these answers the report dies in the browser and the API never sees a byte — and the
   * reporter swallows failures by design, so the OPTIONS below is the only trace there would be.
   */
  describe("cross-origin", () => {
    it("answers the preflight for an allowed origin", async () => {
      const res = await request(app.getHttpServer())
        .options("/api/ingest")
        .set("Origin", ALLOWED_ORIGIN)
        .set("Access-Control-Request-Method", "POST")
        .expect(204);

      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-methods"]).toBe("POST");
      expect(res.headers["access-control-allow-headers"]).toContain("X-Iknos-Token");
    });

    it("answers the preflight for a disallowed origin without allowing it", async () => {
      const res = await request(app.getHttpServer())
        .options("/api/ingest")
        .set("Origin", "https://evil.test")
        .set("Access-Control-Request-Method", "POST")
        .expect(204);

      // 204 with no allow-origin: the browser blocks, and the page learns nothing more.
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("lets the page read the POST response from an allowed origin", async () => {
      const res = await post({ service, events: [] }).set("Origin", ALLOWED_ORIGIN).expect(202);
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    });

    it("leaves every other route without CORS", async () => {
      const res = await request(app.getHttpServer()).options("/api/logs").set("Origin", ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  /**
   * A browser cannot know its own address, so the API fills `client.ip` with the poster's — and
   * only when the event does not carry one (a server-side relay knows better than we do).
   */
  describe("the poster's address", () => {
    it("stamps the requester's IP on events that carry none", async () => {
      const marker = randomUUID().slice(0, 8);
      await post({ service, events: [event({ message: `noip ${marker}` })] })
        .set("X-Forwarded-For", "198.51.100.7")
        .expect(202);

      const row = await prisma.logEntry.findFirst({ where: { service, message: `noip ${marker}` } });
      expect(row?.clientIp).toBe("198.51.100.7");
    });

    it("keeps an explicit client.ip over the requester's", async () => {
      const marker = randomUUID().slice(0, 8);
      await post({ service, events: [event({ message: `hasip ${marker}`, "client.ip": "203.0.113.9" })] })
        .set("X-Forwarded-For", "198.51.100.7")
        .expect(202);

      const row = await prisma.logEntry.findFirst({ where: { service, message: `hasip ${marker}` } });
      expect(row?.clientIp).toBe("203.0.113.9");
    });
  });

  /**
   * Two ceilings govern one request, and they have to agree: the event count the controller
   * enforces, and the byte count the body parser enforces before the controller is ever reached.
   * Express defaults the second to 100 kB, which a full batch of stack traces clears easily — so
   * the batch the API advertises came back 413, and the client, silent by design, lost it whole.
   */
  describe("the body ceiling", () => {
    it("takes a full batch of a hundred events carrying real stack traces", async () => {
      // ~5 kB of stack each, so ~520 kB on the wire: comfortably over the 100 kB Express would
      // have allowed on its own, and comfortably under the megabyte now configured.
      const stack = Array.from(
        { length: 60 },
        (_, i) => `    at frame${i} (/app/.next/static/chunk-${i}.js:1:${i})`,
      ).join("\n");
      const events = Array.from({ length: MAX_EVENTS_PER_REQUEST }, (_, i) =>
        event({ message: `deep ${i}`, error: { type: "TypeError", message: `deep ${i}`, stack_trace: stack } }),
      );

      const res = await post({ service, events }).expect(202);
      expect(res.body).toEqual({ accepted: MAX_EVENTS_PER_REQUEST, rejected: 0 });
      expect(await prisma.logEntry.count({ where: { service, message: { startsWith: "deep " } } })).toBe(
        MAX_EVENTS_PER_REQUEST,
      );
    });

    it("refuses a body past the byte ceiling", async () => {
      // Rejected by the parser, so it never reaches the handler and the event count never applies:
      // one event is enough, as long as it is enormous.
      await post({ service, events: [event({ message: "too big", padding: "x".repeat(1_200_000) })] }).expect(413);

      expect(await prisma.logEntry.count({ where: { service, message: "too big" } })).toBe(0);
    });
  });

  describe("the live tail", () => {
    it("publishes ingested lines to the bus, after the commit", async () => {
      const bus = app.get(LogBus);
      const seen: LogRecord[] = [];
      const unsubscribe = bus.subscribe((record) => seen.push(record));

      try {
        const marker = randomUUID().slice(0, 8);
        await post({ service, events: [event({ message: `live ${marker}` })] }).expect(202);
        await sleep(50);

        const published = seen.filter((r) => r.message === `live ${marker}`);
        expect(published).toHaveLength(1);
        // Committed before it was published: the tail must never show a line a rollback undoes.
        expect(await prisma.logEntry.count({ where: { service, message: `live ${marker}` } })).toBe(1);
      } finally {
        unsubscribe();
      }
    });
  });

  describe("and it is still a log route", () => {
    it("is searchable through GET /api/logs like any other line", async () => {
      const marker = randomUUID().slice(0, 8);
      await post({ service, events: [event({ message: `searchable ${marker}` })] }).expect(202);

      const cookie = await login(app);
      const res = await request(app.getHttpServer())
        .get(`/api/logs?from=2026-08-09T00:00:00Z&to=2026-08-10T00:00:00Z&service=${service}&q=${marker}`)
        .set("Cookie", cookie)
        .expect(200);

      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].message).toBe(`searchable ${marker}`);
    });
  });
});

describe("POST /api/ingest with no token configured", () => {
  it("is closed, and says which of the two is missing", async () => {
    const saved = process.env.IKNOS_INGEST_TOKEN;
    delete process.env.IKNOS_INGEST_TOKEN;

    const closed = await buildTestApp();
    try {
      // 503 and not 401: an operator debugging this deserves to learn that the server has no
      // token, rather than being told theirs is wrong.
      await request(closed.getHttpServer())
        .post("/api/ingest")
        .set(INGEST_TOKEN_HEADER, TOKEN)
        .send({ service: "anything", events: [] })
        .expect(503);
    } finally {
      await closed.close();
      process.env.IKNOS_INGEST_TOKEN = saved;
    }
  });
});
