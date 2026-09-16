# Iknos M4 wave 1 — nginx ingestion and the landing page: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the collector a second ingestion source so nginx access logs land in `log_entry` beside PM2's, and put 1991computer.com in the service rail with both its browser errors and its visitor traffic.

**Architecture:** `Tailer` currently hard-codes two calls — a PM2 filename convention and the ECS JSON parser. Both move behind a `Source` interface of two methods, leaving today's behaviour as `Pm2Source` and adding `NginxSource`, which lists its files from the service registry rather than from a glob. One `Tailer` drives N sources into one `Writer`; rotation, offsets, backpressure and the live tail are untouched because they only ever dealt in `LogRecord`. The landing page, having no PM2 process, reaches the same table through the two doors that already exist: `POST /api/ingest` for JavaScript errors, and now its nginx access log for everything else.

**Tech Stack:** NestJS 11, Prisma 7 + `@prisma/adapter-mariadb`, MySQL 8 (day-partitioned `log_entry`), Vitest 4, Next 16 (`output: "export"`) for the landing page, PM2 and nginx on ks-b.

**Spec:** `docs/superpowers/specs/2026-09-16-iknos-m4-nginx-ingestion-design.md` — read it alongside this plan. §1 is the decisions table each task implements; §9 explains why this is far smaller than IKN-16 originally claimed.

**Tickets:** IKN-16 (tasks 1–4, 7), IKN-71 (tasks 5–6), under epic IKN-28.

## Global Constraints

- **Commits are the user's call.** Every task's commit step gives the message and the exact `git add` — **ask before running it**. A task is finished when its tests are green and the work is in the tree; the commit waits for a yes. This is a standing rule of this repo, not a property of this plan.
- Commits use the repo's configured git identity, with **no co-author or tool attribution trailers**.
- `pnpm check` and `pnpm typecheck` and `pnpm test` must pass before any commit is offered. Biome, `lineWidth: 120`.
- Path aliases everywhere (`@ingest/*`, `@db/*`, `@stream/*`, `@common/*`), never relative imports across directories. Inside `src/ingest/` the existing files import each other relatively (`./parser`, `./writer`) — match that.
- **Nothing in the ingestion path may block the event loop:** no sync file I/O, no `JSON.parse` on an unbounded line, **no backtracking regex over log text**. Every regex added here is anchored and built from negated character classes for that reason.
- **The writer already clamps every column** (`writer.ts:59-77`): `httpMethod` to 10, `route` to 255, `clientIp` to 45, `statusCode` to SMALLINT bounds. **Do not add clamping in the parser.** A scanner's 4 KB request target or a binary method is already incapable of poisoning a batch.
- `parse` never throws and never propagates. A line it cannot read becomes a `degraded` record, never an exception and never a silent drop.
- MySQL reserved words: the offset column is `byte_offset`, the users table is `app_user`. Not touched here, but do not reintroduce.
- No migration in this wave. Every column used already exists.
- Existing specs must keep passing **unmodified** except where a task says otherwise. `rotation.spec.ts` tests the pure `decide()` and is not touched at all.

## File Structure

```
nest-api/src/ingest/
  source.ts               NEW  the Source and SourceFile types — no logic
  pm2-source.ts           NEW  today's behaviour, moved: glob + serviceAndStream + ECS parse
  nginx-source.ts         NEW  registry-driven file list + combined parse
  nginx-parser.ts         NEW  one combined line → LogRecord. Pure, no Nest, no Prisma
  nginx-parser.spec.ts    NEW  the parser's cases
  pm2-source.spec.ts      NEW  serviceAndStream's existing cases, moved with it
  tailer.ts               MOD  takes Source[]; serviceAndStream leaves; poll() loops sources
  tailer.spec.ts          MOD  becomes the multi-source cases; its old contents move to pm2-source.spec.ts
  ingest.service.ts       MOD  constructor takes Source[] instead of a pattern string
  ingest.module.ts        MOD  the factory builds both sources
  parser.ts               —    untouched. `LEVELS` is imported from it
  writer.ts               —    untouched
  rotation.ts             —    untouched

nest-api/test/
  nginx-tail.e2e-spec.ts  NEW  a registry row's file into MySQL, rotation included
  tail-roundtrip.e2e-spec.ts   MOD  one line: the IngestService constructor
  ingest-recovery.e2e-spec.ts  MOD  one line: the Tailer constructor

nest-api/prisma/seed.ts   MOD  the landing-page row, and the stale nginx comment
nest-api/.env.example     MOD  the origins line gains 1991computer.com
deploy/nginx/iknos.conf   MOD  a comment that this wave makes false
DEPLOY.md                 MOD  the two ks-b prerequisites
README.md                 MOD  "Two ways in" becomes three

landing-page/.gitignore                    MOD  .env* — lands FIRST, before any env file exists
landing-page/src/helpers/report.ts         NEW  copied from front/src/lib/report.ts
landing-page/src/instrumentation-client.ts NEW  copied from front/src/instrumentation-client.ts
landing-page/.env.example                  NEW  the three NEXT_PUBLIC_IKNOS_* keys
```

`nginx-parser.ts` is deliberately separate from `nginx-source.ts`: the parser is a pure function
with no dependencies and a large test surface, the source is three lines of Prisma. Splitting them
is what lets the parser's spec run without a database.

---

### Task 1: The combined-format parser

**Files:**
- Create: `nest-api/src/ingest/nginx-parser.ts`
- Test: `nest-api/src/ingest/nginx-parser.spec.ts`

**Interfaces:**
- Consumes: `LogRecord` from `./log-record`; `LEVELS` from `./parser`.
- Produces: `parseCombined(line: string, service: string): LogRecord | null` — used by Task 3.

Implements spec §3. Nothing else in the wave depends on a database, so this goes first and can be
verified completely on its own.

- [ ] **Step 1: Write the failing test**

Create `nest-api/src/ingest/nginx-parser.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCombined } from "./nginx-parser";

/**
 * Every line here is nginx's `combined` format, which is what every vhost on ks-b is configured
 * with — see `deploy/nginx/iknos.conf:55`.
 */
const LINE =
  '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET /shots/iknos/logs-960.avif HTTP/2.0" 200 31245 "https://1991computer.com/" "Mozilla/5.0 (Macintosh)"';

describe("parseCombined", () => {
  it("maps a combined line onto the promoted columns", () => {
    const r = parseCombined(LINE, "landing-page");

    expect(r).not.toBeNull();
    expect(r?.service).toBe("landing-page");
    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.httpMethod).toBe("GET");
    expect(r?.route).toBe("/shots/iknos/logs-960.avif");
    expect(r?.statusCode).toBe(200);
    expect(r?.logger).toBe("nginx.access");
    expect(r?.message).toBe("GET /shots/iknos/logs-960.avif 200");
    // combined carries no $request_time, so this column stays empty for nginx lines.
    expect(r?.durationMs).toBeNull();
    // and no $host — which is the whole reason each vhost writes its own file.
    expect(r?.hostname).toBeNull();
  });

  it("reads the offset in the line rather than assuming the server's", () => {
    // 14:02:31 at +0200 is 12:02:31 UTC. A parser that ignored the offset would be two hours out,
    // and every range query against these rows would be quietly wrong.
    const r = parseCombined(LINE, "landing-page");
    expect(r?.ts.toISOString()).toBe("2026-09-16T12:02:31.000Z");
  });

  it("derives the level from the status code", () => {
    const at = (status: number) => {
      const line = LINE.replace('" 200 ', `" ${status} `);
      return parseCombined(line, "landing-page");
    };

    // The bands, tested at both edges of each — this is what makes the existing level filter and
    // the `level >= 50` searches work on nginx lines without a second control.
    expect(at(199)?.levelName).toBe("info");
    expect(at(200)?.levelName).toBe("info");
    expect(at(399)?.levelName).toBe("info");
    expect(at(400)?.levelName).toBe("warn");
    expect(at(499)?.levelName).toBe("warn");
    expect(at(500)?.levelName).toBe("error");
    expect(at(500)?.level).toBe(50);
  });

  it("strips the query string off route and keeps it in attrs", () => {
    const line = LINE.replace("/shots/iknos/logs-960.avif", "/?p=iknos&tab=demo");
    const r = parseCombined(line, "landing-page");

    // `route` is VarChar(255) and carries @@index([route, ts]); query strings in it would make
    // that index cardinality noise.
    expect(r?.route).toBe("/");
    expect(r?.attrs?.query).toBe("p=iknos&tab=demo");
  });

  it("keeps the referrer, agent, protocol and byte count in attrs", () => {
    const r = parseCombined(LINE, "landing-page");
    expect(r?.attrs).toEqual({
      referrer: "https://1991computer.com/",
      userAgent: "Mozilla/5.0 (Macintosh)",
      protocol: "HTTP/2.0",
      bytes: 31245,
    });
  });

  it("omits the fields nginx wrote as a dash", () => {
    const line =
      '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET / HTTP/1.1" 200 0 "-" "-"';
    const r = parseCombined(line, "landing-page");

    // A dash is nginx saying "absent". Storing the string "-" would make every filter on referrer
    // match a value that means nothing.
    expect(r?.attrs).toEqual({ protocol: "HTTP/1.1", bytes: 0 });
    expect(r?.userId).toBeNull();
  });

  it("reads $remote_user when there is one", () => {
    const line = LINE.replace("- - [16/Sep", "- alice [16/Sep");
    expect(parseCombined(line, "landing-page")?.userId).toBe("alice");
  });

  it("handles IPv6 and IPv4-mapped IPv6 in remote_addr", () => {
    const v6 = LINE.replace("203.0.113.5", "2001:db8::8a2e:370:7334");
    expect(parseCombined(v6, "landing-page")?.clientIp).toBe("2001:db8::8a2e:370:7334");

    const mapped = LINE.replace("203.0.113.5", "::ffff:203.0.113.5");
    expect(parseCombined(mapped, "landing-page")?.clientIp).toBe("::ffff:203.0.113.5");
  });

  it("stores a line it cannot read rather than dropping it", () => {
    const r = parseCombined("this is not a combined line at all", "landing-page");

    // Same rule the ECS parser applies at parser.ts:106 — degraded beats dropped, and the raw
    // line is the whole evidence. A log_format changed on the box has to show as a rising
    // degraded count, not as silence.
    expect(r?.degraded).toBe(true);
    expect(r?.message).toBe("this is not a combined line at all");
    expect(r?.clientIp).toBeNull();
    expect(r?.levelName).toBe("info");
  });

  it("survives a request line that is not a request line", () => {
    // Scanners send exactly this sort of thing. It must parse as far as it can and never throw.
    const line = '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "\\x16\\x03\\x01" 400 0 "-" "-"';
    const r = parseCombined(line, "landing-page");

    expect(r).not.toBeNull();
    expect(r?.statusCode).toBe(400);
    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.route).toBeNull();
    expect(r?.httpMethod).toBeNull();
  });

  it("drops a blank line", () => {
    expect(parseCombined("", "landing-page")).toBeNull();
    expect(parseCombined("   \n", "landing-page")).toBeNull();
  });

  it("rejects a month name that is not one", () => {
    const line = LINE.replace("/Sep/", "/Foo/");
    // Not a crash, and not a silently wrong date either: it degrades.
    expect(parseCombined(line, "landing-page")?.degraded).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nest-api && pnpm vitest run src/ingest/nginx-parser.spec.ts`
Expected: FAIL — `Failed to resolve import "./nginx-parser"`.

- [ ] **Step 3: Write the implementation**

Create `nest-api/src/ingest/nginx-parser.ts`:

```ts
import { LEVELS } from "./parser";

import type { LogRecord } from "./log-record";

/**
 * nginx's `combined` format — one line into the same `LogRecord` a tailed ECS line becomes.
 *
 * The point of going through `LogRecord` rather than a second row shape is that everything
 * downstream stays ignorant of the difference: the writer, the bus, the live tail and the Logs
 * view cannot tell an access line from a posted browser error, and do not need to.
 *
 * ```
 * $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
 * ```
 *
 * **Anchored, and built from negated classes** — `[^"]*` rather than `.*?` — because this runs on
 * every line of every access log and the ingestion path forbids a regex that can backtrack.
 * `LineBuffer` has already capped the line at 1 MB before it arrives.
 */
const COMBINED = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;

/** `16/Sep/2026:14:02:31 +0200` — nginx's own, which `new Date()` does not read. */
const TIME_LOCAL = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * The offset is **in the line**, and is honoured rather than assumed.
 *
 * ks-b runs on Paris time, so a parser that built a local `Date` would be right today and an hour
 * out after the October change — and every range query against these rows silently wrong with it.
 * `log_entry` is partitioned by day on `ts`, so an hour of drift can also file a row in the wrong
 * partition.
 */
function parseTimeLocal(raw: string): Date | null {
  const m = TIME_LOCAL.exec(raw);
  if (m === null) return null;

  const month = MONTHS[m[2]];
  if (month === undefined) return null;

  const offsetMinutes = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  const asUtc = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const ts = new Date(asUtc - offsetMinutes * 60_000);

  return Number.isNaN(ts.getTime()) ? null : ts;
}

/** nginx writes `-` for "there was none". Storing that string would make it look like a value. */
const dashless = (value: string): string | null => (value === "" || value === "-" ? null : value);

/**
 * The status code is the only thing an access line says about severity, so it is what the level
 * comes from. This is what lets the existing level filter, and a `level >= 50` search across every
 * service, work on these rows without a second control being invented for them.
 */
function levelFor(status: number): { level: number; levelName: string } {
  if (status >= 500) return { level: LEVELS.error, levelName: "error" };
  if (status >= 400) return { level: LEVELS.warn, levelName: "warn" };
  return { level: LEVELS.info, levelName: "info" };
}

type RequestParts = {
  method: string | null;
  route: string | null;
  query: string | null;
  protocol: string | null;
};

/**
 * `"GET /path?q=1 HTTP/2.0"`, and everything a scanner sends instead.
 *
 * A request line that is not one — a TLS handshake aimed at the plain port, a binary probe —
 * yields nulls rather than an exception. The status code beside it is still a fact worth storing.
 */
function splitRequest(request: string): RequestParts {
  const parts = request.split(" ");
  if (parts.length < 2) return { method: null, route: null, query: null, protocol: null };

  const [method, target] = parts;
  const protocol = parts.length > 2 ? parts[parts.length - 1] : null;
  const q = target.indexOf("?");

  return {
    method,
    route: q === -1 ? target : target.slice(0, q),
    query: q === -1 ? null : target.slice(q + 1),
    protocol,
  };
}

/**
 * A line the pattern did not match, kept as text.
 *
 * `degraded` is the same signal the ECS parser raises at `parser.ts:106` and
 * `GET /api/collector/status` counts it. For nginx it means one of two things, both worth seeing:
 * a `log_format` changed on the box, or a file in the registry that is not an access log at all.
 */
function degraded(message: string, service: string): LogRecord {
  return {
    degraded: true as const,
    ts: new Date(),
    service,
    level: LEVELS.info,
    levelName: "info",
    logger: "nginx.access",
    message,
    traceId: null,
    httpMethod: null,
    route: null,
    statusCode: null,
    durationMs: null,
    clientIp: null,
    userId: null,
    hostname: null,
    attrs: null,
  };
}

/**
 * Never throws, and never returns a half-built record. `null` means "nothing here" — a blank line
 * — and is the only case that stores nothing at all.
 *
 * No clamping happens here on purpose: `toRow` (`writer.ts:59-77`) bounds every column at the
 * writing edge, so a 4 KB request target or a binary method is already incapable of failing an
 * INSERT and poisoning its batch. Clamping twice would only put the limit in two places.
 */
export function parseCombined(line: string, service: string): LogRecord | null {
  const clean = line.trim();
  if (clean === "") return null;

  const m = COMBINED.exec(clean);
  if (m === null) return degraded(clean, service);

  const ts = parseTimeLocal(m[4]);
  if (ts === null) return degraded(clean, service);

  const status = Number(m[6]);
  const { level, levelName } = levelFor(status);
  const { method, route, query, protocol } = splitRequest(m[5]);

  const referrer = dashless(m[8]);
  const userAgent = dashless(m[9]);
  const bytes = m[7] === "-" ? null : Number(m[7]);

  const attrs: Record<string, unknown> = {};
  if (referrer !== null) attrs.referrer = referrer;
  if (userAgent !== null) attrs.userAgent = userAgent;
  if (protocol !== null) attrs.protocol = protocol;
  if (query !== null) attrs.query = query;
  if (bytes !== null) attrs.bytes = bytes;

  return {
    ts,
    service,
    level,
    levelName,
    // What tells an access line from a posted browser error inside one service.
    logger: "nginx.access",
    // What the dense table shows in its message column. The route and status are columns too, but
    // a row whose message is empty reads as a blank line in the one place a reader scans.
    message: `${method ?? "?"} ${route ?? "?"} ${status}`,
    traceId: null,
    httpMethod: method,
    route,
    statusCode: status,
    // combined has no $request_time. A log_format carrying one would be a change to every vhost
    // that wants it — spec §10.
    durationMs: null,
    clientIp: m[1],
    userId: dashless(m[3]),
    // No $host in combined, which is exactly why each vhost writes its own file and the service
    // comes from the registry row rather than from the line.
    hostname: null,
    attrs: Object.keys(attrs).length > 0 ? attrs : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nest-api && pnpm vitest run src/ingest/nginx-parser.spec.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `cd nest-api && pnpm check && pnpm typecheck`
Expected: both clean. Biome will reformat the `MONTHS` object onto more lines — accept that.

- [ ] **Step 6: Commit (ask first)**

```bash
git add nest-api/src/ingest/nginx-parser.ts nest-api/src/ingest/nginx-parser.spec.ts
git commit -m "feat(api): a combined line becomes the same record a tailed one does (IKN-16)"
```

---

### Task 2: The `Source` seam, and PM2 behind it

**Files:**
- Create: `nest-api/src/ingest/source.ts`, `nest-api/src/ingest/pm2-source.ts`, `nest-api/src/ingest/pm2-source.spec.ts`
- Modify: `nest-api/src/ingest/tailer.ts`, `nest-api/src/ingest/ingest.service.ts`, `nest-api/src/ingest/ingest.module.ts`
- Modify: `nest-api/src/ingest/tailer.spec.ts` (its whole contents move to `pm2-source.spec.ts`)
- Modify: `nest-api/test/tail-roundtrip.e2e-spec.ts:40`, `nest-api/test/ingest-recovery.e2e-spec.ts:23`

**Interfaces:**
- Consumes: `parseCombined` is not used here. `parse` and `serviceAndStream` are today's.
- Produces: `Source`, `SourceFile` (`./source`); `Pm2Source` (`./pm2-source`); `serviceAndStream` now exported from `./pm2-source` rather than `./tailer`.

Implements spec §2 and §2.1, decisions D1–D3. **This task changes no behaviour.** Its evidence is
that every existing test passes with only the two constructor call sites edited.

- [ ] **Step 1: Write the types**

Create `nest-api/src/ingest/source.ts`:

```ts
import type { LogRecord } from "./log-record";

/** One file a source follows, and the service its lines belong to. */
export type SourceFile = { file: string; service: string; stream: "out" | "err" };

/**
 * Where log lines come from, and how to read one.
 *
 * These two methods are the only things in this module that ever knew what a log line looks like
 * — they were `serviceAndStream` and `parse`, called directly inside `Tailer.pollOne`. Everything
 * below them already dealt in `LogRecord`: the `Chunk`, the `Writer`, the bus, `persistBatch`,
 * the rotation arithmetic. Naming the pair is the whole of what a second source needed.
 */
export type Source = {
  /** Named in the log line when a sweep fails, so an outage says which source it was. */
  readonly name: string;

  /**
   * The files to sweep this pass.
   *
   * **Re-evaluated every tick rather than cached**, which is why `poll()` re-globs today
   * (`tailer.ts:89`): a newly deployed PM2 app is picked up without restarting Iknos, and a
   * newly registered site inherits the same property for free.
   */
  files(): Promise<SourceFile[]>;

  /** One line into a record, or `null` to drop it. Never throws. */
  parse(line: string, service: string, stream: "out" | "err"): LogRecord | null;
};
```

- [ ] **Step 2: Move `serviceAndStream` into a source**

Create `nest-api/src/ingest/pm2-source.ts`. **Move** the `serviceAndStream` function and its full
doc comment out of `tailer.ts:20-45` — do not copy it and leave a second definition:

```ts
import { glob } from "node:fs/promises";
import path from "node:path";
import { parse as parseEcs } from "./parser";

import type { LogRecord } from "./log-record";
import type { Source, SourceFile } from "./source";

/**
 * PM2 names its files `<app>-out-<pm_id>.log` and `<app>-error-<pm_id>.log`.
 *
 * **The trailing process id is the part that matters here.** Without stripping it, `pfa-nest-api`
 * arrives as `pfa-nest-api-out-39` — a service name nobody recognises, a rail full of duplicates,
 * and stdout and stderr recorded as two unrelated applications. Worse, the stream is then read as
 * `out` for an error file, so a line that carried no explicit level is stored as info.
 *
 * That id also changes: PM2 hands out a new one on every restart, so the same application has
 * `…-out-45.log` and `…-out-5.log` side by side. Both must resolve to one service.
 *
 * A few apps configure `out_file` explicitly and get a plain `<name>.log` with no suffix at all.
 * Those fall through to the last line, which is the right answer for them.
 */
export function serviceAndStream(file: string): { service: string; stream: "out" | "err" } {
  const stem = path.basename(file, path.extname(file));
  // Only the id, and only at the end. An application legitimately called `foo-2` keeps its name:
  // its file is `foo-2-out-14.log`, and what is removed is `-14`.
  const named = stem.replace(/-\d+$/, "");

  if (named.endsWith("-error")) return { service: named.slice(0, -"-error".length), stream: "err" };
  if (named.endsWith("-out")) return { service: named.slice(0, -"-out".length), stream: "out" };
  return { service: stem, stream: "out" };
}

/**
 * Everything with a stdout, which is every backend and every server-rendered page on ks-b.
 *
 * This is the collector as it has always worked, named. The service comes from the filename
 * because that is where PM2 puts it, and `log_entry.service` has therefore always carried the PM2
 * name — which is why the registry's `name` column holds PM2 names and not friendlier labels.
 */
export class Pm2Source implements Source {
  readonly name = "pm2";

  constructor(private readonly pattern: string) {}

  /**
   * Materialised rather than streamed, which is the one difference from the loop this replaces.
   * `poll()` used `for await` straight off the glob; at the fleet's ~40 files, collecting them
   * first costs nothing and lets both sources answer with one type.
   */
  async files(): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    for await (const file of glob(this.pattern)) {
      out.push({ file, ...serviceAndStream(file) });
    }
    return out;
  }

  parse(line: string, service: string, stream: "out" | "err"): LogRecord | null {
    return parseEcs(line, service, stream);
  }
}
```

- [ ] **Step 3: Move the existing spec to match**

`git mv nest-api/src/ingest/tailer.spec.ts nest-api/src/ingest/pm2-source.spec.ts`, then change its
one import line from `from "./tailer"` to `from "./pm2-source"`. **Change nothing else in it** —
those cases came from ks-b's actual log listing and are the regression net for this move.

- [ ] **Step 4: Run it to verify the move is clean**

Run: `cd nest-api && pnpm vitest run src/ingest/pm2-source.spec.ts`
Expected: PASS, 6 tests — the same six that passed before the move.

- [ ] **Step 5: Write the multi-source tailer spec**

`tailer.spec.ts` is empty now that its contents moved. It becomes the spec for the one thing the
tailer newly does — drive more than one source — which nothing else covers. Create
`nest-api/src/ingest/tailer.spec.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Tailer } from "./tailer";

import type { LogRecord } from "./log-record";
import type { Source, SourceFile } from "./source";
import type { Chunk } from "./writer";

/** The tailer only ever carries a record through; it never reads one. This is enough to be one. */
const record = (service: string, message: string): LogRecord => ({
  ts: new Date(),
  service,
  level: 30,
  levelName: "info",
  logger: null,
  message,
  traceId: null,
  httpMethod: null,
  route: null,
  statusCode: null,
  durationMs: null,
  clientIp: null,
  userId: null,
  hostname: null,
  attrs: null,
});

/** A source over files that already exist, whose parser tags each line with the source's name. */
const sourceOver = (name: string, files: SourceFile[]): Source => ({
  name,
  files: async () => files,
  parse: (line, service) => record(service, `${name}:${line}`),
});

describe("Tailer over several sources", () => {
  it("sweeps every source in one pass, each through its own parser", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-src-"));
    const a = path.join(dir, "a.log");
    const b = path.join(dir, "b.log");
    await writeFile(a, "one\n");
    await writeFile(b, "two\n");

    const chunks: Chunk[] = [];
    const tailer = new Tailer(
      [
        sourceOver("pm2", [{ file: a, service: "app-a", stream: "out" }]),
        sourceOver("nginx", [{ file: b, service: "site-b", stream: "out" }]),
      ],
      (chunk) => chunks.push(chunk),
    );

    await tailer.poll();

    const seen = chunks.flatMap((c) => c.records.map((r) => `${r.service} ${r.message}`));
    // Each line went through the parser belonging to the source that listed its file, which is
    // the whole point of the seam.
    expect(seen).toContain("app-a pm2:one");
    expect(seen).toContain("site-b nginx:two");
  });

  it("keeps sweeping when one source cannot list its files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-src-"));
    const a = path.join(dir, "a.log");
    await writeFile(a, "still here\n");

    const broken: Source = {
      name: "nginx",
      // What a database outage looks like from here: the nginx source finds its files in MySQL.
      files: async () => {
        throw new Error("database is down");
      },
      parse: (line, service) => record(service, line),
    };

    const chunks: Chunk[] = [];
    const tailer = new Tailer(
      [broken, sourceOver("pm2", [{ file: a, service: "app-a", stream: "out" }])],
      (chunk) => chunks.push(chunk),
    );

    // Never throws out of poll: the interval driving it would otherwise take the process down.
    await expect(tailer.poll()).resolves.toBeUndefined();

    // And the PM2 lines still landed — which is the point, because they are exactly what somebody
    // is reading while MySQL is the problem.
    expect(chunks.flatMap((c) => c.records.map((r) => r.message))).toContain("still here");
    // The pass completed, so the heartbeat is stamped and the collector does not read as dead.
    expect(tailer.lastPollAt).not.toBeNull();
  });

  it("follows both sources' files without their offsets colliding", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-src-"));
    const a = path.join(dir, "a.log");
    const b = path.join(dir, "b.log");
    await writeFile(a, "one\n");
    await writeFile(b, "two\n");

    const chunks: Chunk[] = [];
    const tailer = new Tailer(
      [
        sourceOver("pm2", [{ file: a, service: "app-a", stream: "out" }]),
        sourceOver("nginx", [{ file: b, service: "site-b", stream: "out" }]),
      ],
      (chunk) => chunks.push(chunk),
    );

    await tailer.poll();
    // `state` is keyed by path, so two sources cannot overwrite each other in it.
    expect(tailer.trackedFiles).toBe(2);

    // A second pass finds no new bytes in either and submits nothing more. An offset shared
    // between the two files would show up here as a re-read.
    const after = chunks.length;
    await tailer.poll();
    expect(chunks.length).toBe(after);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd nest-api && pnpm vitest run src/ingest/tailer.spec.ts`
Expected: FAIL — `Tailer` still takes `(pattern: string, submit)`, so passing an array is a type
error and the first argument is not iterable as a source list.

- [ ] **Step 7: Teach the tailer to loop sources**

In `nest-api/src/ingest/tailer.ts`:

Remove the now-moved `serviceAndStream` and its `import path from "node:path"` if nothing else
uses it. Add `import { logger } from "@common/logger";` and `import type { Source, SourceFile } from "./source";`.
Drop the `glob` import — the sources own that now.

Change the constructor:

```ts
  constructor(
    private readonly sources: Source[],
    private readonly submit: (chunk: Chunk) => void,
  ) {}
```

Replace `poll()`:

```ts
  /**
   * One pass over every file of every source. Driven on a one-second interval by the ingest
   * service.
   *
   * Sources are asked for their files each tick rather than at boot — see `Source.files`.
   */
  async poll(): Promise<void> {
    for (const source of this.sources) {
      let files: SourceFile[];
      try {
        files = await source.files();
      } catch (err) {
        // A source that cannot even list its files must not stop the others. The nginx source
        // reads MySQL to find them, so this is the database-down case — and the PM2 sweep is
        // exactly what someone debugging a database outage is reading.
        logger.error({ err, source: source.name }, "source file listing failed");
        continue;
      }

      for (const sf of files) {
        try {
          await this.pollOne(sf, source);
        } catch {
          // A file that vanished mid-poll is normal during rotation. Never let one bad file stop
          // the others.
        }
      }
    }
    // Stamped after the whole sweep, and only on the way out. A pass that threw before reaching
    // here leaves the previous stamp standing and lets it go stale, which is the honest reading:
    // the loop is running but it is not working.
    this.lastPollAt = new Date();
  }
```

Change `pollOne`'s signature to `private async pollOne(sf: SourceFile, source: Source): Promise<void>`,
take `const { file, service, stream } = sf;` as its first line in place of the
`serviceAndStream(file)` call, and change the parse call at what was `tailer.ts:158`:

```ts
          const record = source.parse(line, service, stream);
```

**Everything else in the file stays exactly as it is** — `decide()`, the rotation branch, the
`LineBuffer` handling, the committed-offset arithmetic, `bytesRead`, `lastPollAt`, `hydrate()`
and `trackedFiles`. `state` remains one map keyed by file path; two sources cannot collide in it
because `~/.pm2/logs/*.log` and `/var/log/nginx/*.access.log` share no path.

- [ ] **Step 8: Thread it through the service and the module**

In `nest-api/src/ingest/ingest.service.ts`, change the constructor's first parameter and the
`Tailer` construction:

```ts
  constructor(
    private readonly sources: Source[],
    private readonly bus: LogBus,
    private readonly prisma: PrismaService,
  ) {}
```

```ts
    this.tailer = new Tailer(this.sources, (chunk) => {
```

with `import type { Source } from "./source";` added. `stats()` is untouched.

In `nest-api/src/ingest/ingest.module.ts`, the factory builds the source list. Replace the comment
at lines 20-22 — it explains why the first parameter is a plain string, which stops being true:

```ts
/*
 * `IngestService` is built by a factory rather than by class injection because it takes a list of
 * sources: the PM2 glob comes out of the validated environment, the way `main.ts` reads the port,
 * and the nginx source needs the Prisma client to find its files at all. Everything else about it
 * is ordinary DI.
 */
```

```ts
      useFactory: (bus: LogBus, prisma: PrismaService) =>
        new IngestService([new Pm2Source(parseEnv({ ...process.env }).pm2LogGlob)], bus, prisma),
```

`NginxSource` joins this list in Task 3 — leaving it out here keeps this task a pure refactor with
no behaviour to argue about.

- [ ] **Step 9: Fix the two e2e call sites**

`nest-api/test/tail-roundtrip.e2e-spec.ts:40`:

```ts
    const ingest = new IngestService([new Pm2Source(`${dir}/*.log`)], bus, prisma);
```

`nest-api/test/ingest-recovery.e2e-spec.ts:23`:

```ts
  return {
    writer,
    makeTailer: (pattern: string) => new Tailer([new Pm2Source(pattern)], (chunk) => writer.submit(chunk)),
  };
```

Both need `import { Pm2Source } from "@ingest/pm2-source";`. These are the only two places outside
`src/` that construct either class — `grep -rn "new Tailer\|new IngestService" src test mock`
confirms it.

- [ ] **Step 10: Run the whole suite — this is the proof**

Run: `cd nest-api && pnpm test`
Expected: PASS, everything. `rotation.spec.ts`, `writer.spec.ts`, `line-buffer.spec.ts`,
`parser.spec.ts`, `sustained-load.spec.ts` and all twenty e2e suites are **unmodified** and still
green. If any of them needed editing, the seam was cut in the wrong place — stop and say so rather
than adjusting the test.

- [ ] **Step 11: Lint, typecheck, commit (ask first)**

```bash
cd nest-api && pnpm check && pnpm typecheck
```

```bash
git add nest-api/src/ingest/source.ts nest-api/src/ingest/pm2-source.ts nest-api/src/ingest/pm2-source.spec.ts \
        nest-api/src/ingest/tailer.ts nest-api/src/ingest/tailer.spec.ts \
        nest-api/src/ingest/ingest.service.ts nest-api/src/ingest/ingest.module.ts \
        nest-api/test/tail-roundtrip.e2e-spec.ts nest-api/test/ingest-recovery.e2e-spec.ts
git commit -m "refactor(api): the two calls that knew what a log line is become a Source (IKN-16)"
```

---

### Task 3: `NginxSource`, driven by the registry

**Files:**
- Create: `nest-api/src/ingest/nginx-source.ts`
- Modify: `nest-api/src/ingest/ingest.module.ts`
- Test: `nest-api/src/ingest/nginx-source.spec.ts`

**Interfaces:**
- Consumes: `Source`, `SourceFile` (`./source`); `parseCombined` (`./nginx-parser`, Task 1); `PrismaService` (`@db/prisma.service`).
- Produces: `NginxSource` — constructed in `ingest.module.ts`.

Implements spec §2.1 and D4. The source is deliberately three lines of Prisma; everything
interesting is in the parser it delegates to.

- [ ] **Step 1: Write the failing test**

Create `nest-api/src/ingest/nginx-source.spec.ts`. The Prisma client is a stub — this spec must
not open a connection:

```ts
import { describe, expect, it } from "vitest";
import { NginxSource } from "./nginx-source";

import type { PrismaService } from "@db/prisma.service";

/** Only the one call `NginxSource` makes. Enough to be the client, nothing more. */
const prismaWith = (rows: { name: string; logGlob: string | null }[]) =>
  ({ service: { findMany: async () => rows } }) as unknown as PrismaService;

describe("NginxSource", () => {
  it("turns registry rows into files, attributed to their service", async () => {
    const source = new NginxSource(
      prismaWith([
        { name: "landing-page", logGlob: "/var/log/nginx/1991computer.access.log" },
        { name: "iknos-front", logGlob: "/var/log/nginx/iknos.access.log" },
      ]),
    );

    expect(await source.files()).toEqual([
      { file: "/var/log/nginx/1991computer.access.log", service: "landing-page", stream: "out" },
      { file: "/var/log/nginx/iknos.access.log", service: "iknos-front", stream: "out" },
    ]);
  });

  it("is empty when no row declares a log", async () => {
    // The state on the day this ships and before the landing page's row is seeded. An empty list
    // is a working configuration, not a failure.
    expect(await new NginxSource(prismaWith([])).files()).toEqual([]);
  });

  it("parses through the combined parser", () => {
    const source = new NginxSource(prismaWith([]));
    // Two arguments, not three: `parse` omits `stream` entirely — see the implementation's note.
    const r = source.parse(
      '203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET / HTTP/2.0" 200 12 "-" "-"',
      "landing-page",
    );

    expect(r?.clientIp).toBe("203.0.113.5");
    expect(r?.logger).toBe("nginx.access");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nest-api && pnpm vitest run src/ingest/nginx-source.spec.ts`
Expected: FAIL — `Failed to resolve import "./nginx-source"`.

- [ ] **Step 3: Write the implementation**

Create `nest-api/src/ingest/nginx-source.ts`:

```ts
import { parseCombined } from "./nginx-parser";

import type { PrismaService } from "@db/prisma.service";
import type { LogRecord } from "./log-record";
import type { Source, SourceFile } from "./source";

/**
 * The half of the traffic no application can report: what nginx answered without ever proxying.
 *
 * A 503 from `limit_req`, a probe for `/wp-login.php`, a 404 on a route no app serves — and the
 * case that brought this forward, a static site with no PM2 process at all, whose visitors are
 * otherwise invisible.
 *
 * **Its files come from the registry, not from a glob**, which is the difference from `Pm2Source`
 * and the reason `Service.logGlob` was reserved. Adding a site stays what the registry has always
 * promised: one row, no code change, no redeploy.
 *
 * Each vhost must write its own access log — `combined` carries no `$host` field, so lines in the
 * shared `/var/log/nginx/access.log` cannot be attributed to a site at all. That is a one-line
 * change per vhost on ks-b, documented in DEPLOY.md, and the same one Zeus made for itself.
 *
 * No `@Injectable()`: like `Pm2Source`, this is constructed by hand in the module's factory, which
 * is where the Prisma client it needs is already in scope.
 */
export class NginxSource implements Source {
  readonly name = "nginx";

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `enabled` is honoured for the reason the scraper honours it (`scrape.service.ts:119`): a
   * service someone paused stays paused, and pausing has to stop the reading rather than merely
   * hide what was read.
   *
   * A throw here — the database being down — is caught by `Tailer.poll`, which logs it and sweeps
   * the PM2 source anyway. That ordering matters: the PM2 logs are exactly what someone is
   * reading while MySQL is the problem.
   */
  async files(): Promise<SourceFile[]> {
    const rows = await this.prisma.service.findMany({
      where: { enabled: true, logGlob: { not: null } },
      select: { name: true, logGlob: true },
    });

    return rows.flatMap((row) =>
      row.logGlob === null ? [] : [{ file: row.logGlob, service: row.name, stream: "out" as const }],
    );
  }

  /**
   * **`stream` is omitted rather than ignored**, which is legal for an implementation of `Source`
   * and says more than a discarded parameter would.
   *
   * It exists to decide the fallback level for a line that carries none, and a combined line
   * always has a status code to derive one from. There is also no honest value to pass: `"err"`
   * would be a lie about every 200 in an access log.
   */
  parse(line: string, service: string): LogRecord | null {
    return parseCombined(line, service);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd nest-api && pnpm vitest run src/ingest/nginx-source.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add it to the module**

In `nest-api/src/ingest/ingest.module.ts`, add `import { NginxSource } from "./nginx-source";` and
extend the list:

```ts
      useFactory: (bus: LogBus, prisma: PrismaService) =>
        new IngestService(
          [new Pm2Source(parseEnv({ ...process.env }).pm2LogGlob), new NginxSource(prisma)],
          bus,
          prisma,
        ),
```

Order matters a little: PM2 first, so on a tick where the database is unreachable the source that
does not need it has already run.

- [ ] **Step 6: Run the whole suite**

Run: `cd nest-api && pnpm test`
Expected: PASS. Nothing changes for an instance with no `log_glob` row — `files()` returns `[]`
and the sweep is a no-op, which is every environment until Task 5 seeds one.

- [ ] **Step 7: Lint, typecheck, commit (ask first)**

```bash
cd nest-api && pnpm check && pnpm typecheck
```

```bash
git add nest-api/src/ingest/nginx-source.ts nest-api/src/ingest/nginx-source.spec.ts nest-api/src/ingest/ingest.module.ts
git commit -m "feat(api): the registry names the access logs, and the collector reads them (IKN-16)"
```

---

### Task 4: The end-to-end proof, rotation included

**Files:**
- Create: `nest-api/test/nginx-tail.e2e-spec.ts`

**Interfaces:**
- Consumes: `IngestService`, `NginxSource`, `LogBus`, `PrismaService`. No new exports.

Implements spec §7's e2e paragraph. The unit tests prove the parser and the listing; this proves
the two meet the writer correctly and that no-loss-no-duplicate survives a rotation on a file
nobody has tailed before.

- [ ] **Step 1: Write the failing test**

Create `nest-api/test/nginx-tail.e2e-spec.ts`, modelled on `tail-roundtrip.e2e-spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaService } from "@db/prisma.service";
import { IngestService } from "@ingest/ingest.service";
import { NginxSource } from "@ingest/nginx-source";
import { LogBus } from "@stream/log-bus";
import { afterAll, describe, expect, it } from "vitest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The nginx half of the pipeline, wall-clock included: a registry row names a file, the file
 * grows, and rows appear in MySQL. Slow by construction — the poll interval is real time — which
 * is why it is one test and not a suite, exactly as `tail-roundtrip` is.
 */

const prisma = new PrismaService();
const services: string[] = [];

const line = (ip: string, route: string, status: number) =>
  `${ip} - - [16/Sep/2026:14:02:31 +0200] "GET ${route} HTTP/2.0" ${status} 512 "-" "curl/8.4.0"\n`;

afterAll(async () => {
  await prisma.logEntry.deleteMany({ where: { service: { in: services } } });
  await prisma.service.deleteMany({ where: { name: { in: services } } });
  await prisma.ingestOffset.deleteMany({});
  await prisma.$disconnect();
});

describe("nginx tail roundtrip", () => {
  it("reads a file named by a registry row, and survives its rotation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "iknos-nginx-"));
    const service = `n${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    services.push(service);
    const file = path.join(dir, "site.access.log");

    await writeFile(file, line("203.0.113.5", "/", 200));
    // The registry is the whole configuration — this row is what makes the file readable at all.
    await prisma.service.create({
      data: { name: service, pm2Name: service, logGlob: file, enabled: true },
    });

    const ingest = new IngestService([new NginxSource(prisma)], new LogBus(), prisma);
    await ingest.onApplicationBootstrap();

    // Appended after startup, proving new bytes are picked up rather than only what was present
    // at boot.
    await sleep(1500);
    await appendFile(file, line("198.51.100.7", "/wp-login.php", 404));

    // Rotate the way logrotate does: move the file aside and start a new one. The inode changes,
    // which is what makes the replacement detectable rather than silently producing garbage from
    // a byte offset that now means something else.
    await sleep(1500);
    await rename(file, `${file}.1`);
    await writeFile(file, line("203.0.113.9", "/after-rotation", 500));

    await sleep(2500);
    await ingest.onApplicationShutdown();

    const rows = await prisma.logEntry.findMany({
      where: { service },
      orderBy: { id: "asc" },
      select: { clientIp: true, route: true, statusCode: true, httpMethod: true, levelName: true, logger: true },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.route)).toEqual(["/", "/wp-login.php", "/after-rotation"]);
    expect(rows.map((r) => r.clientIp)).toEqual(["203.0.113.5", "198.51.100.7", "203.0.113.9"]);
    // The level bands are what make these rows reachable from the existing filters.
    expect(rows.map((r) => r.levelName)).toEqual(["info", "warn", "error"]);
    expect(rows.every((r) => r.logger === "nginx.access")).toBe(true);
    expect(rows.every((r) => r.httpMethod === "GET")).toBe(true);
  }, 20_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd nest-api && pnpm vitest run test/nginx-tail.e2e-spec.ts`
Expected: FAIL. If Tasks 1–3 are complete it should actually pass — run it anyway to confirm
that, because a test that has never been seen red proves nothing. If it passes first try, break it
deliberately once (change an expected route) and confirm it fails for the reason you expect.

This suite needs a reachable MySQL with the migrations applied, like the other twenty e2e specs.

- [ ] **Step 3: Run the whole suite**

Run: `cd nest-api && pnpm test`
Expected: PASS, everything.

- [ ] **Step 4: Commit (ask first)**

```bash
git add nest-api/test/nginx-tail.e2e-spec.ts
git commit -m "test(api): an access log through the whole pipeline, rotation and all (IKN-16)"
```

---

### Task 5: The `landing-page` registry row

**Files:**
- Modify: `nest-api/prisma/seed.ts`
- Modify: `nest-api/.env.example`

**Interfaces:**
- Consumes: nothing new. The row is data.
- Produces: the service name `landing-page`, which Task 6's `NEXT_PUBLIC_IKNOS_SERVICE` must match exactly.

Implements spec §4 and §5 for IKN-71. The row is what makes both doors work: `NginxSource` finds
its file through `log_glob`, and `POST /api/ingest` accepts a sender only under a name the
registry knows and has enabled (`http-ingest.service.ts`, `isKnownService`).

- [ ] **Step 1: Add the row**

In `nest-api/prisma/seed.ts`, insert into `SERVICES` in alphabetical position — between
`iknos-front` and `pfa-front`:

```ts
  /*
   * The portfolio at 1991computer.com, and the first row in this table that names no process at
   * all: a Next `output: "export"` build rsynced to a document root, with no PM2 entry, no port
   * and no stdout. `pm2Name` repeats `name` because there is nothing else to put there — the
   * consumers that read it look for a `process_sample` and correctly find none.
   *
   * It reaches this table by two doors, and both are named here. `logGlob` is the access log
   * nginx writes for its vhost, which IKN-16's source reads; the browser reporter posts JavaScript
   * errors under this same name, which is what makes one rail entry hold both. Neither works
   * until ks-b has the `access_log` line and the origin — see DEPLOY.md.
   */
  {
    name: "landing-page",
    pm2Name: "landing-page",
    metricsUrl: null,
    healthUrl: null,
    logGlob: "/var/log/nginx/1991computer.access.log",
  },
```

`SERVICES` entries currently carry no `logGlob` key at all, so TypeScript infers the array's
element type without it. Adding the key to one entry makes the others' absent key an error under
the object-literal inference — if `pnpm typecheck` complains, give the array an explicit type
annotation rather than adding `logGlob: null` to nineteen rows:

```ts
const SERVICES: { name: string; pm2Name: string; metricsUrl: string | null; healthUrl: string | null; logGlob?: string }[] = [
```

- [ ] **Step 2: Correct the comment this wave makes false**

The file header says `nginx` is "deliberately absent: it is not a PM2 process and its logs come
from somewhere else entirely. It joins the registry with IKN-16, which brings its own ingestion
source — and it is the case that will finally make `name` and `pm2Name` differ."

Two of its three claims have changed. Replace that paragraph:

```
 * `nginx` is not in here as a service of its own, and no longer needs to be. IKN-16 brought the
 * ingestion source it was waiting for, and the answer turned out to be per-site rather than one
 * `nginx` row: `combined` carries no `$host`, so a vhost's lines are only attributable if that
 * vhost writes its own file — and once it does, the file belongs to the site rather than to the
 * server. A site's access log is therefore a column on the site's row, `logGlob`.
 *
 * `landing-page` is the first row here that names no PM2 process, which is what `pm2Name` was
 * always held open for. It does not make the two columns differ — there is simply nothing to put
 * in the second one, so it repeats the first.
```

- [ ] **Step 3: Document the origin**

In `nest-api/.env.example`, the `IKNOS_INGEST_ORIGINS` block gains a worked value, since it has
none today and the comment alone does not say what one looks like:

```
# Comma-separated. Only ever checked against requests that sent an Origin header, so leaving it
# empty still lets curl and server-side senders through — it simply stops distinguishing
# browsers.
#
# On ks-b this holds every front that posts browser errors, each as a bare scheme and host with no
# trailing slash — that is what a browser puts in the `Origin` header, and a value with a path
# would never match one:
#
#   IKNOS_INGEST_ORIGINS="https://pfa.1991computer.com,https://1991computer.com"
IKNOS_INGEST_ORIGINS=""
```

- [ ] **Step 4: Verify the seed is still idempotent and reconciling**

Run: `cd nest-api && pnpm seed` twice.
Expected: `service registry seeded — 21 rows` both times, and **no** "removed N stale row(s)" on
the second run. The reconciling delete removes rows absent from `SERVICES`, so a typo in the new
name would show up as a row count of 22 and a stale removal on the next run.

Then confirm the column actually landed:

```bash
cd nest-api && pnpm prisma studio
```

or more directly, that `NginxSource` now sees it — this is the whole point of the row:

```bash
cd nest-api && pnpm vitest run src/ingest/nginx-source.spec.ts
```

(That spec stubs Prisma, so it proves the shape rather than the row. The row itself is proven by
the service appearing in the rail once the API restarts.)

- [ ] **Step 5: Typecheck, lint, commit (ask first)**

```bash
cd nest-api && pnpm check && pnpm typecheck
```

```bash
git add nest-api/prisma/seed.ts nest-api/.env.example
git commit -m "feat(api): the landing page gets a row, and an access log to go with it (IKN-71)"
```

---

### Task 6: The reporter in the landing page

**Files:**
- Modify: `landing-page/.gitignore` — **first, before anything else in this task**
- Create: `landing-page/.env.example`
- Create: `landing-page/src/helpers/report.ts`
- Create: `landing-page/src/instrumentation-client.ts`

**Interfaces:**
- Consumes: the service name `landing-page` from Task 5, which `NEXT_PUBLIC_IKNOS_SERVICE` must equal.
- Produces: nothing other code imports. `instrumentation-client.ts` is a Next file convention.

Implements spec §5 for IKN-71. This task is in a **different repository** — `/Users/cosmokaat/dev/landing-page`,
its own git repo. Its commits are separate from Iknos'.

- [ ] **Step 1: Close the hole first**

`landing-page/.gitignore` has **no env entry at all**, and this repo builds on the laptop
(`deploy.sh:330`) rather than on ks-b, so the token would be inlined from a local file sitting in
an unignored working tree. Append, after the `# generated` block:

```
# secrets — the ingest token is inlined into the bundle at build time, so the real file is local
# only. The example is the template and stays tracked.
.env*
!.env.example
```

Verify before writing any env file:

```bash
cd /Users/cosmokaat/dev/landing-page && printf 'NEXT_PUBLIC_IKNOS_INGEST_TOKEN="scratch"\n' > .env.production && git status --short && rm .env.production
```

Expected: `.env.production` does **not** appear in the output. If it does, stop — the ignore rule
is wrong and everything after this step would put a token in git.

- [ ] **Step 2: Write the template**

Create `landing-page/.env.example`, following `pfa/front/.env.example:19-30` — the landing page is
on a different origin from Iknos, so the URL is absolute, unlike the Iknos front's relative one:

```
# Template for `.env.production`, which is NOT committed. Copy this file, fill it in, and keep the
# real one on the machine that deploys — which for this site is the laptop: `deploy.sh` runs
# `pnpm build` here and rsyncs `out/`, so the values are inlined into the bundle before it leaves.
#
#   cp .env.example .env.production
#
# Empty values mean browser error reporting is simply off, which is the state a fresh checkout is
# in. Off costs nothing: with an empty token the reporter's guard folds to `false` at build time
# and the minifier drops the whole module — no `X-Iknos-Token` and no ingest URL anywhere in the
# bundle.

# Absolute, and on another origin: this site is not behind the nginx vhost that routes /api/ to
# Iknos. Three things must be open for it — this repo's CSP if the vhost sets one, CORS on the
# Iknos API, and the origin allowlist in Iknos' ecosystem.config.js. Remove one and the report
# dies in silence, by design.
NEXT_PUBLIC_IKNOS_INGEST_URL=https://iknos.1991computer.com/api/ingest

# Must exist and be enabled in Iknos' `service` table. The access log for this site lands under
# the same name, which is what puts both in one rail entry.
NEXT_PUBLIC_IKNOS_SERVICE=landing-page

# Must match `IKNOS_INGEST_TOKEN` in Iknos' ecosystem.config.js on ks-b; Iknos' copy is the one
# actually checked. Published inside the bundle, so it names a sender rather than authenticating
# one — the guards that hold are Iknos-side: the service registry, the origin allowlist, the rate
# limit. Empty or absent, the reporter compiles to nothing at all.
NEXT_PUBLIC_IKNOS_INGEST_TOKEN=""
```

- [ ] **Step 3: Copy the reporter**

```bash
cp /Users/cosmokaat/dev/iknos/front/src/lib/report.ts /Users/cosmokaat/dev/landing-page/src/helpers/report.ts
```

It has no imports and reads only the three `process.env` keys, so it needs no edit. Its header
already says it is meant to be copied rather than imported. Add one line to that header naming
this copy's home, after the existing first paragraph:

```
 * This copy lives in the portfolio, whose server half does not exist: the site is a static export
 * with no process and no stdout, so posted errors are the only thing a browser here can produce.
 * Its access log arrives by the other door entirely (IKN-16).
```

- [ ] **Step 4: Copy the instrumentation hook**

Create `landing-page/src/instrumentation-client.ts`. The Iknos original imports from `@lib/report`;
this repo's alias is `@helpers/*`:

```ts
import { initErrorReporting, noteNavigation } from "@helpers/report";

/**
 * Client-side instrumentation, the one thing tailing a log file cannot reach.
 *
 * Next runs this **after the HTML is loaded and before React hydrates**, which is the whole
 * reason the file convention exists: an error thrown while the app is coming up happens before
 * any component could have installed a handler, and this is the only code that is already there.
 *
 * Deliberately tiny. Next warns when client instrumentation takes more than 16 ms, and it is
 * right to: this runs on the critical path of every page load, for a feature that matters only
 * when something has already gone wrong.
 *
 * There is no `instrumentation.ts` beside it, and here that is not a choice — `output: "export"`
 * means there is no server at all. Every line this site produces comes from a browser, or from
 * nginx.
 */

initErrorReporting();

/**
 * Called by Next at the start of every App Router navigation.
 *
 * The page an error happened on is rarely the whole story; the page before it often is. This site
 * is one route with a modal driven by `?p=`, so the breadcrumb is thin — but it costs nothing and
 * the day a second route appears it is already right.
 */
export function onRouterTransitionStart(url: string): void {
  noteNavigation(url);
}
```

- [ ] **Step 5: Prove it builds under `output: "export"`**

This is the one thing the spec said to verify rather than assume — `instrumentation-client` is
aliased into the client bundle with no export-specific guard, but a build is the proof.

```bash
cd /Users/cosmokaat/dev/landing-page && pnpm build
```

Expected: a clean export into `out/`, with no warning about the instrumentation file being
ignored.

- [ ] **Step 6: Prove the empty config ships nothing**

With no `.env.production` present, the reporter must compile away entirely:

```bash
cd /Users/cosmokaat/dev/landing-page && grep -rl "X-Iknos-Token\|iknos.1991computer.com/api/ingest" out/ ; echo "exit: $?"
```

Expected: no files listed, `exit: 1` from grep finding nothing. If the token header appears in the
bundle with no token configured, the dead-code elimination did not happen and that is a finding
worth stopping on.

- [ ] **Step 7: Typecheck and lint**

```bash
cd /Users/cosmokaat/dev/landing-page && pnpm typecheck && pnpm lint
```

- [ ] **Step 8: Commit (ask first) — in the landing-page repo**

```bash
cd /Users/cosmokaat/dev/landing-page
git add .gitignore .env.example src/helpers/report.ts src/instrumentation-client.ts
git commit -m "report browser errors to iknos, under the name its access log already uses"
```

That repo's log is lowercase and unprefixed (`add Loamkeep to the fleet, with the gallery and
demo from its first take`) — match it rather than Iknos' `feat(scope):` convention.

---

### Task 7: The documentation that is now wrong

**Files:**
- Modify: `deploy/nginx/iknos.conf:52-54`
- Modify: `DEPLOY.md`
- Modify: `README.md`

**Interfaces:** none. This task ships no code.

Implements spec §6 and the two stale comments named in §4 and §9. Folded in here rather than into
each earlier task because it is one coherent read for a reviewer, and because the ks-b steps
belong together in one place someone follows top to bottom.

- [ ] **Step 1: Correct the vhost comment**

`deploy/nginx/iknos.conf:52-54` says Iknos ingests PM2 logs and not nginx's, which this wave ends:

```
    # Iknos's own access log rather than the shared one — and since IKN-16, a file Iknos reads:
    # `landing-page` is the first site whose row names its access log, and this vhost is next when
    # somebody decides whether it belongs to iknos-front or to a service of its own. The shared
    # /var/log/nginx/access.log could never be used for it, because `combined` carries no $host.
```

- [ ] **Step 2: Write the ks-b prerequisites into DEPLOY.md**

Add a section, in the shape `Zeus/DEPLOY.md:689-740` uses — it is the same three steps and a
reader who has done it once should recognise the form:

````markdown
## nginx access logs (IKN-16)

Three things on the box, none of them in this repository, and all three failing **silently** when
missed: the reporter swallows its own failures by design, and a tailer whose file does not exist
simply has nothing to say.

### 1. The site's vhost writes its own access log

In `/etc/nginx/sites-available/1991computer` inside the `server` block:

```
access_log /var/log/nginx/1991computer.access.log combined;
```

Without it the site's requests go to the shared `/var/log/nginx/access.log` along with everything
else, and `combined` carries **no `$host` field** — so there is no way to tell which lines are the
landing page's. This vhost already has the equivalent at `deploy/nginx/iknos.conf:55`.

The path must match the `log_glob` column on that service's row in `prisma/seed.ts`, character for
character. Then:

```bash
ssh debian@ks-b 'sudo nginx -t && sudo systemctl reload nginx'
```

### 2. The API's user reads it through the `adm` group

Log files under `/var/log/nginx/` belong to `root:adm`. The pm2 user needs to be in `adm` — a
read-only grant on log files, not a sudo rule and not a root process. Zeus needed the same and
documents it; if it was done for Zeus it is already done for Iknos, since both run as the same
user.

Check before assuming:

```bash
ssh debian@ks-b 'sudo -u debian head -c 200 /var/log/nginx/1991computer.access.log && echo "  ← readable"'
```

If it is not, `sudo usermod -aG adm debian` and restart the API so the new group takes effect —
group membership is read at process start, so a reload is not enough.

### 3. The origin is allowed to post browser errors

`IKNOS_INGEST_ORIGINS` in `nest-api/ecosystem.config.js` gains the site, comma-separated with no
trailing slash:

```js
IKNOS_INGEST_ORIGINS: "https://1991computer.com",
```

Environment changes need `--update-env`; a plain reload keeps the old environment:

```bash
ssh debian@ks-b 'cd /var/www/iknos && pm2 reload ecosystem.config.js --update-env'
```

### What this can and cannot see

- **The live file only.** logrotate's gzipped generations are out of scope: a tailer follows
  forward, and history from before it started is not its subject.
- **Access logs, not error logs.** `error_log` on ks-b is global rather than per-vhost, so
  per-site attribution would need a second and less pleasant prerequisite. A follow-up under
  IKN-28.
- **No `duration_ms`.** `combined` has no `$request_time`, so that column stays null for these
  rows and the Signals p95 is unaffected by them.
- **The same 14-day window as everything else.** `log_entry` is day-partitioned and dropped
  wholesale by `IKNOS_RETENTION_DAYS`; these rows cannot have a shorter one without a separate
  table.
````

- [ ] **Step 3: Update "Two ways in" in the README**

That section says there are two. Rename it **"Three ways in"** and add a third paragraph after the
`POST /api/ingest` one:

```markdown
The third arrived with IKN-16, and it is the collector again with a different pair of glasses: an
**nginx access log**, read by the same tailer with the same rotation and offset guarantees, parsed
from `combined` instead of from ECS. It exists for what no application can report — what nginx
answered without ever proxying, and the traffic of a static site that has no process to report
anything at all. A source names its files and reads one line; everything below that has always
dealt in one record type and did not change.

Which service a line belongs to comes from the **registry row**, not from the line: `combined`
carries no `$host`, so each vhost writes its own file and `Service.logGlob` says whose it is.
```

Also correct the `Status:` paragraph at the top if it still claims `/` is a static mock — the app
chassis and its views have shipped since it was written. Check it against the current
`src/app/(app)/` before editing; if it is already correct, leave it.

- [ ] **Step 4: Verify the docs describe reality**

Re-read the DEPLOY.md section against `prisma/seed.ts` and confirm the path in step 1 is byte-identical
to the `logGlob` value. A mismatch here is the single most likely way this wave ships and silently
collects nothing.

```bash
cd /Users/cosmokaat/dev/iknos && grep -n "1991computer.access.log" DEPLOY.md nest-api/prisma/seed.ts deploy/nginx/iknos.conf
```

Expected: the same path in DEPLOY.md and `seed.ts`.

- [ ] **Step 5: Commit (ask first)**

```bash
git add DEPLOY.md README.md deploy/nginx/iknos.conf
git commit -m "docs: a third way in, and the three things ks-b needs for it (IKN-16, IKN-71)"
```

---

## After the plan

**Deploy: api.** Plus the landing page via its own `deploy.sh`, and the three ks-b steps in
DEPLOY.md. Iknos' front does not change at any point in this plan.

**Order on the box matters.** Seed the registry row *after* the vhost is writing its file, or the
collector spends the gap logging a failed `stat` on a path that does not exist yet — the same
ordering trap `seed.ts` already warns about for worldweathr's two rows.

**Close the tickets when it lands.** IKN-16 and IKN-71 go to In Review, and the spec's §11 "As
built" gets filled in naming the commits — where the implementation left the design, in the shape
`2026-08-25-iknos-m3-alerts-design.md` uses. IKN-72 and IKN-73 stay in Backlog; this wave does not
touch them.
