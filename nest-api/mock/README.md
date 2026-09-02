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
once after adding the lines; the API reads `.env` at boot. The corollary is deliberate: a real
app you start under your everyday pm2 never shows up in a dev Iknos — only the fleet does.

### Two daemons, and why `pm2 list` shows none of it

`pm2` is not one program but two: a **CLI** (the client) and a **daemon** (which owns the
processes). The client talks to the daemon over a Unix socket, and `PM2_HOME` is the directory
where the daemon keeps everything — that socket included. The two directories have exactly the
same shape:

```
~/.pm2/                       ~/.iknos-mock/pm2/
  rpc.sock   ← the socket       rpc.sock   ← ANOTHER socket
  pm2.pid                       pm2.pid
  dump.pm2   ← the list         dump.pm2   ← another list
  logs/                         logs/
```

So when `fleet.ts` runs `pm2` with `env: { ...process.env, PM2_HOME: MOCK_PM2_HOME }`, the CLI
looks for its socket at `~/.iknos-mock/pm2/rpc.sock`, finds no live daemon there, and **forks a
new one**. That second daemon has its own pid, its own process list, its own logs; the two never
share a file and never learn of each other. Which is why your usual `pm2 list` (bound for
`~/.pm2/rpc.sock`) shows nothing of the fleet. To address it by hand:

```bash
PM2_HOME=~/.iknos-mock/pm2 pm2 list
```

`pnpm mock:fleet:status` is the same question without the prefix. And the API lands on the right
logs because `IKNOS_PM2_LOG_GLOB` in `.env` points at `~/.iknos-mock/pm2/logs/*.log` — never at
`~/.pm2/logs`.

### Ports

Every dummy binds **`47100 + its index` in `profiles.ts`**, never the port the registry names:

| dummy | port | | dummy | port |
|---|---|---|---|---|
| `pfa-nest-api` | 47100 | | `conway-gol-api` | 47109 |
| `worldweathr-api` | 47101 | | `hiwaysim` | 47110 — stopped, binds nothing |
| `spira-nest-api` | 47102 | | `iknos-front` | 47111 |
| `iknos-api` | 47103 | | `pfa-front` | 47112 |
| `zeus-nest-api` | 47104 | | `spira-front` | 47113 |
| `bkmk-server` | 47105 | | `zeus-front` | 47114 |
| `trekker-api` | 47106 | | `worldweathr-front` | 47115 |
| `shatter-api` | 47107 | | `trekker-front` | 47116 |
| `1991chat-backend` | 47108 | | `bkmk-front` | 47117 |
| | | | `1991chat-front` | 47118 |

The real dev processes stay where they are: the API on 4310, the front on 3006.

**Why not the registry's own ports.** The first version inherited them — `pfa-nest-api` on 6100,
`worldweathr-api` on 6500, `worldweathr-front` on 3002 — and reserved only 4310 and 3006. Those
three are exactly the ports `pfa/nest-api/.env`, `worldweathr/api/.env` and worldweathr's
`next dev -p 3002` use, and the fleet does not stop when Iknos is closed: whichever started
second failed to bind, so the next `pnpm dev` in pfa, hours later, would have died on "port in
use" over a fleet nobody remembered. The 7100 block was no better — it is the next free API
block in Zeus's port registry (`7N00–7N99`), so a future app would have been handed the collision
on the day it was allocated. 47100 sits outside every range Zeus hands out (`7N00–7N99` APIs,
`30xx` fronts) and below macOS's ephemeral range (49152+, `sysctl net.inet.ip.portrange`), and
nothing in `/etc/services` claims it: no future app can be given one of these, so nobody has to
remember the number. Should some tool ever take 47100 anyway, its dummy shows `errored` in
`pnpm mock:fleet:status`, and `PORT_BASE` in `fleet.ts` is the one constant to change.

**The registry follows the dummy.** `fleet start` rewrites the dev database's `healthUrl` and
`metricsUrl` to the dummy's port, keeping the seed's path (`/api/health` for pfa, `/` for
worldweathr-front). It is the one place a real URL from `seed.ts` is overwritten — a dev database
only, behind the production guards — and `pnpm seed` leaves existing rows alone (`upsert` with
`update: {}`), so a later `pnpm mock` does not undo it. `hiwaysim` is `stopped` and keeps a null
`healthUrl` and the loader's silent placeholder: a probe at a dead port would write a failing
row, and a scrape there a warn line every fifteen seconds.

**Bounded on purpose.** A few lines a minute per service (~35 000 a day fleet-wide), metrics at
the scraper's 15 s cadence (~1M rows a day for nineteen services). Retention keeps the database
small — `IKNOS_RETENTION_DAYS=7` matches the corpus's window, `IKNOS_METRIC_RETENTION_DAYS=1`
keeps raw samples to a day — and `pnpm mock:fleet:stop -- --flush` empties the pm2 log
directory when the fleet is not needed. `pnpm mock:fleet:status` lists what runs; `pnpm mock`
still re-anchors the corpus underneath whenever you want the last seven days back to full
richness — the fleet keeps writing on top, offsets intact.
