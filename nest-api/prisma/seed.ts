import { PrismaClient } from "@generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Seeds the service registry — every PM2 process on ks-b.
 *
 * **The whole fleet, not a sample.** The tailer globs `~/.pm2/logs/*.log` and does not consult
 * this table, so every one of these applications is already being read, parsed and stored. A row
 * missing here does not save a byte of retention: it only makes those bytes unreachable, since the
 * rail is the one way into them. The registry is what the interface can *show*, and it had drifted
 * to four rows against seventeen processes.
 *
 * Iknos' own two are in here, and that is not vanity. It watches itself through the same pipeline
 * it asks of everything else (spec §3.3).
 *
 * `nginx` is deliberately absent: it is not a PM2 process and its logs come from somewhere else
 * entirely. It joins the registry with IKN-16, which brings its own ingestion source — and it is
 * the case that will finally make `name` and `pm2Name` differ.
 *
 * WorldWeathr's two joined with IKN-52, which is what the drift above looks like from the other
 * side: both processes had been running on ks-b, and their logs had been read and stored, for as
 * long as this file said the fleet was seventeen processes.
 *
 * **`name` is the PM2 name.** The two columns exist so a friendlier label stays possible, and the
 * first attempt used one: `pfa-api` for the process `pfa-nest-api`. That cannot work. The tailer
 * derives `log_entry.service` from the log *filename*, so the rows say `pfa-nest-api`; a rail that
 * selects `pfa-api` would filter against a value no log has ever carried, and IKN-12 would have
 * found a service list where every entry returns nothing. Renaming costs a re-seed today and a
 * data migration later.
 *
 * Reconciling, not just additive: rows absent from `SERVICES` are removed. This file is the only
 * way anything gets into the table — there is no UI for it — so a row that is not here is a
 * leftover from an earlier shape of this list, and `pfa-api` is exactly that. `log_entry` is left
 * alone; its rows are keyed by the PM2 name and outlive any registry edit.
 *
 * Idempotent, and `update: {}` preserves `enabled` — a service someone paused stays paused.
 */

/*
 * The `.env` is the laptop's, and it is the only place DATABASE_URL lives there. On ks-b there is
 * no `.env` at all — `deploy-api.sh` excludes it from the rsync on purpose, and the production
 * value is `env_production.DATABASE_URL` in the pm2 ecosystem, injected by whoever runs this.
 * `loadEnvFile()` throws ENOENT rather than shrugging, so seeding the box was impossible until
 * this catch existed.
 */
try {
  process.loadEnvFile();
} catch {
  // Already in the environment, or about to fail the check below with a message that says so.
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. On ks-b, export it from the pm2 ecosystem first:");
  console.error(
    `  export DATABASE_URL=$(node -p "require('/var/www/iknos/ecosystem.config.js').apps.find(a => a.name === 'iknos-api').env_production.DATABASE_URL")`,
  );
  process.exit(1);
}

const dsn = new URL(url);

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: dsn.hostname,
    port: dsn.port ? Number(dsn.port) : 3306,
    user: decodeURIComponent(dsn.username),
    password: decodeURIComponent(dsn.password),
    database: dsn.pathname.replace(/^\//, ""),
    // Same reason as `prisma.service.ts`: MySQL 8 wipes its auth cache on restart, and without
    // this a one-shot script run after a reboot dies as a pool timeout instead of connecting.
    allowPublicKeyRetrieval: true,
  }),
});

/**
 * `metricsUrl` and `healthUrl` are filled only where the port is known from this repository or
 * from having deployed the app. The rest are null rather than guessed: nothing reads them until
 * IKN-8 and IKN-24, and a wrong port there would report a healthy service as down.
 *
 * Alphabetical, which is also the order `/api/services` returns and therefore the order of the
 * rail — a list this long is scanned, not read.
 */
const SERVICES = [
  { name: "1991chat-backend", pm2Name: "1991chat-backend", metricsUrl: null, healthUrl: null },
  { name: "1991chat-front", pm2Name: "1991chat-front", metricsUrl: null, healthUrl: null },
  { name: "bkmk-front", pm2Name: "bkmk-front", metricsUrl: null, healthUrl: null },
  { name: "bkmk-server", pm2Name: "bkmk-server", metricsUrl: null, healthUrl: null },
  { name: "conway-gol-api", pm2Name: "conway-gol-api", metricsUrl: null, healthUrl: null },
  // Stopped in PM2 today, and still enabled here: `enabled` says whether Iknos collects, not
  // whether the process is up. Its files are on disk and its history stays readable.
  { name: "hiwaysim", pm2Name: "hiwaysim", metricsUrl: null, healthUrl: null },
  {
    name: "iknos-api",
    pm2Name: "iknos-api",
    metricsUrl: null,
    // Outside /api, unlike PFA — the vhost routes /health straight to the Nest port, and this
    // is the URL Zeus's registry probes too.
    healthUrl: "http://127.0.0.1:6900/health",
  },
  { name: "iknos-front", pm2Name: "iknos-front", metricsUrl: null, healthUrl: "http://127.0.0.1:3006/" },
  { name: "pfa-front", pm2Name: "pfa-front", metricsUrl: null, healthUrl: null },
  {
    name: "pfa-nest-api",
    pm2Name: "pfa-nest-api",
    metricsUrl: "http://127.0.0.1:6100/api/metrics",
    healthUrl: "http://127.0.0.1:6100/api/health",
  },
  { name: "shatter-api", pm2Name: "shatter-api", metricsUrl: null, healthUrl: null },
  { name: "spira-front", pm2Name: "spira-front", metricsUrl: null, healthUrl: null },
  { name: "spira-nest-api", pm2Name: "spira-nest-api", metricsUrl: null, healthUrl: null },
  { name: "trekker-api", pm2Name: "trekker-api", metricsUrl: null, healthUrl: null },
  { name: "trekker-front", pm2Name: "trekker-front", metricsUrl: null, healthUrl: null },
  // The two that arrive with IKN-52. Their lines were already being tailed — the glob does not
  // consult this table — so what these rows unlock is reaching them: the rail is the only way in.
  //
  // Both URLs are filled because the ticket instruments the app in the same breath (ECS logs,
  // `/api/metrics`, a health that probes MySQL and Redis). Seed AFTER `deploy-api.sh` has run,
  // or the collector spends the gap writing scrape and probe failures for routes that answer 404
  // and `{ ok: true }`.
  {
    name: "worldweathr-api",
    pm2Name: "worldweathr-api",
    metricsUrl: "http://127.0.0.1:6500/api/metrics",
    healthUrl: "http://127.0.0.1:6500/api/health",
  },
  // Root, like `iknos-front`: a Next front has no health route, and the page it renders is the
  // only honest answer to "is it up". Set this back to null if rendering `/` every 15 s ever
  // shows up in the front's own numbers.
  {
    name: "worldweathr-front",
    pm2Name: "worldweathr-front",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3002/",
  },
  { name: "zeus-front", pm2Name: "zeus-front", metricsUrl: null, healthUrl: null },
  { name: "zeus-nest-api", pm2Name: "zeus-nest-api", metricsUrl: null, healthUrl: null },
];

async function main(): Promise<void> {
  for (const service of SERVICES) {
    await prisma.service.upsert({ where: { name: service.name }, update: {}, create: service });
  }

  const stale = await prisma.service.findMany({
    where: { name: { notIn: SERVICES.map((s) => s.name) } },
    select: { name: true },
  });
  if (stale.length > 0) {
    await prisma.service.deleteMany({ where: { name: { in: stale.map((s) => s.name) } } });
    console.log(`removed ${stale.length} stale row(s): ${stale.map((s) => s.name).join(", ")}`);
  }

  const count = await prisma.service.count();
  console.log(`service registry seeded — ${count} rows`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
