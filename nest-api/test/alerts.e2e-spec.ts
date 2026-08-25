import { randomUUID } from "node:crypto";
import { AlertEngine } from "@alerts/alert-engine.service";
import { healthDown } from "@alerts/rules/health-down";
import { processRestart } from "@alerts/rules/process-restart";
import { CSRF_HEADER } from "@auth/session.guard";
import { PrismaService } from "@db/prisma.service";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { Observation, Rule, RuleContext } from "@alerts/rule";
import type { AlertHistory } from "@contracts/alert-history";
import type { AlertCounts, AlertPage } from "@contracts/alert-page";
import type { SignalsService } from "@metrics/signals.service";
import type { INestApplication } from "@nestjs/common";

/**
 * The engine's state machine and IKN-15's routes, against the real MySQL.
 *
 * The transition table itself is proven without a database in `src/alerts/reconcile.spec.ts`.
 * What is left is everything only MySQL can answer: that the generated `open_key` column really
 * does refuse a second open alert, that `occurrences` climbs on one row rather than spawning
 * twenty, that a resolved episode frees the key for the next one, and that the two rules with
 * non-trivial SQL — a window predicate and a counter difference — read what they claim to.
 *
 * **Every row this suite writes carries a service name nobody else uses**, and it deletes them on
 * the way in and out.
 */

const SERVICE = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const PM2 = `${SERVICE}-proc`;

let app: INestApplication;
let cookie: string;
let csrfToken: string;
let prisma: PrismaService;

/** A rule under the suite's control — `breach` is what the next pass will observe. */
let breach: Observation["breached"] = true;
let reading: number | null = 9;

const probe: Rule = {
  key: "health_down",
  severity: "critical",
  title: "Synthetic",
  expr: "synthetic > 0",
  forMs: 0,
  threshold: 1,
  unit: "count",
  evaluate: async (ctx: RuleContext) =>
    ctx.targets.filter((t) => t.name === SERVICE).map((t) => ({ service: t.name, value: reading, breached: breach })),
};

const withFor: Rule = { ...probe, key: "error_rate", severity: "warning", forMs: 60_000 };

/** Signals is never reached by the synthetic rules; the engine only needs the reference. */
const engine = (rules: Rule[]) => new AlertEngine(prisma, {} as SignalsService, { onFiring: async () => {} }, rules);

const alerts = () => prisma.alert.findMany({ where: { service: SERVICE }, orderBy: { id: "asc" } });

async function wipe(): Promise<void> {
  const mine = await prisma.alert.findMany({ where: { service: SERVICE }, select: { id: true } });
  if (mine.length > 0) {
    await prisma.alertStateChange.deleteMany({ where: { alertId: { in: mine.map((a) => a.id) } } });
  }
  await prisma.alert.deleteMany({ where: { service: SERVICE } });
  await prisma.healthCheck.deleteMany({ where: { service: SERVICE } });
  await prisma.processSample.deleteMany({ where: { pm2Name: PM2 } });
  await prisma.service.deleteMany({ where: { name: SERVICE } });
}

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);
const post = (url: string) => request(app.getHttpServer()).post(url).set("Cookie", cookie).set(CSRF_HEADER, csrfToken);

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  cookie = await login(app);
  csrfToken = (await get("/api/csrf").expect(200)).body.csrfToken as string;
});

beforeEach(async () => {
  await wipe();
  await prisma.service.create({
    data: { name: SERVICE, pm2Name: PM2, enabled: true, healthUrl: "http://127.0.0.1:1/health" },
  });
  breach = true;
  reading = 9;
});

afterAll(async () => {
  await wipe();
  await app?.close();
});

describe("the state machine, against MySQL", () => {
  it("opens one alert and keeps opening none", async () => {
    const now = Date.now();
    await engine([probe]).pass(now);
    await engine([probe]).pass(now + 60_000);
    await engine([probe]).pass(now + 120_000);

    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("firing");
    // Three passes saw it, and the page shows one line saying so.
    expect(rows[0].occurrences).toBe(3);
  });

  it("holds a for-rule pending, then promotes it", async () => {
    const now = Date.now();
    await engine([withFor]).pass(now);
    expect((await alerts())[0].state).toBe("pending");

    await engine([withFor]).pass(now + 59_000);
    expect((await alerts())[0].state).toBe("pending");

    await engine([withFor]).pass(now + 60_000);
    const [row] = await alerts();
    expect(row.state).toBe("firing");
    expect(row.firedAt).not.toBeNull();
    // `opened_at` is when the condition started, `fired_at` when it became an incident.
    expect(row.firedAt?.getTime()).toBeGreaterThan(row.openedAt.getTime());
  });

  it("resolves when the condition lifts, and opens a fresh episode when it returns", async () => {
    const now = Date.now();
    await engine([probe]).pass(now);

    breach = false;
    reading = 0;
    await engine([probe]).pass(now + 60_000);
    expect((await alerts())[0].resolvedAt).not.toBeNull();

    // The generated `open_key` went NULL with `resolved_at`, so the key is free again — and this
    // is a second incident, not a continuation of the first.
    breach = true;
    reading = 9;
    await engine([probe]).pass(now + 120_000);

    const rows = await alerts();
    expect(rows).toHaveLength(2);
    expect(rows[1].resolvedAt).toBeNull();
  });

  it("leaves an open alert alone when there is no reading", async () => {
    // The assertion the whole design turns on. A scrape outage answers `null` for every service at
    // once; treating that as "not breached" would close every alert on the box in one pass.
    const now = Date.now();
    await engine([probe]).pass(now);

    reading = null;
    breach = false;
    await engine([probe]).pass(now + 60_000);

    const [row] = await alerts();
    expect(row.resolvedAt).toBeNull();
    expect(row.state).toBe("firing");
    // Untouched, so not counted either — the pass had nothing to say about it.
    expect(row.occurrences).toBe(1);
  });

  it("writes a history row per transition and none for a pass that changed nothing", async () => {
    const now = Date.now();
    await engine([withFor]).pass(now);
    await engine([withFor]).pass(now + 30_000);
    await engine([withFor]).pass(now + 60_000);

    breach = false;
    reading = 0;
    await engine([withFor]).pass(now + 90_000);

    const [row] = await alerts();
    const band = await prisma.alertStateChange.findMany({
      where: { alertId: row.id },
      orderBy: { ts: "asc" },
    });

    // open → pending, pending → firing, firing → resolved. The pass that only bumped the counter
    // contributed nothing: the band records what the condition did, not how often it was asked.
    expect(band.map((one) => `${one.fromState ?? "-"}>${one.toState}`)).toEqual([
      "->pending",
      "pending>firing",
      "firing>resolved",
    ]);
  });

  it("keeps one rule's failure off the others", async () => {
    const angry: Rule = {
      ...probe,
      key: "no_logs",
      evaluate: async () => {
        throw new Error("boom");
      },
    };

    // The engine swallows it, logs it, and the healthy rule beside it still opens its alert.
    await expect(engine([angry, probe]).pass(Date.now())).resolves.toBeGreaterThan(0);
    expect(await alerts()).toHaveLength(1);
  });
});

describe("the rules that own real SQL", () => {
  it("health_down needs two failures inside the window", async () => {
    const now = Date.now();
    const probeAt = (ms: number, ok: boolean) =>
      prisma.healthCheck.create({ data: { ts: new Date(now - ms), service: SERVICE, ok, httpStatus: ok ? 200 : 503 } });

    await probeAt(20_000, false);
    await engine([healthDown]).pass(now);
    expect(await alerts()).toHaveLength(0);

    await probeAt(50_000, false);
    await engine([healthDown]).pass(now);

    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("critical");
    expect(rows[0].value).toBe(2);
  });

  it("health_down says nothing about a service nobody probed", async () => {
    // Not healthy, not down — unprobed. A zero here would report every unprobed service as fine.
    await engine([healthDown]).pass(Date.now());
    expect(await alerts()).toHaveLength(0);
  });

  it("process_restart differences the counter and survives a reset", async () => {
    const now = Date.now();
    const sample = (ms: number, restarts: number) =>
      prisma.processSample.create({
        data: { ts: new Date(now - ms), pm2Name: PM2, status: "online", restarts },
      });

    // A single sample cannot be differenced — that is "unknown", not "no restarts".
    await sample(300_000, 7);
    await engine([processRestart]).pass(now);
    expect(await alerts()).toHaveLength(0);

    await sample(60_000, 9);
    await engine([processRestart]).pass(now);
    expect((await alerts())[0].value).toBe(2);
  });

  it("process_restart reads a counter that went backwards as restarts since the reset", async () => {
    const now = Date.now();
    // pm2 delete + re-add: the counter drops. MAX-MIN would report 40 restarts that never happened.
    await prisma.processSample.create({
      data: { ts: new Date(now - 300_000), pm2Name: PM2, status: "online", restarts: 42 },
    });
    await prisma.processSample.create({
      data: { ts: new Date(now - 60_000), pm2Name: PM2, status: "online", restarts: 3 },
    });

    await engine([processRestart]).pass(now);
    expect((await alerts())[0].value).toBe(3);
  });
});

describe("the routes", () => {
  it("refuses every alert route to a caller with no cookie", async () => {
    const server = request(app.getHttpServer());
    await server.get("/api/alerts").expect(401);
    await server.get("/api/alerts/counts").expect(401);
    await server.get("/api/alerts/1").expect(401);
    await server.post("/api/alerts/1/ack").expect(401);
  });

  it("lists, counts, details and bands one alert", async () => {
    await engine([probe]).pass(Date.now());
    const [row] = await alerts();

    const page = (await get(`/api/alerts?service=${SERVICE}`).expect(200)).body as AlertPage;
    expect(page.rows.map((r) => r.id)).toEqual([row.id]);
    expect(page.rows[0].expr).toBe("synthetic > 0");
    // The cadence travels as data — the modal never restates it.
    expect(page.evalIntervalMs).toBe(60_000);

    const counts = (await get(`/api/alerts/counts?service=${SERVICE}`).expect(200)).body as AlertCounts;
    expect(counts).toEqual({ critical: 1, warning: 0, info: 0 });

    expect((await get(`/api/alerts/${row.id}`).expect(200)).body.ruleKey).toBe("health_down");

    const band = (await get(`/api/alerts/${row.id}/history`).expect(200)).body as AlertHistory;
    expect(band.transitions).toHaveLength(1);
    expect(band.transitions[0].to).toBe("firing");
  });

  it("takes an acknowledged alert out of the default view and out of the counts", async () => {
    await engine([probe]).pass(Date.now());
    const [row] = await alerts();

    await post(`/api/alerts/${row.id}/ack`).expect(201, { ok: true });

    expect(((await get(`/api/alerts?service=${SERVICE}`).expect(200)).body as AlertPage).rows).toHaveLength(0);
    expect((await get(`/api/alerts/counts?service=${SERVICE}`).expect(200)).body.critical).toBe(0);
    // Still open, still true, and still in the history — acking is not resolving.
    const acked = (await get(`/api/alerts?service=${SERVICE}&state=acked`).expect(200)).body as AlertPage;
    expect(acked.rows).toHaveLength(1);
    expect(acked.rows[0].resolvedAt).toBeNull();
  });

  it("silences for an hour, and the alert comes back by itself when it lapses", async () => {
    await engine([probe]).pass(Date.now());
    const [row] = await alerts();

    await post(`/api/alerts/${row.id}/silence`).expect(201);
    expect(((await get(`/api/alerts?service=${SERVICE}`).expect(200)).body as AlertPage).rows).toHaveLength(0);

    // No job expires it — the read filters on the timestamp, so moving it into the past is exactly
    // what the passage of an hour does.
    await prisma.alert.update({ where: { id: row.id }, data: { silencedUntil: new Date(Date.now() - 1000) } });
    expect(((await get(`/api/alerts?service=${SERVICE}`).expect(200)).body as AlertPage).rows).toHaveLength(1);
  });

  it("resolves by hand, and the engine opens a new episode rather than reviving it", async () => {
    const now = Date.now();
    await engine([probe]).pass(now);
    const [row] = await alerts();

    await post(`/api/alerts/${row.id}/resolve`).expect(201);
    expect((await get(`/api/alerts/${row.id}`).expect(200)).body.state).toBe("resolved");

    await engine([probe]).pass(now + 60_000);
    const rows = await alerts();
    expect(rows).toHaveLength(2);
    expect(rows[1].id).not.toBe(row.id);
  });

  it("refuses a mutation with no csrf token", async () => {
    await engine([probe]).pass(Date.now());
    const [row] = await alerts();

    await request(app.getHttpServer()).post(`/api/alerts/${row.id}/ack`).set("Cookie", cookie).expect(403);
  });

  it("400s a bad state filter and 404s an alert that is not there", async () => {
    await get("/api/alerts?state=whatever").expect(400);
    await get("/api/alerts/999999999").expect(404);
    await get("/api/alerts/nope").expect(400);
  });
});
