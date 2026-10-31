import { randomUUID } from "node:crypto";
import { PrismaService } from "@db/prisma.service";
import { persistBatch } from "@ingest/writer";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { SiteTraffic, TrafficOverview } from "@contracts/traffic";
import type { LogRecord } from "@ingest/log-record";
import type { INestApplication } from "@nestjs/common";

/**
 * The traffic routes end to end (IKN-83): a registered site, six access rows two hours back, and
 * the two reads that turn them into visitors.
 */

let app: INestApplication;
let prisma: PrismaService;
let cookie: string;

const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
const SITE = `traffic-site-${suffix}`;
const NOT_A_SITE = `traffic-app-${suffix}`;

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const READER_IP = "203.0.113.77";
const SCANNER_IP = "198.51.100.66";

const at = new Date(Date.now() - 2 * 3_600_000);
const from = new Date(+at - 3_600_000).toISOString();
const to = new Date(+at + 3_600_000).toISOString();
const WINDOW = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe/Paris`;

type Access = { route: string | null; status: number | null; ip: string | null; ua?: string; offset: number };

const access = ({ route, status, ip, ua = CHROME, offset }: Access): LogRecord => ({
  ts: new Date(+at + offset * 1000),
  service: SITE,
  level: 30,
  levelName: "info",
  logger: "nginx.access",
  message: `GET ${route} ${status}`,
  traceId: null,
  httpMethod: route === null ? null : "GET",
  route,
  statusCode: status,
  durationMs: null,
  clientIp: ip,
  userId: null,
  hostname: null,
  attrs: route === null ? null : { userAgent: ua, bytes: 500 },
});

const get = (path: string) => request(app.getHttpServer()).get(path).set("Cookie", cookie);

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  cookie = await login(app);

  await prisma.service.createMany({
    data: [
      { name: SITE, pm2Name: SITE, logGlob: `/var/log/nginx/${SITE}.access.log` },
      { name: NOT_A_SITE, pm2Name: NOT_A_SITE },
    ],
  });

  await persistBatch(
    prisma,
    [
      access({ route: "/", status: 200, ip: READER_IP, offset: 0 }),
      access({ route: "/about", status: 200, ip: READER_IP, offset: 5 }),
      access({ route: "/logo.svg", status: 200, ip: READER_IP, offset: 6 }),
      access({ route: "/", status: 200, ip: "66.249.66.1", ua: GOOGLEBOT, offset: 10 }),
      access({ route: "/wp-login.php", status: 404, ip: SCANNER_IP, offset: 20 }),
      // A line the parser could not read: every promoted column null.
      access({ route: null, status: null, ip: null, offset: 30 }),
    ],
    [],
  );
});

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: SITE } });
  await prisma.service.deleteMany({ where: { name: { in: [SITE, NOT_A_SITE] } } });
  await app.close();
});

describe("GET /api/services/:service/traffic", () => {
  it("turns the site's access rows into visitors, bots and scanners", async () => {
    const res = await get(`/api/services/${SITE}/traffic?${WINDOW}`).expect(200);
    const body = res.body as SiteTraffic;

    expect(body.service).toBe(SITE);
    expect(body.totals.pageViews).toBe(2);
    expect(body.totals.visitorDays).toBe(1);
    expect(body.totals.requests).toBe(5);
    expect(body.totals.bytes).toBe(2500);
    expect(body.bots[0].name).toBe("Googlebot");
    expect(body.scanners).toEqual({ requests: 1, addresses: 1 });
    expect(body.partial).toBe(false);
    expect(body.retentionDays).toBeGreaterThan(0);
    expect(body.meta.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("carries no client address", async () => {
    const res = await get(`/api/services/${SITE}/traffic?${WINDOW}`).expect(200);
    for (const ip of [READER_IP, SCANNER_IP, "66.249.66.1"]) expect(res.text).not.toContain(ip);
  });

  it("refuses a service with no access log, an unknown one, and a missing range", async () => {
    await get(`/api/services/${NOT_A_SITE}/traffic?${WINDOW}`).expect(422);
    await get(`/api/services/nope-${suffix}/traffic?${WINDOW}`).expect(404);
    await get(`/api/services/${SITE}/traffic?to=${encodeURIComponent(to)}`).expect(400);
  });

  it("refuses a span longer than the view can ask for", async () => {
    const wide = `from=2000-01-01T00:00:00Z&to=${encodeURIComponent(to)}`;
    await get(`/api/services/${SITE}/traffic?${wide}`).expect(400);
    await get(`/api/traffic?${wide}`).expect(400);
  });
});

describe("GET /api/traffic", () => {
  it("lists the site in the overview, and not the app", async () => {
    const res = await get(`/api/traffic?${WINDOW}`).expect(200);
    const body = res.body as TrafficOverview;

    const site = body.sites.find((s) => s.service === SITE);
    expect(site).toMatchObject({ visitorDays: 1, pageViews: 2, requests: 5 });
    expect(body.sites.some((s) => s.service === NOT_A_SITE)).toBe(false);
  });
});

describe("GET /api/services", () => {
  it("says which services are sites", async () => {
    const res = await get("/api/services").expect(200);
    const rows = res.body.services as { name: string; site: boolean }[];

    expect(rows.find((s) => s.name === SITE)?.site).toBe(true);
    expect(rows.find((s) => s.name === NOT_A_SITE)?.site).toBe(false);
  });
});
