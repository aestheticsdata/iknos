# The mock corpus (IKN-61)

These files are seven days of a plausible ks-b: ~14 000 ECS log lines across the 19 registry
services (`mock/logs/<service>.ndjson` — `.ndjson` because `.gitignore` eats `*.log`), metric
samples and hourly rollups for the whole fleet — fronts included, each with its own volume and
latency character, at full density for the two really instrumented services and a lighter grid
for the rest (`metrics.json`, `rollups.json`; `hiwaysim` alone has none, on purpose — it is
stopped in pm2, and one service demonstrating the honest empty-tiles state is coverage) — health
probes for the five services that carry a `healthUrl` (`health.json`), machine and pm2 readings
(`host.json`, `processes.json`), and the grouped history the M3 views read (`issues.json`,
`alerts.json` — fingerprints computed by the real `fingerprintOf`, every alert episode closed so
the live engine keeps sole ownership of open ones). Three incidents live in the week: a 5xx
burst four days back, a latency spike at −26 h, and a 20-minute health outage at −3 h, each
coherent across logs, metrics, probes, issues and alerts. The files are ordinary text — open
them, edit them, diff them; two loads give the same demo because it is the same file.

One registry nuance: the signal tiles only exist for a service whose row carries a `metricsUrl`,
and the real fleet has two. So after seeding, the loader fills the missing `metricsUrl` with a
placeholder pointing at the front's own port — a 200 the exposition parser silently reads zero
samples from, so the scraper never warns. Fill-only: the day an app gets real instrumentation,
`seed.ts` sets the true URL and the loader never touches it. `healthUrl` is deliberately left
alone — a probe at a dead port writes a failing row, and the loader must not paint the fleet
red to decorate it.

Two commands, two verbs. **`pnpm mock`** loads the corpus: it seeds the service registry first
(`pnpm seed`, idempotent), resets the data tables it fills — never `app_user`, never `service`,
never `ingest_offset` — then shifts every timestamp by one delta so the newest row lands on the
moment you ran it, and writes through the production `parse()` and `persistBatch`. Nothing runs
afterwards. **`pnpm mock:author`** regenerates these files from `author.ts` and is only for
deliberately remaking the corpus: it is deterministic (fixed reference instant, seeded PRNG —
rerun it unchanged and `git diff` on `mock/` stays empty), it is never called by `pnpm mock`,
`pnpm dev` or the API, and its output gets committed like any other source.

On ks-b, the same corpus is the recruiter demo. Once per deploy generation: `pnpm seed:user` to
create the demo account. Then, and again whenever the demo should look fresh (it ages —
the corpus is anchored at load time, and boot-time retention prunes the metric-window tables
after ~3 days): `export DATABASE_URL=…` is not needed, the loader reads the pm2 ecosystem —
`pnpm mock -- --production`. The flag is demanded whenever the loader detects production
(`NODE_ENV`, or a `DATABASE_URL` sourced from `ecosystem.config.js`), because the reset also
clears the real ingested rows — accepted in IKN-61: retention capped that history at 14 days
and the tailer refills within the minute. A non-loopback `DATABASE_URL` is refused outright,
flag or no flag.

Two things keep moving underneath, in dev exactly as in prod, and both are the tool working:
the tailer keeps ingesting the machine's real `~/.pm2/logs` on top of the corpus (that is why
off-corpus services can appear in the rail), and the prober keeps probing the registry's health
URLs — on a laptop where nothing listens on those ports it will honestly write failures over the
corpus's green history within a minute, and the header pill marks any probe older than 90 s as
stale. The demo is freshest in the minutes after a load; reload at will.

One more thing shares this database: `pnpm test`. The e2e suite replaces the local account
(`test/helpers.ts` says so in its own words) and nibbles at the data tables while it runs.
After a test run, `pnpm seed:user` and `pnpm mock` put the world back.

## The fleet (IKN-64) — the present, as opposed to the corpus's past

The corpus is frozen by design, so an hour after a load the rail's sparklines (last 60 minutes)
flatten, the health pills age to amber (90 s), the runtime tile empties (5 minutes), the INGEST
card never reads anything (it counts what the collector ingests, in memory), and the engine
honestly fires `no_logs` on a fleet that went silent. **`pnpm mock:fleet`** ends that: one real
process per registry service, under pm2, in its **own daemon** (`PM2_HOME=~/.iknos-mock/pm2`),
each writing random ECS lines in its service's character (`profiles.ts` — the same routes,
latencies and recurring errors the corpus uses, so live occurrences fold into the corpus's
issues), answering its health route, serving `/metrics`. The unmodified collector, prober,
scraper and alert engine observe it, and every live surface fills for good. Every few hours a
service has a short random bad moment — 5xx, slow answers, a 503 health — so alerts open and
close on their own.

**Isolation is the point.** The dev API tails **only** that daemon's `logs/` directory and runs
its `pm2 jlist` against **only** that daemon — two lines in `nest-api/.env`, which the fleet
refuses to start without (`.env.example` shows them). This machine's real `~/.pm2` is never read,
never listed, never touched: nothing but mock data reaches the database. Restart `pnpm dev`
once after adding the lines; the API reads `.env` at boot. Ports are its own as well: every
dummy listens in the 47100 block — outside every range Zeus's registry allocates (`7N00–7N99`
APIs, `30xx` fronts), so no future app can be handed one — and the registry's
`healthUrl`/`metricsUrl` are pointed at it (the seed's paths kept), never at a real app's port. A
fleet left running does not block `pfa` or `worldweathr` when their own dev servers start on
6100 or 6500 an hour later.

**Bounded on purpose.** A few lines a minute per service (~35 000 a day fleet-wide), metrics at
the scraper's 15 s cadence (~1M rows a day for nineteen services). Retention keeps the database
small — `IKNOS_RETENTION_DAYS=7` matches the corpus's window, `IKNOS_METRIC_RETENTION_DAYS=1`
keeps raw samples to a day — and `pnpm mock:fleet:stop -- --flush` empties the pm2 log
directory when the fleet is not needed. `pnpm mock:fleet:status` lists what runs; `pnpm mock`
still re-anchors the corpus underneath whenever you want the last seven days back to full
richness — the fleet keeps writing on top, offsets intact.
