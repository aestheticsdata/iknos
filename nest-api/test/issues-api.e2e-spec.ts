import { randomUUID } from "node:crypto";
import { CSRF_HEADER } from "@auth/session.guard";
import { PrismaService } from "@db/prisma.service";
import { GrouperService, SETTLE_MS } from "@issues/grouper.service";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, login } from "./helpers";

import type { IssueDetail } from "@contracts/issue-detail";
import type { IssueCounts, IssuePage } from "@contracts/issue-page";
import type { OccurrenceSeries } from "@contracts/occurrence-series";
import type { SearchResults } from "@contracts/search";
import type { INestApplication } from "@nestjs/common";

/**
 * IKN-14's read and write routes, against the real MySQL.
 *
 * The grouping itself is proven in `issue-grouping.e2e-spec.ts`; this suite starts from rows that
 * are already grouped and asks what the API does with them — which is where the interesting
 * claims are: that the segment counts agree with the segments, that the keyset walks the list
 * without gaps or repeats under three different sorts, that a mutation without a CSRF token is
 * refused, and that the sparkline is drawn from occurrences rather than from sample rows.
 *
 * **Every row this suite writes carries a service name nobody else uses**, and every request
 * scopes to it, so it neither reads nor deletes anything the local collector has grouped.
 */

const SERVICE = `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const HOUR = 3_600_000;

let app: INestApplication;
let cookie: string;
let csrfToken: string;
let prisma: PrismaService;

/** A deterministic sixteen-hex fingerprint per index — the shape the routes validate. */
const fp = (i: number) => `beef${String(i).padStart(4, "0")}cafe0000`.slice(0, 16);

type Seeded = {
  i: number;
  /** Occurrences, and the value `event_count` carries. */
  count: number;
  /** Hours before now. */
  lastAgo: number;
  firstAgo: number;
  status?: string;
  regression?: boolean;
  type?: string | null;
};

async function seedIssue(s: Seeded): Promise<number> {
  const now = Date.now();
  const lastSeen = new Date(now - s.lastAgo * HOUR);

  const issue = await prisma.issue.create({
    data: {
      fingerprint: fp(s.i),
      service: SERVICE,
      type: s.type === undefined ? `Error${s.i}` : s.type,
      message: `something went wrong ${s.i}`,
      culprit: `f${s.i} (dist/a.js:${s.i})`,
      level: 50,
      levelName: "error",
      status: s.status ?? "unresolved",
      regression: s.regression ?? false,
      firstSeen: new Date(now - s.firstAgo * HOUR),
      lastSeen,
      eventCount: s.count,
      sample: { ts: lastSeen.toISOString(), traceId: "a".repeat(32), stack: `Error${s.i}: boom\n    at f (a.js:1:2)` },
    },
  });

  // One sample row standing for the whole count — exactly what the grouper writes, and the reason
  // `SUM(count)` and `COUNT(*)` are different numbers here.
  await prisma.issueEvent.create({
    data: {
      ts: lastSeen,
      issueId: issue.id,
      service: SERVICE,
      traceId: "a".repeat(32),
      message: `something went wrong ${s.i}`,
      stack: `Error${s.i}: boom\n    at f (a.js:1:2)`,
      count: s.count,
    },
  });

  return issue.id;
}

async function wipe(): Promise<void> {
  const mine = await prisma.issue.findMany({ where: { service: SERVICE }, select: { id: true } });
  if (mine.length > 0) {
    await prisma.issueEvent.deleteMany({ where: { issueId: { in: mine.map((one) => one.id) } } });
  }
  await prisma.issue.deleteMany({ where: { service: SERVICE } });
  await prisma.logEntry.deleteMany({ where: { service: SERVICE } });
}

const get = (url: string) => request(app.getHttpServer()).get(url).set("Cookie", cookie);
const post = (url: string) => request(app.getHttpServer()).post(url).set("Cookie", cookie).set(CSRF_HEADER, csrfToken);

const scope = `service=${SERVICE}`;

beforeAll(async () => {
  app = await buildTestApp();
  prisma = app.get(PrismaService);
  cookie = await login(app);
  csrfToken = (await get("/api/csrf").expect(200)).body.csrfToken as string;

  await wipe();
  // Four unresolved, one resolved, one ignored. Volumes and ages deliberately disagree with each
  // other, so a sort reading the wrong column cannot pass by coincidence.
  await seedIssue({ i: 1, count: 1_204, lastAgo: 0.1, firstAgo: 200 });
  await seedIssue({ i: 2, count: 3, lastAgo: 1, firstAgo: 2 });
  await seedIssue({ i: 3, count: 88, lastAgo: 5, firstAgo: 400, regression: true });
  await seedIssue({ i: 4, count: 12, lastAgo: 30, firstAgo: 31 });
  await seedIssue({ i: 5, count: 7, lastAgo: 40, firstAgo: 41, status: "resolved" });
  await seedIssue({ i: 6, count: 9, lastAgo: 50, firstAgo: 51, status: "ignored" });
});

afterAll(async () => {
  await wipe();
  await app?.close();
});

describe("session", () => {
  it("refuses every issue route to a caller with no cookie", async () => {
    const server = request(app.getHttpServer());

    await server.get("/api/issues").expect(401);
    await server.get("/api/issues/counts").expect(401);
    await server.get(`/api/issues/${fp(1)}`).expect(401);
    await server.get(`/api/issues/${fp(1)}/occurrences`).expect(401);
    await server.post(`/api/issues/${fp(1)}/resolve`).expect(401);
  });
});

describe("GET /api/issues", () => {
  it("returns the issues of a service, most recent first", async () => {
    const { body } = await get(`/api/issues?${scope}`).expect(200);
    const page = body as IssuePage;

    expect(page.rows.map((row) => row.fingerprint)).toEqual([fp(1), fp(2), fp(3), fp(4), fp(5), fp(6)]);
    expect(page.nextCursor).toBeNull();
  });

  it("names the issue by its fingerprint and never by its row id", async () => {
    const { body } = await get(`/api/issues?${scope}&limit=1`).expect(200);
    const [row] = (body as IssuePage).rows;

    expect(row.fingerprint).toBe(fp(1));
    expect(row).not.toHaveProperty("id");
    // The pair that lets a reader recognise an error without opening it.
    expect(row.type).toBe("Error1");
    expect(row.culprit).toBe("f1 (dist/a.js:1)");
    expect(row.eventCount).toBe(1_204);
    expect(row.status).toBe("unresolved");
    expect(row.regression).toBe(false);
    // ISO-8601, not a Date and not a local-time-flavoured string.
    expect(row.firstSeen).toMatch(/Z$/);
    expect(new Date(row.lastSeen).getTime()).toBeGreaterThan(new Date(row.firstSeen).getTime());
    // No release marker exists yet, and the column shows `—` rather than disappearing.
    expect(row.lastRelease).toBeNull();
  });

  it("narrows to one segment", async () => {
    const unresolved = await get(`/api/issues?${scope}&status=unresolved`).expect(200);
    expect((unresolved.body as IssuePage).rows.map((r) => r.fingerprint)).toEqual([fp(1), fp(2), fp(3), fp(4)]);

    const resolved = await get(`/api/issues?${scope}&status=resolved`).expect(200);
    expect((resolved.body as IssuePage).rows.map((r) => r.fingerprint)).toEqual([fp(5)]);
  });

  it("refuses a status that is not a segment", async () => {
    // Strict where `sort` is lenient: a filter that quietly stops filtering shows every issue
    // under a control claiming to narrow them.
    await get(`/api/issues?${scope}&status=open`).expect(400);
  });

  it("sorts by volume and by first appearance", async () => {
    const volume = await get(`/api/issues?${scope}&sort=volume`).expect(200);
    expect((volume.body as IssuePage).rows.map((r) => r.eventCount)).toEqual([1_204, 88, 12, 9, 7, 3]);

    const first = await get(`/api/issues?${scope}&sort=first`).expect(200);
    expect((first.body as IssuePage).rows.map((r) => r.fingerprint)).toEqual([
      fp(2),
      fp(4),
      fp(5),
      fp(6),
      fp(1),
      fp(3),
    ]);
  });

  it("falls back to the default sort rather than refusing an unknown one", async () => {
    const { body } = await get(`/api/issues?${scope}&sort=whatever`).expect(200);
    expect((body as IssuePage).rows[0].fingerprint).toBe(fp(1));
  });

  it("paginates without gaps or repeats, under every sort", async () => {
    for (const sort of ["last", "first", "volume"]) {
      const seen: string[] = [];
      let cursor: string | null = null;

      do {
        const url = `/api/issues?${scope}&sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
        const page = (await get(url).expect(200)).body as IssuePage;
        seen.push(...page.rows.map((row) => row.fingerprint));
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(seen).size, sort).toBe(6);
      expect(seen.length, sort).toBe(6);
    }
  });

  it("treats a cursor that will not decode as the first page", async () => {
    // It comes off a URL: a truncated copy-paste means "start from the top", not a 400.
    const { body } = await get(`/api/issues?${scope}&cursor=not-a-cursor`).expect(200);
    expect((body as IssuePage).rows[0].fingerprint).toBe(fp(1));
  });

  it("draws the sparkline from occurrences rather than from sample rows", async () => {
    const { body } = await get(`/api/issues?${scope}&limit=1`).expect(200);
    const page = body as IssuePage;
    const [row] = page.rows;

    // Every row shares one axis, so the sparklines are comparable.
    expect(row.spark).toHaveLength((+new Date(page.spark.to) - +new Date(page.spark.from)) / page.spark.bucketMs);
    // One sample row stands for 1204 throws. Counting rows would have drawn a bar of height 1.
    expect(Math.max(...row.spark)).toBe(1_204);
    expect(row.spark.reduce((a, b) => a + b, 0)).toBe(1_204);
  });

  it("gives an issue with nothing in the window a flat line rather than no line", async () => {
    // fp(4) last threw thirty hours ago and is inside the 48 h axis; fp(6) at fifty is outside it.
    const { body } = await get(`/api/issues?${scope}&status=ignored`).expect(200);
    const [row] = (body as IssuePage).rows;

    expect(row.spark.length).toBeGreaterThan(0);
    expect(Math.max(...row.spark)).toBe(0);
  });
});

describe("GET /api/issues/counts", () => {
  it("counts each segment, and the counts match what each segment returns", async () => {
    const counts = (await get(`/api/issues/counts?${scope}`).expect(200)).body as IssueCounts;
    expect(counts).toEqual({ unresolved: 4, resolved: 1, ignored: 1 });

    for (const status of ["unresolved", "resolved", "ignored"] as const) {
      const page = (await get(`/api/issues?${scope}&status=${status}`).expect(200)).body as IssuePage;
      expect(page.rows).toHaveLength(counts[status]);
    }
  });

  it("is reached before the fingerprint route swallows it", async () => {
    // `counts` is a literal segment declared above `:fingerprint`. Registered the other way round
    // it would be read as a fingerprint and answer 400.
    const { body } = await get(`/api/issues/counts?${scope}`).expect(200);
    expect(body).toHaveProperty("unresolved");
  });
});

describe("GET /api/issues/:fingerprint", () => {
  it("returns the row widened with the latest stack", async () => {
    const { body } = await get(`/api/issues/${fp(3)}`).expect(200);
    const detail = body as IssueDetail;

    expect(detail.fingerprint).toBe(fp(3));
    expect(detail.regression).toBe(true);
    expect(detail.latest?.stack).toContain("at f (a.js:1:2)");
    // The point of the modal: the request that produced the error is one link away, and the link
    // needs both the trace id and an instant to bound its window with.
    expect(detail.latest?.traceId).toBe("a".repeat(32));
    expect(detail.latest?.ts).toMatch(/Z$/);
  });

  it("404s a fingerprint that is not there and 400s one that could not be", async () => {
    await get(`/api/issues/${"0".repeat(16)}`).expect(404);
    await get("/api/issues/nope").expect(400);
    await get(`/api/issues/${"f".repeat(17)}`).expect(400);
  });
});

describe("GET /api/issues/:fingerprint/occurrences", () => {
  it("covers the default window with no gaps and sums the real occurrences", async () => {
    const { body } = await get(`/api/issues/${fp(1)}/occurrences`).expect(200);
    const series = body as OccurrenceSeries;

    expect(+new Date(series.to) - +new Date(series.from)).toBe(48 * HOUR);
    expect(series.counts).toHaveLength((48 * HOUR) / series.bucketMs);
    expect(series.counts.reduce((a, b) => a + b, 0)).toBe(1_204);
    // A quiet interval is a zero, so the axis stays the window that was asked for.
    expect(series.counts.filter((n) => n === 0).length).toBeGreaterThan(0);
  });

  it("accepts an explicit range and refuses one that is not a range", async () => {
    const from = new Date(Date.now() - 2 * HOUR).toISOString();
    const to = new Date().toISOString();

    const { body } = await get(`/api/issues/${fp(1)}/occurrences?from=${from}&to=${to}`).expect(200);
    expect((body as OccurrenceSeries).counts.reduce((a, b) => a + b, 0)).toBe(1_204);

    await get(`/api/issues/${fp(1)}/occurrences?from=${to}&to=${from}`).expect(400);
  });

  it("404s an unknown fingerprint", async () => {
    await get(`/api/issues/${"0".repeat(16)}/occurrences`).expect(404);
  });
});

describe("the state changes", () => {
  it("refuses a mutation with no csrf token", async () => {
    // The global guard demands it on every unsafe method — nothing in the controller asks for it.
    await request(app.getHttpServer())
      .post(`/api/issues/${fp(2)}/resolve`)
      .set("Cookie", cookie)
      .expect(403);
  });

  it("resolves, ignores and reopens", async () => {
    await post(`/api/issues/${fp(2)}/resolve`).expect(201, { ok: true });
    expect((await get(`/api/issues/${fp(2)}`).expect(200)).body.status).toBe("resolved");

    await post(`/api/issues/${fp(2)}/ignore`).expect(201);
    expect((await get(`/api/issues/${fp(2)}`).expect(200)).body.status).toBe("ignored");

    await post(`/api/issues/${fp(2)}/reopen`).expect(201);
    expect((await get(`/api/issues/${fp(2)}`).expect(200)).body.status).toBe("unresolved");
  });

  it("clears the regression flag when the issue is resolved", async () => {
    // The flag means "this came back after someone said it was handled" — a fact about the episode
    // that resolving ends. The grouper sets it again the moment the error recurs.
    expect((await get(`/api/issues/${fp(3)}`).expect(200)).body.regression).toBe(true);

    await post(`/api/issues/${fp(3)}/resolve`).expect(201);
    const after = (await get(`/api/issues/${fp(3)}`).expect(200)).body as IssueDetail;
    expect(after.status).toBe("resolved");
    expect(after.regression).toBe(false);

    await post(`/api/issues/${fp(3)}/reopen`).expect(201);
  });

  it("is idempotent rather than a 404 on the second click", async () => {
    await post(`/api/issues/${fp(4)}/ignore`).expect(201);
    await post(`/api/issues/${fp(4)}/ignore`).expect(201, { ok: true });
    await post(`/api/issues/${fp(4)}/reopen`).expect(201);
  });

  it("404s an unknown fingerprint and 400s a malformed one", async () => {
    await post(`/api/issues/${"0".repeat(16)}/resolve`).expect(404);
    await post("/api/issues/nope/resolve").expect(400);
  });
});

describe("GET /api/issues/for-log/:id", () => {
  /** Wide enough that the assertions do not depend on when the suite happens to run. */
  const WIDE = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

  /**
   * The one place this suite goes through the grouper rather than seeding `issue` directly: the
   * claim is that a line and its issue agree on a fingerprint, and seeding both by hand would be
   * asserting that two constants in this file match each other.
   */
  const seedThrow = async (): Promise<bigint[]> => {
    const at = Date.now() - (SETTLE_MS + 60_000);
    const lines = [
      "TypeError: cannot read 'siret' of undefined",
      "    at normalize (/var/www/pfa/nest-api/dist/dossiers/normalize.js:88:14)",
      "    at map (<anonymous>)",
    ];

    const ids: bigint[] = [];
    for (const [i, message] of lines.entries()) {
      const written = await prisma.logEntry.create({
        data: { ts: new Date(at + i), service: SERVICE, level: 50, levelName: "error", message, traceId: null },
      });
      ids.push(written.id);
    }

    await new GrouperService(prisma).pass(Date.now());
    return ids;
  };

  it("opens the issue from any row of the stack that produced it", async () => {
    const [head, frame, tail] = await seedThrow();

    const opened = (await get(`/api/issues/for-log/${head}?${WIDE}`).expect(200)).body as IssueDetail;
    expect(opened.type).toBe("TypeError");
    expect(opened.service).toBe(SERVICE);

    // The row a reader's cursor is on is as likely to be a frame as the header — and a frame on
    // its own was never an issue, so this is the case the resolver exists for.
    for (const id of [frame, tail]) {
      const same = (await get(`/api/issues/for-log/${id}?${WIDE}`).expect(200)).body as IssueDetail;
      expect(same.fingerprint).toBe(opened.fingerprint);
    }
  });

  it("404s a line that is not part of a grouped error, and one that is not there", async () => {
    const quiet = await prisma.logEntry.create({
      data: {
        ts: new Date(Date.now() - 60_000),
        service: SERVICE,
        level: 30,
        levelName: "info",
        message: "listening on :3000",
        traceId: null,
      },
    });

    await get(`/api/issues/for-log/${quiet.id}?${WIDE}`).expect(404);
    await get(`/api/issues/for-log/999999999999?${WIDE}`).expect(404);
  });

  it("refuses a request with no time range", async () => {
    // `log_entry` is keyed on `(id, ts)` across day partitions — an id alone names no partition.
    await get("/api/issues/for-log/1").expect(400);
    await get(`/api/issues/for-log/nope?${WIDE}`).expect(400);
  });
});

describe("the palette", () => {
  it("offers an issue by its fingerprint prefix, its type and its message", async () => {
    const window = "from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z";

    for (const term of [fp(1).slice(0, 8), "Error1", "went wrong 1"]) {
      const { body } = await get(`/api/search?q=${encodeURIComponent(term)}&${window}`).expect(200);
      const hit = (body as SearchResults).hits.find((one) => one.value === fp(1));

      expect(hit, term).toBeDefined();
      expect(hit?.type).toBe("issue");
      expect(hit?.hint).toBe("1204 occurrences");
    }
  });
});
