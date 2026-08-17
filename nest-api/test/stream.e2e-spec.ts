import { randomUUID } from "node:crypto";
import { get as httpGet } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LogBus } from "../src/stream/log-bus";
import { buildTestApp, login } from "./helpers";

import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import type { LogRecord } from "../src/ingest/log-record";

/**
 * The live tail, over a real socket.
 *
 * supertest is no use past the request that opens the stream — these tests need a connection that
 * stays up, is read incrementally, and is then dropped — so the suite listens on an ephemeral
 * port and speaks to it with `node:http`.
 */

const WIDE = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

let app: INestApplication;
let bus: LogBus;
let cookie: string;
let port: number;
let server: Server;

/**
 * Polls until the bus holds exactly `n` listeners, or gives up.
 *
 * A client destroying its socket does not unsubscribe synchronously — the server learns about it
 * when the `close` event reaches the request. Reading the count immediately after `close()` is a
 * race, and one that fails in whichever direction the machine happened to be quick.
 *
 * Nothing else in the process subscribes to the bus, so the resting value is zero.
 */
async function waitForListeners(n: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && bus.listenerCount() !== n; attempt++) await sleep(20);
}

const record = (over: Partial<LogRecord> = {}): LogRecord => ({
  ts: new Date("2026-08-09T12:00:00.000Z"),
  service: "pfa-api",
  level: 30,
  levelName: "info",
  logger: null,
  message: "hello",
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  clientIp: null,
  userId: null,
  hostname: null,
  attrs: null,
  ...over,
});

/**
 * Every assertion scopes itself to a name nothing else uses.
 *
 * The collector is running inside this app — `AppModule` starts it — so the bus is not
 * necessarily quiet, and a test that counted every frame would be counting whatever the machine
 * happened to be logging.
 */
const uniqueService = () => `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;

type Frame = { event: string; data: string };

type Stream = {
  frames: Frame[];
  /** Stops reading without closing, so the server's write buffer fills. */
  pause: () => void;
  resume: () => void;
  close: () => void;
};

function openStream(path: string, headers: Record<string, string> = { Cookie: cookie }): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = httpGet({ port, path, headers }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`stream answered ${res.statusCode}`));
        return;
      }

      const frames: Frame[] = [];
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        // SSE frames are separated by a blank line. Comments (`: ping`) carry no `event:` and are
        // skipped, which is what a browser's EventSource does too.
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);

          const event = /^event: (.+)$/m.exec(frame)?.[1];
          if (event) frames.push({ event, data: /^data: (.*)$/m.exec(frame)?.[1] ?? "" });
        }
      });

      resolve({
        frames,
        pause: () => res.pause(),
        resume: () => res.resume(),
        close: () => req.destroy(),
      });
    });

    req.on("error", reject);
  });
}

beforeAll(async () => {
  app = await buildTestApp();
  bus = app.get(LogBus);
  cookie = await login(app);

  server = app.getHttpServer() as Server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  // `server.close()` waits for every open connection, and a suite about long-lived connections is
  // exactly the one that leaves some half-drained. Without this the teardown simply hangs.
  server?.closeAllConnections();
  await app?.close();
});

describe("GET /api/logs/stream", () => {
  it("requires a session", async () => {
    // The guard runs before the handler hijacks the response, so this is an ordinary 401 and not
    // a stream that opens and then complains.
    await request(app.getHttpServer()).get(`/api/logs/stream?${WIDE}`).expect(401);
  });

  it("requires a time range", async () => {
    await request(app.getHttpServer()).get("/api/logs/stream").set("Cookie", cookie).expect(400);
  });

  it("delivers a freshly written line", async () => {
    const service = uniqueService();
    const stream = await openStream(`/api/logs/stream?${WIDE}&service=${service}`);
    try {
      bus.emit(record({ service, message: "a line that was just written", statusCode: 500, durationMs: 12 }));
      await sleep(200);

      expect(stream.frames).toHaveLength(1);
      const row = JSON.parse(stream.frames[0]?.data ?? "{}");
      expect(stream.frames[0]?.event).toBe("log");
      expect(row.message).toBe("a line that was just written");
      expect(row.ts).toBe("2026-08-09T12:00:00.000Z");
      expect(row.statusCode).toBe(500);
      // No id: the row was published from memory and never read back.
      expect(row.id).toBe("");
    } finally {
      stream.close();
    }
  });

  it("applies the same filters as the search", async () => {
    const service = uniqueService();
    const stream = await openStream(`/api/logs/stream?${WIDE}&service=${service}&level=warn&q=TIMEOUT`);
    try {
      bus.emit(record({ service, message: "upstream timeout", level: 50 }));
      bus.emit(record({ service, message: "upstream timeout", level: 30 })); // below the level
      bus.emit(record({ service: uniqueService(), message: "upstream timeout", level: 50 })); // other service
      bus.emit(record({ service, message: "all good", level: 50 })); // no match on q
      await sleep(200);

      expect(stream.frames).toHaveLength(1);
      // `q` is compared case-insensitively, like the `LIKE` against a utf8mb4_unicode_ci column.
      expect(JSON.parse(stream.frames[0]?.data ?? "{}").message).toBe("upstream timeout");
    } finally {
      stream.close();
    }
  });

  it("unsubscribes from the bus when the client disconnects", async () => {
    await waitForListeners(0);

    const stream = await openStream(`/api/logs/stream?${WIDE}`);
    expect(bus.listenerCount()).toBe(1);

    stream.close();
    await waitForListeners(0);

    // Listeners piling up on requests that ended is the classic SSE leak, and it is invisible
    // until the process is out of memory.
    expect(bus.listenerCount()).toBe(0);
  });

  it("leaves nothing behind after a hundred connections", async () => {
    await waitForListeners(0);

    const streams = await Promise.all(Array.from({ length: 100 }, () => openStream(`/api/logs/stream?${WIDE}`)));
    expect(bus.listenerCount()).toBe(100);

    for (const stream of streams) stream.close();
    await waitForListeners(0);

    expect(bus.listenerCount()).toBe(0);
  });

  it("drops rather than buffers for a client that stops reading", async () => {
    const service = uniqueService();
    const stream = await openStream(`/api/logs/stream?${WIDE}&service=${service}`);
    try {
      stream.pause();
      // Big enough that the socket's buffer and Node's own queue both fill well before the end.
      const fat = record({ service, message: "x".repeat(2048) });

      const startedAt = performance.now();
      for (let i = 0; i < 5000; i++) bus.emit(fat);
      const elapsed = performance.now() - startedAt;

      // The point of the cap: publishing must stay a synchronous, bounded cost. If a stalled
      // browser tab could slow this loop down, it would be slowing down ingestion — the one thing
      // in this process that is not allowed to fall behind.
      expect(elapsed).toBeLessThan(2000);

      stream.resume();
      await sleep(300);

      // The gap marker rides on the next line that gets through, so there has to be one. That is
      // deliberate: a client that never receives anything again does not need to be told it
      // missed something.
      bus.emit(record({ service, message: "after the gap" }));
      await sleep(300);

      const logs = stream.frames.filter((f) => f.event === "log");
      const lagged = stream.frames.filter((f) => f.event === "lagged");

      expect(logs.length).toBeLessThan(5000);
      // And the client is told, so the view can draw a gap rather than imply continuity.
      expect(lagged).toHaveLength(1);
      expect(Number(lagged[0]?.data)).toBeGreaterThan(0);
      expect(JSON.parse(logs.at(-1)?.data ?? "{}").message).toBe("after the gap");
    } finally {
      stream.close();
    }
  });
});
