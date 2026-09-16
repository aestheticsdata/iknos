# M4 wave 1 — the nginx ingestion source, and the landing page as a service

**Tickets:** IKN-16 (the source), IKN-71 (the landing page), under epic IKN-28.
**Precedent:** IKN-29 built `POST /api/ingest` and the browser reporter; `pfa-front` is the one
front that has adopted it, and this wave adds the second.

IKN-16 was written on 2026-08-03 and six weeks of shipping have overtaken it. It predicted a
schema migration, new API routes and a new view. None of the three is needed. §9 says which
premises died and what killed them; read it before the ticket.

The wave exists because of one question — *who visits the landing page* — and that question has
two halves that arrive together: the site is static, so its errors can only be posted, and its
traffic can only be read from nginx.

---

## 1. Decisions

| | Decision | Why |
|---|---|---|
| D1 | One `Tailer`, N `Source`s — not one tailer per source | `state`, `bytesRead`, `lastPollAt` and `trackedFiles` keep today's meaning and `stats()` is untouched; two tailers would mean aggregating four fields and splitting `hydrate` |
| D2 | A `Source` is `{ files(), parse() }` — two functions, no shared state | `files()` returning `{file, service, stream}` deletes the `resolve` step rather than coupling it to a map the other method built |
| D3 | `files()` is re-evaluated every tick, per source | That is already why `poll()` re-globs (`tailer.ts:89`): a newly deployed app is picked up without a restart. A newly registered site inherits the property for free |
| D4 | The access log path lives in `Service.logGlob` | The column exists (`schema.prisma:36`) and **nothing reads it**. Putting it here keeps the registry's promise — "adding an app is a row, not a code change" — and needs no migration |
| D5 | One service per site, not one `nginx` service | The user's question is per-site. `combined` carries no `$host`, so per-site attribution *requires* a per-vhost file anyway — and once the file is per-vhost, its name is the attribution |
| D6 | Level is derived from the status code | 2xx/3xx → info, 4xx → warn, 5xx → error. It is what makes the existing level filter and the `level >= 50` searches work on nginx lines without a second control |
| D7 | `logger` carries `nginx.access` | The column exists for exactly this, and it is what separates nginx lines from posted browser errors inside one service |
| D8 | Query strings are stripped from `route`, kept in `attrs` | `route` is `VarChar(255)` and carries `@@index([route, ts])` (`schema.prisma:130`); unstripped query strings would make that index cardinality noise |
| D9 | **Access logs only this wave.** Error logs deferred | Different grammar, and `error_log` is global on ks-b rather than per-vhost — a second prerequisite on the box for a smaller return. §8 |
| D10 | No nginx noise filter in wave 1 | `isHealthProbeNoise` (`parser.ts:151`) was written against observed traffic. Inventing the nginx equivalent before a line has landed is guessing. §10 |

---

## 2. The `Source` seam

The tailer hard-codes two calls, and they are the only two things in the ingest module that know
what a log line looks like:

```ts
// tailer.ts:158, inside pollOne
const record = parse(line, service, stream);
```

…where `service` and `stream` came from `serviceAndStream(file)` (`tailer.ts:36`), which encodes
PM2's `<app>-out-<pm_id>.log` convention. Everything downstream is already format-agnostic:
`Chunk` (`writer.ts:28`), the `Writer`, `LogBus` and `persistBatch` deal in `LogRecord` and have
never needed to know where one came from.

So the seam is those two calls, and nothing else:

```ts
/** One file this source follows, and who it belongs to. */
export type SourceFile = { file: string; service: string; stream: "out" | "err" };

export type Source = {
  /** For logs and errors — which source is speaking when one of them fails. */
  readonly name: string;
  /**
   * Swept every tick. Re-evaluated rather than cached, which is how a newly deployed PM2 app —
   * and now a newly registered site — is picked up without restarting Iknos.
   */
  files(): Promise<SourceFile[]>;
  parse(line: string, service: string, stream: "out" | "err"): LogRecord | null;
};
```

`Tailer`'s constructor takes `(sources: Source[], submit)` in place of `(pattern, submit)`. `poll()`
becomes a loop over sources, then over that source's files:

```ts
async poll(): Promise<void> {
  for (const source of this.sources) {
    let files: SourceFile[];
    try {
      files = await source.files();
    } catch (err) {
      // A source that cannot even list its files must not stop the others. The nginx source
      // reads MySQL, so this is the DB-down case — and the PM2 sweep is exactly what someone
      // debugging a DB outage is reading.
      logger.error({ err, source: source.name }, "source file listing failed");
      continue;
    }
    for (const sf of files) {
      try {
        await this.pollOne(sf, source);
      } catch {
        // Unchanged: a file that vanished mid-poll is normal during rotation.
      }
    }
  }
  this.lastPollAt = new Date();
}
```

`pollOne` takes the `SourceFile` and the `Source` instead of deriving service and stream itself,
and calls `source.parse` at `tailer.ts:158`. **Nothing else in the file changes** — `decide()`,
the rotation handling, `LineBuffer`, the committed-offset arithmetic and the byte accounting are
all untouched, and their specs still pass unmodified.

`state` stays one map keyed by `filePath`. Two sources cannot collide there: `~/.pm2/logs/*.log`
and `/var/log/nginx/*.access.log` share no path. `hydrate()`, `trackedFiles`, `bytesRead` and
`lastPollAt` keep their current single-value meaning, which is what keeps `IngestService.stats()`
and `GET /api/collector/status` (IKN-24) out of this change entirely.

### 2.1 The two implementations

**`Pm2Source`** is today's behaviour, moved: `files()` materialises `glob(pattern)` and maps each
path through the existing `serviceAndStream`; `parse` is the existing `parse`. `serviceAndStream`
keeps its name, its tests and its comment about the trailing process id — it becomes a private
detail of this source rather than a tailer export.

Materialising the glob is the one behavioural difference. `poll()` currently streams it with
`for await`; collecting ~40 paths into an array before reading any of them costs nothing at fleet
scale and makes `files()` one type for both sources.

**`NginxSource`** reads the registry:

```ts
async files(): Promise<SourceFile[]> {
  const rows = await this.prisma.service.findMany({
    where: { enabled: true, logGlob: { not: null } },
    select: { name: true, logGlob: true },
  });
  return rows.flatMap((r) => (r.logGlob ? [{ file: r.logGlob, service: r.name, stream: "out" as const }] : []));
}
```

`enabled` is honoured here for the same reason the scraper honours it (`scrape.service.ts:119`):
a service someone paused stays paused, and pausing must stop the reading, not merely hide it.

`stream: "out"` always. The stream argument only decides the fallback level for a line that
carries none, and the nginx parser always derives a level from the status code — so the value is
inert, and `"err"` would be a lie about a 200.

---

## 3. The combined-format parser

```
$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
```

```
203.0.113.5 - - [16/Sep/2026:14:02:31 +0200] "GET /shots/iknos/logs-960.avif HTTP/2.0" 200 31245 "https://1991computer.com/" "Mozilla/5.0 …"
```

| `LogRecord` field | From | Notes |
|---|---|---|
| `ts` | `$time_local` | `16/Sep/2026:14:02:31 +0200`. The offset is in the line; never assume the server's |
| `service` | the registry row | Not the line — `combined` carries no `$host`. §6 |
| `level` / `levelName` | `$status` | D6. 2xx/3xx → 30 `info`, 4xx → 40 `warn`, 5xx → 50 `error` |
| `logger` | constant | `nginx.access` (D7) |
| `message` | `$request` + `$status` | `GET /shots/iknos/logs-960.avif 200` — what the Logs table row shows |
| `clientIp` | `$remote_addr` | The point of the exercise |
| `httpMethod` | `$request` | |
| `route` | `$request` | Path only; query into `attrs` (D8) |
| `statusCode` | `$status` | |
| `durationMs` | — | **null.** `combined` has no `$request_time`. §10 |
| `userId` | `$remote_user` | `null` when `-` |
| `hostname` | — | null. Nothing in the line carries it |
| `traceId` | — | null |
| `attrs` | the rest | `referrer`, `userAgent`, `bytes`, `protocol`, `query` — omitting each when `-` or absent |

**A line that does not match is stored, not dropped.** Same rule as the ECS parser's
`plainText` path (`parser.ts:106`): the raw line becomes the message, `degraded: true` is set, and
`GET /api/collector/status` counts it. A format that has quietly changed on the box must be
visible as a rising degraded count, not as silence.

The parser is a pure function with its own `.spec.ts` beside the existing `parser.spec.ts`, and it
imports nothing from Nest — the same shape `parser.ts`, `rotation.ts` and `line-buffer.ts` already
have.

---

## 4. Configuration

Nothing new in the environment. `IKNOS_PM2_LOG_GLOB` (`.env.example:34`) keeps its meaning and
feeds `Pm2Source`; `NginxSource` is configured entirely by registry rows, which is D4.

`IngestModule`'s factory (`ingest.module.ts:32-37`) gains the second source. `IngestService`'s
constructor takes `sources: Source[]` rather than `pattern: string`, and the factory builds both —
which also retires the comment at `ingest.module.ts:20-22` explaining why the first parameter is a
plain string.

Seeding a site is one row:

```ts
{
  name: "landing-page",
  pm2Name: "landing-page",
  metricsUrl: null,
  healthUrl: null,
  logGlob: "/var/log/nginx/1991computer.access.log",
},
```

`pm2Name` repeats `name`. This is the row `schema.prisma:30-31` predicted — "the column exists for
the sources that are not PM2 processes at all" — arriving one ticket earlier than that comment
guessed, and for a static site rather than for nginx-as-a-service. Both consumers degrade
correctly: `RuntimeService` finds no `process_sample` and reports `process: null`
(`runtime.service.ts:36`), and the `process_restart` rule returns `{ value: null, breached: false }`
when the map misses (`process-restart.ts:56`). No false alert, no false green.

The seed's comment about nginx being "deliberately absent" is rewritten in the same commit: it is
no longer true, and the reason it was true — no ingestion source — is what this ticket removes.

---

## 5. The landing page, by both doors

IKN-71. The site is a Next `output: "export"` build rsynced to `/var/www/1991computer/public_html`
(`landing-page/next.config.js`, `deploy.sh`). No PM2 process, no port, no stdout — which is why it
has never appeared in the rail.

**Door one — posted browser errors.** `front/src/lib/report.ts` is the reference client and says
so in its own header; `pfa/front/src/lib/report.ts` is the existing copy. It goes to
`landing-page/src/helpers/report.ts` — that repo's tsconfig declares `@helpers/*` and has no
`@lib` — with `src/instrumentation-client.ts` beside it, and the three `NEXT_PUBLIC_IKNOS_*`
variables.

**Door two — the access log**, via §2–§4 above, under the same service name. One rail entry whose
Logs view holds both, separated by `logger` when you want them apart. That unification is the same
trick `POST /api/ingest` already plays with tailed lines, and it is the reason D5 was worth the
per-vhost file.

**Two hazards in that repo specifically.** Its `.gitignore` has no `.env` entry at all, and unlike
pfa and Iknos it **builds on the laptop** rather than on ks-b (`deploy.sh:330`) — so the token is
inlined from a local file that is currently one `git add` from being committed. `.env*` with a
`!.env.example` negation lands in the same commit as the reporter, before the real file exists.

And `next.config.js` sets no CSP, by design: it documents that `headers()` is inert under
`output: "export"` and that response headers belong to the vhost. So if that vhost sends a
`Content-Security-Policy`, `connect-src` needs `https://iknos.1991computer.com` added there —
pfa needed exactly this and records it at `pfa/front/next.config.js:28-31`. §6.

---

## 6. What ks-b needs

Three things, none of which can be done from the repository, and all of which fail *silently* if
missed — the reporter swallows its own failures by design, and a tailer with no file simply has
nothing to say.

**6.1 The landing page's vhost writes its own access log.**

```
access_log /var/log/nginx/1991computer.access.log combined;
```

Without it the site's requests land in the shared `/var/log/nginx/access.log` alongside pfa's and
bkmk's, where `combined` carries no `$host` field and they cannot be told apart. Zeus hit this
exact wall and documents it at `Zeus/DEPLOY.md:689-699`; Iknos' own vhost already carries the
equivalent line at `deploy/nginx/iknos.conf:55`.

**6.2 The API's user can read `/var/log/nginx/`.** Zeus needed the pm2 user in the `adm` group and
documents it (`Zeus/DEPLOY.md:714`). Iknos' `DEPLOY.md` says nothing about it. Same user on the
same box, so the grant is probably already in place — but it is a precondition, and a `head -c 200`
against the file settles it before anything is built.

**6.3 `IKNOS_INGEST_ORIGINS` gains `https://1991computer.com`.** It lives in
`nest-api/ecosystem.config.js` on the box, which is not in git. Changing it needs
`pm2 reload … --update-env`; a plain reload keeps the old environment.

The comment at `deploy/nginx/iknos.conf:52-54` — "Iknos ingests PM2 logs, not nginx's" — becomes
false with this ticket and is rewritten in it.

---

## 7. Testing

Unit, beside the existing ingest specs and in their style:

- **`nginx-parser.spec.ts`** — the field mapping; the status→level bands at each boundary (199,
  200, 399, 400, 499, 500); `-` in each optional position; a query string split off `route`; IPv6
  and IPv4-mapped-IPv6 in `$remote_addr`; the `+0200` offset honoured rather than assumed; a
  garbage line landing `degraded` with its bytes intact.
- **`tailer.spec.ts`** — extended, not rewritten: two sources over two directories in one pass;
  one source's `files()` throwing while the other still sweeps; offsets for the two never
  colliding. The existing rotation, restart and truncation cases keep passing **unmodified**,
  which is the evidence D1 was the cheap shape.
- **`Pm2Source`** inherits `serviceAndStream`'s existing cases verbatim.

One e2e, in `nest-api/test/`, in the shape the nineteen existing suites use: a registry row whose
`logGlob` points at a temp file, lines appended, and the assertion that they arrive in `log_entry`
under that service with `client_ip` populated and `logger = 'nginx.access'` — plus a rotation
mid-run, since no-loss-no-duplicate is the one guarantee this module exists to hold.

No front tests: the front does not change. §9.3.

---

## 8. Out of scope

- **nginx error logs (D9).** Different grammar, and `error_log` on ks-b is global rather than
  per-vhost, so per-site attribution would need a second and less pleasant prerequisite on the
  box. A follow-up under IKN-28, unwritten.
- **Every other vhost.** The seam makes adding one a row, but `iknos.access.log` covers both the
  front and `/api/`, so attributing it needs a decision — `iknos-front`, or a third service — that
  the landing page does not force. Deliberately unanswered here.
- **The IP column, the IP filter, and grouping by IP.** IKN-16's §2, now IKN-72.
- **whois and geolocation.** IKN-16's §3, now IKN-73.
- **A shorter retention for access logs.** §10.
- **Gzipped logrotate generations.** A tailer follows forward; history before it started is not
  its subject. Same boundary Zeus drew (`Zeus/DEPLOY.md:743`).

---

## 9. Where the tickets are stale

IKN-16 called itself "the widest ticket in the backlog", touching ingestion, the schema, the API
and the UI. Three of those four are now false.

**9.1 No migration.** The ticket predates the columns. `log_entry` already carries `http_method`,
`route`, `status_code`, `duration_ms`, `client_ip` and `hostname`, plus `attrs`
(`schema.prisma:109-121`) — every field a combined line has, and one it does not. `Service.logGlob`
(`schema.prisma:36`) is likewise already there and read by nothing.

**9.2 No new API routes.** `GET /api/logs` filters by service and level and is what the rail
already calls. A wave that adds rows to `log_entry` under a registered service name is served by
the routes that exist.

**9.3 No new UI.** The ticket asks that the view "reuse IKN-12's log component rather than build a
second one". It reuses it completely: IKN-58 shipped client IP in the detail pane with a copy
button (`RowDetail.tsx:284-310`), which is the whole of what this wave needs on screen. The IP
*column* and grouping — a genuine UI change — are IKN-72, not this one.

**9.4 `nginx` is not a service.** The ticket's Done list says "`nginx` appears in the service rail
with its state". D5 replaces that: per-site rows, because `combined` carries no `$host` and the
question being asked is per-site. The mockup's `nginx` rail entry, which IKN-16 quotes as "the
right intention and the wrong source", turns out to be the wrong intention too.

**9.5 The volume warning stands.** "Access logs are far more verbose; the bounded queue must be
sized accordingly" is the one premise time has not touched — see §10.

---

## 10. Open items

**Retention is shared and cannot cheaply be split.** `log_entry` is partitioned by day and dropped
wholesale by `IKNOS_RETENTION_DAYS` (`.env.example:27`), so nginx lines inherit the 14-day window
whether or not that is what you would choose for them. A separate window means a separate table,
which means a second read path — far more than one portfolio vhost justifies. Revisit if this ever
widens to every vhost on ks-b.

**The writer's queue is shared.** Both sources feed one `Writer` and its `MAX_QUEUED_RECORDS`.
At one static site's volume this is not a consideration; at every-vhost volume the access logs
would be competing with the application logs for the same bounded queue, and the drop accounting
would not say which lost. That is the number to watch before widening.

**No noise filter yet (D10).** `isHealthProbeNoise` exists because health probes were observed
flooding the table. The nginx equivalent — if it is scanner traffic, it is the *content*, not
noise — should be written against real rows, not guessed at. Revisit after a week of data.

**`durationMs` needs a custom `log_format`.** `combined` has no `$request_time`, so the column
stays null for nginx lines and the Signals p95 is unaffected by them. A `log_format` carrying it
would be a change to every vhost that wants it; not worth it for one static site, and worth
reconsidering if the ingestion widens.

---

## 11. As built

*Filled in when the wave ships, naming the commits — the shape `2026-08-25-iknos-m3-alerts-design.md`
uses.*
