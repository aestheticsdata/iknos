# Iknos

A self-hosted monitoring console for a small fleet of applications running on a single VPS.
Logs, metrics, issues and alerts for apps you already run, without operating an ELK stack to
get them.

**Status: M1 in progress.** The API and the collector are deployed and running on the box:
single-account auth, the PM2 log collector, and the log read routes (search, histogram, trace,
live tail). The four authentication screens are the real Next app; `/` is still the static mock
of the console at **<https://iknos.1991computer.com>**, because the app chassis and its views
have not landed yet. Work is tracked in Spira under the `IKN` project.

---

## The founding principle

**The tool is disposable, the interfaces are not.**

A monitored application writes ECS NDJSON to stdout and exposes `GET /metrics` in Prometheus
text format. It never talks to Iknos, never imports an Iknos client, never knows Iknos exists.
Iknos reads what PM2 already writes to disk and what the app already exposes over HTTP.

The consequence is the point: replacing Iknos with Loki or Grafana later is a collector swap
with zero change in the monitored applications.

## How it works

```
app (pino + @elastic/ecs-pino-format)
  │  stdout ──▶ ~/.pm2/logs/*.log
  │  GET /metrics (Prometheus text)
  ▼
iknos-api (NestJS)          tailer → parser → batch writer → MySQL
  │                         in-process event bus → SSE live tail
  ▼
iknos-front (Next App Router) ── /api/* over localhost, session cookie forwarded
```

- **Ingestion** is `tail -f` as a service. It follows PM2's log files by `stat` polling,
  tracking `(dev, inode, byteOffset)` so rotation, truncation and restarts resume exactly —
  the inode is what makes a rotation detectable rather than silently producing garbage from a
  byte offset that now means something else. The batch insert and the offset update share one
  transaction, which is what delivers no-loss-no-duplicate rather than careful sequencing.
- **Storage** is MySQL 8 with `log_entry` in daily `RANGE` partitions. Retention is
  `DROP PARTITION` — instant, and it returns disk to the OS, which a batched `DELETE` never
  does. The cost is full-text search — InnoDB forbids `FULLTEXT` on a partitioned table — so
  search is indexed filters over a mandatory time range plus `LIKE` on the pruned set. That
  trade is fine here: InnoDB's tokenizer shreds paths, UUIDs and trace ids, which is most of
  what you actually want to search a log for. Default retention is 14 days.
- **The API** serves keyset-paginated log queries, a volume histogram, a trace view assembled
  from rows sharing a `trace.id`, and a live tail over SSE. Every list response carries
  `meta.tookMs`, which the status bar renders, so a query that has quietly become slow is
  visible without going looking.
- **Self-observation** — Iknos logs through the same pino emitter it asks of everything else,
  so it is monitored by its own pipeline with no special casing.

### Two ways in

Tailing covers everything with a stdout, which is every backend and every server-rendered page.
It cannot reach a browser: a page has no stdout, so a JavaScript error never touches the host's
disk. Sentry, OpenTelemetry and pino's HTTP transports all resolve that the same way, because
there is only one way out of a browser — a POST.

So there is exactly one write route, `POST /api/ingest`, and it accepts **the same ECS JSON the
app would have printed to stdout**, through the same parser, into the same table. One schema, one
definition of what a log line is, and a posted browser error is indistinguishable from a tailed
server line once it lands.

It stays on the collector for everything else, and not out of purism: a process that crashes does
not POST its own stack trace. Tailing catches the crash, the OOM kill, PM2's restart line and the
output of libraries nobody controls.

The route is `@Public()` — a page on another domain has no session and never will. Four cheap
checks stand in for one, and the token is deliberately the weakest: it ships inside a JavaScript
bundle, so it names a sender rather than authenticating one, exactly like a Sentry DSN key. The
service registry lookup, the origin allowlist and the rate limit are what actually hold. With no
token configured the route answers 503 and the rest of the API boots normally.

`front/src/instrumentation-client.ts` is the reference client, meant to be copied into the fleet's
other frontends rather than imported by them.

### The read routes

Every one of them sits behind the session guard, which is registered globally and denies by
default — a route is public only if someone wrote `@Public()` on it.

| Route | What it answers |
|---|---|
| `GET /api/logs` | Filtered search, keyset-paginated, newest first |
| `GET /api/logs/histogram` | Counts per interval and per level, server-chosen granularity |
| `GET /api/logs/trace/:traceId` | The lines sharing a `trace.id`, in order |
| `GET /api/logs/stream` | Live tail over SSE, straight off the in-process bus |
| `GET /api/services` | The registry, for the filters and the service rail |
| `POST /api/ingest` | The one write route — see below |

`from` and `to` are **required** on all of them and a request without both is a 400, never a
widened default. That single rule is what the partitioning rests on: the range predicate lets
MySQL discard whole partitions before it evaluates a filter, and one forgotten parameter would
otherwise turn a page load into a scan of the entire retention window.

### Measured

On **10,240,001 rows** across seven daily partitions (4.5 GB), on a laptop — median of five runs:

| Query | |
|---|---|
| Search, one day, one service | **2 ms** |
| Search, one day, one service, `LIKE` substring | 275 ms |
| Search, one day, page 20 by cursor | 240 ms |
| Search, seven days, `level >= 50`, every service | **4,719 ms** |
| Histogram, one day, 24 buckets, every service | 920 ms |
| Histogram, one day, one service | 494 ms |
| Trace lookup, seven days | **4 ms** |
| `DROP PARTITION` of all 10.2 M rows | 2,043 ms, 4.5 GB returned |

Two things to read out of that. The common case — a day, a service — is instant, and so is a
trace. The weak spot is a **wide window with no service filter**: seven days of every service at
`level >= 50` takes nearly five seconds, because a range predicate on `level` cannot also use
`ts` inside the same index. If the fleet ever grows to this volume, that query needs either a
mandatory service filter or its own composite index.

This is a ceiling, not an expectation. The fleet these numbers were built for logs a few thousand
lines a day, not the 1.4 million a day this table holds — roughly **150× more than reality**. At
the real volume every one of these is sub-millisecond and none of the partitioning matters. It is
measured here so the number exists before someone needs it, not because it is needed now.

## The choices, and what they cost

### ECS, and why not OpenTelemetry

A log line here is **ECS** — Elastic Common Schema — which is to say `@timestamp`, `log.level`,
`message` and `url.path`, rather than whatever each application felt like calling them.

The obvious alternative was OpenTelemetry, and it was declined on what OTel is actually for. It
is three things: a vocabulary of field names, a wire protocol called **OTLP** for pushing
telemetry to a backend, and SDKs that instrument your code. Its distinguishing feature is
**traces** — trees of spans, each carrying a parent and a duration, which is what produces the
waterfall saying a 340 ms request spent 300 ms inside one query. Iknos stores lines, not spans. A
log line has a timestamp, not a duration and a parent, and the log half of OTel is exactly what
ECS already gives.

That is less of a fork than it looks. Elastic donated ECS to OpenTelemetry in 2023 and the two
vocabularies have been merging into OTel's semantic conventions since — which is why the HTTP
fields written here (`http.request.method`, `url.path`, `url.query`,
`http.response.status_code`, `user_agent.original`) are already the names both sides agree on.
What stays ECS-only is small and mechanical:

| ECS | OTel |
|---|---|
| `client.ip` | `client.address` |
| `@timestamp` | `Timestamp` |
| `log.level` | `SeverityText` + `SeverityNumber` |
| `message` | `Body` |
| `event.duration` (ns) | span duration |

A collector renames those in a processor block. It is a config file, not a re-instrumentation.

What Iknos does not have, and should not be read as having, is **distributed tracing**. Rows
share a `trace.id` and the trace view assembles them, which answers *show me every line from
this request across services*. It does not answer *where did the 300 ms go*, and no amount of
log correlation ever will.

### What portability actually costs

Three layers are worth separating, because they are standard to very different degrees. **The
format** is what one line looks like — ECS, an industry standard, and the layer baked into every
monitored app. **The transport** is how the line travels; there are two, one standard and one
not. **The backend** is what stores and shows it — Iknos, disposable by design.

Measured in lines of application code, deleting Iknos tomorrow and installing Loki instead costs:

| | |
|---|---|
| every server-side app in the fleet | **0 lines** |
| each frontend's browser reporting | **~20 lines**, one `send()` function |

The stdout half is free because nothing in an application knows the collector exists: it prints,
PM2 writes a file, and Filebeat, Vector, Fluent Bit or an OTel collector's `filelog` receiver all
read files for a living. The POST half is not free, because the URL, the `X-Iknos-Token` header
and the `{service, events}` envelope are Iknos's own invention. OTLP is the industry standard for
that job and is deliberately out of scope — its envelope is deeply nested and its browser SDK
weighs hundreds of kilobytes, which is machinery without a counterpart for six apps and one user.
A second OTLP endpoint would sit beside this one without changing anything else.

One distinction the numbers hide: Iknos is not *interchangeable*, it is *disposable*. Nobody
swaps the collector for Filebeat and keeps Iknos running — the whole thing is deleted and
something else installed in its place. What has to be portable was never Iknos. It is the
interface its applications depend on, and they depend on almost nothing.

### pino, and why not winston

winston's central idea is that the application decides where its logs go: file transports,
rotation, HTTP shipping, each with its own level and format, all configured inside the app.
pino's is that the application prints and forgets, and the platform routes.

The second one is this project's founding principle. Choosing winston would have meant buying a
feature set whose entire purpose is the thing the architecture was designed against.

What follows from it:

- pino's default output already **is** the ingestion format. No adapter, no formatter to
  configure, nothing to get wrong.
- Expensive work — pretty-printing, shipping over a network — runs in a worker thread rather
  than on the request path.
- Its numeric levels, 10 trace through 60 fatal, are the parser's `LEVELS` map rather than a
  translation of it.
- `nestjs-pino` gives per-request child loggers, which is where a `trace.id` attaches.
- Speed matters more here than in an ordinary application, because Iknos logs through the same
  emitter it demands of everything else. A slow logger would tax the monitoring itself.

**The cost is that pino is less forgiving.** Its redaction runs *after* `formatters.log`, so a
converted request is `http.request.headers` while one that failed to convert is still `req` —
cover one shape and the other publishes the credential. That is not hypothetical: it shipped,
and session cookies were found in the table by reading it. `src/common/logger.ts` now lists both
spellings and says why. winston's in-process formatting pipeline is easier to reason about, and
that is the trade which bought the architecture.

None of which disqualifies winston as an emitter elsewhere in the fleet. Elastic ships
`@elastic/ecs-winston-format` too, and the parser accepts three grades of input — full ECS, bare
JSON, plain text — so a winston application lands in the table regardless. It simply lands with
fewer promoted columns unless configured for ECS. The difference is that with pino the right
thing is the default.

### No adapter layer

The tempting move, when a backend might one day be swapped, is to wrap the sending in a facade so
the swap is easy. It was not made, for three reasons.

**It already exists.** `front/src/lib/report.ts` exposes `report()` and `initErrorReporting()`;
application code never sees the URL, the token or the envelope. Another layer would wrap a
wrapper.

**There is nothing to wrap on the server.** Applications call pino, and pino is not Iknos — swap
the backend and pino stays exactly where it is. A facade there would defend against a risk that
does not exist, at the price of re-exposing child loggers and serializers one by one.

**And an interface would not shrink the swap.** What sits behind it is twenty lines with exactly
one implementation; on the day it changes, those lines are deleted and new ones written. An
abstraction does not make deletion cheaper.

The abstraction that pays here is the format. An adapter abstracts a function call and only works
inside one codebase; a data format works across languages, processes and tools nobody has chosen
yet — which is the layer this project spent its portability budget on, deliberately.

If the swap cost ever needs reducing further, the lever is packaging rather than indirection:
`report.ts` is meant to be copied into each frontend, so five fronts make a swap five edits
instead of one. At two fronts, copy-paste still wins.

## Two things this got wrong

Both were found by trying to prove the opposite of what the ticket claimed, and both are recorded
here because the method is the transferable part, not the bug.

### A dead flag that had never worked

`nest-api/tsconfig.json` declared nine path aliases, PM2 launched the process with
`-r tsconfig-paths/register` to resolve them, and 209 imports across `src/` and `test/` used none
of them. The ticket concluded that production, the dev watcher and the test runner were all broken
by that gap.

Two of those three were false. `@nestjs/cli` rewrites aliases **at emit time** —
`tsconfigPathsBeforeHookFactory`, a TypeScript transformer the CLI pushes into `transforms.before`
on every emit, including the incremental ones in watch mode. After a build,
`dist/src/common/*.js` reads `require("../config/body-limit")`, and a grep across the whole of
`dist/` finds no alias specifier at all. Raw `tsc` does not do this; the CLI does. Production and
`pnpm dev` had never been broken. Only vitest was, and that fix was one line.

The register flag was worse than redundant — it was **incapable** of the job its own comment
claimed. Proven by negative control: raw `tsc` output, aliases left unrewritten, planted in
`dist/` and launched with PM2's exact flags, which throws `Cannot find module
'@config/body-limit'` from inside the hook. With `baseUrl` at `./` and the paths pointing at
`./src/*`, the resolver aims at the TypeScript source, which `require` cannot load. It could never
have caught a single alias, on any day, in any configuration.

Then removing it broke the deploy. The first release crash-looped on `Cannot find module
'tsconfig-paths/register'` at preload: the synced ecosystem file no longer carried the flag, but
**`pm2 reload` never applies a `node_args` change to a running process**. PM2 kept relaunching
with the old argument list, and because the same commit had dropped the package, dead config
became fatal config. It took a `pm2 delete` and a `pm2 start` to clear. Deleting something unused
is not free when a process manager is caching the arguments.

### A limit nobody chose, hiding a bug nobody had hit

`POST /api/ingest` advertises a batch of a hundred events. Express was applying its default 100 kB
body limit, which nobody in this repository had chosen.

A browser error weighs one to three kilobytes of escaped stack trace, so the body saturated around
forty events — less than half the advertised batch. The failure mode is what makes it worth
recording: invisible while a page throws twice, systematic the moment a component loops on every
render. It broke **exactly** the batch that mattered. And `report.ts` swallows its failures by
design, so nothing anywhere said so. `JSON_BODY_LIMIT` is 1 MB now, about 10 kB an event.

The test written to prove the 413 found a 500 instead. The body parser runs ahead of the Nest
router, so what it throws is a bare `Error` rather than an `HttpException` — `AllExceptionsFilter`
read that as a bug, answered "internal error" and logged a stack trace, blaming the server for a
request it had just refused correctly. That had been true before the ticket, and on every route
rather than this one. Malformed JSON now answers 400 across the API instead of 500.

## The interface

Service-scoped, not fleet-wide: you pick a service in the rail and the whole screen answers
about that service. A dark chassis that never moves, a light work surface you read for an
hour, and the log stream as a dark window inset into it. One screen at 1440×900, no page
scroll. Keyboard is a first-class input (`j/k`, `⌘K`, `⌘L`, `⌥⏎`), advertised permanently in
the status bar.

Views whose data does not exist yet are **absent, not faked** — no placeholder charts, no
lorem numbers.

See [`docs/design/iknos-prototype.dc.html`](docs/design/iknos-prototype.dc.html) for the
retained mockup.

## Stack

| Layer | Choice |
|---|---|
| API + collector | NestJS, one process, two modules that never import each other |
| ORM | Prisma 7 with `@prisma/adapter-mariadb`, raw SQL where it earns it |
| Database | MySQL 8, daily RANGE partitioning on `TO_DAYS(ts)` |
| Sessions | Redis, opaque cookie, CSRF compared in constant time |
| Web | Next App Router, Tailwind v4, `nuqs` for URL state |
| Deployment | Two PM2 processes behind nginx, built on the target host — `iknos-front` on 3006, `iknos-api` on 6900 |

The repository is laid out like the rest of the fleet: `nest-api/` and `front/` side by side,
each an independent pnpm root with its own lockfile, Prisma inside the API, and one deploy
script per half. Same shape as Zeus, PFA and spira, so a habit learned in one of them transfers
without translation. There is deliberately no root workspace and no shared package — the front
restates the response types rather than importing them, which is the call trekker made and
documents in the files that do it.

Auth is single-account and self-sealing: registration is open while the user table is empty
and closed forever after, enforced by a `UNIQUE` column rather than an environment flag
someone has to remember to set. There is no mail server on the host, so recovery is a
passphrase chosen at account creation.

## Milestones

| | Scope |
|---|---|
| **M1** | Walking skeleton — ingestion, log panel, histogram, live tail, trace view, auth, ⌘K palette, collector status |
| **M2** | Metrics and health — Prometheus scraping, health probes, hourly rollups, service and metrics views |
| **M3** | Issues and alerts — error grouping by fingerprint, an alert rule engine, and the views for both |
| **M4** | nginx access logs with visible client IPs and on-demand whois — the host is probed daily |

The emitter side of M1 and M2 lands in the monitored applications rather than here: ECS
logging and a `/metrics` endpoint are one ticket each per app.

Out of scope throughout: notification channels, distributed tracing, HTTP ingestion from other
hosts, per-user roles. The schema keeps each of those additive.

## Documentation

| Document | What it is |
|---|---|
| [`specs/2026-08-10-iknos-nestjs-api-design.md`](docs/superpowers/specs/2026-08-10-iknos-nestjs-api-design.md) | Backend design — storage, ingestion, API, auth, deployment |
| [`specs/2026-08-09-iknos-ui-design.md`](docs/superpowers/specs/2026-08-09-iknos-ui-design.md) | UI design and information architecture, from the mockup |
| [`plans/2026-08-10-iknos-m1-logs-nestjs.md`](docs/superpowers/plans/2026-08-10-iknos-m1-logs-nestjs.md) | M1 implementation plan, 31 tasks, TDD step by step |
| [`design/`](docs/design/) | The mockup, and the exploration that produced it |
| [`DEPLOY.md`](DEPLOY.md) | The box, the ports, the vhost, and how the mock gets shipped |
| [`mock/index.html`](mock/index.html) | The static mock behind the URL above — one file, no build |

Two documents are kept but **superseded**, because the reasoning in them is still worth
reading: [`specs/2026-08-09-iknos-rust-api-design.md`](docs/superpowers/specs/2026-08-09-iknos-rust-api-design.md)
and [`plans/2026-08-09-iknos-m1-logs.md`](docs/superpowers/plans/2026-08-09-iknos-m1-logs.md)
describe the same product with a Rust backend. The language changed for a reason unrelated to
architecture — carrying an unfamiliar language alongside several other active projects — and
most of the design survived intact.
