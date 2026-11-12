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
 * `nginx` is not in here as a service of its own, and no longer needs to be. IKN-16 brought the
 * ingestion source it was waiting for, and the answer turned out to be per-site rather than one
 * `nginx` row: `combined` carries no `$host`, so a vhost's lines are only attributable if that
 * vhost writes its own file — and once it does, the file belongs to the site rather than to the
 * server. A site's access log is therefore a column on the site's row, `logGlob`.
 *
 * `landing-page` is the first row here that names no PM2 process, which is what `pm2Name` was
 * always held open for. It does not make the two columns differ — there is simply nothing to put
 * in the second one, so it repeats the first.
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
const SERVICES: {
  name: string;
  pm2Name: string;
  metricsUrl: string | null;
  healthUrl: string | null;
  /** The Spira project its AI failure patterns are filed in (IKN-96); the Officina apps only. */
  spiraProject?: string;
  /** Set only on the rows whose vhost writes an access log of its own — `NginxSource` reads them. */
  logGlob?: string;
  /**
   * The vhost's `server_name`, space-separated (IKN-84). Every vhost without a file of its own
   * writes to the shared access log, whose lines end on `$host`, and this is what files them
   * under the row. A new site reaches Traffic with this one field and nothing in its own project.
   */
  hosts?: string;
}[] = [
  { name: "1991chat-backend", pm2Name: "1991chat-backend", metricsUrl: null, healthUrl: null },
  {
    name: "1991chat-front",
    pm2Name: "1991chat-front",
    metricsUrl: null,
    healthUrl: null,
    hosts: "chat.1991computer.com",
  },
  { name: "bkmk-front", pm2Name: "bkmk-front", metricsUrl: null, healthUrl: null, hosts: "bkmk.1991computer.com" },
  { name: "bkmk-server", pm2Name: "bkmk-server", metricsUrl: null, healthUrl: null },
  /*
   * PFA's bot back-office arrives with PFA-127 (`bots.1991computer.com`): a Next front, a Nest API
   * and the runner that drives the synthetic users, all three on loopback behind the front.
   *
   * The access log sits on the front's row, like folio's: `bots.conf` routes only the front and
   * writes its own file. Neither the API nor the runner exposes `/metrics`, so those stay null;
   * their health routes answer without a session or a token. The runner's `/health` is the one
   * route of its control API that needs no token — everything else there answers 401.
   */
  {
    name: "bots-front",
    pm2Name: "bots-front",
    metricsUrl: null,
    // Root, like `folio-front`: it answers 307 to /signin, and anything under 500 is up.
    healthUrl: "http://127.0.0.1:3014/",
    logGlob: "/var/log/nginx/bots.access.log",
  },
  {
    name: "bots-nest-api",
    pm2Name: "bots-nest-api",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:7200/api/health",
  },
  { name: "bots-runner", pm2Name: "bots-runner", metricsUrl: null, healthUrl: "http://127.0.0.1:7300/health" },
  // life.1991computer.com is Conway's front, served from disk, and this API behind its `/api/`.
  {
    name: "conway-gol-api",
    pm2Name: "conway-gol-api",
    metricsUrl: null,
    healthUrl: null,
    hosts: "life.1991computer.com",
  },
  /*
   * Fiducia's two join with FID-46, and they had been running since the site launched. The access
   * log sits on the front's row, like folio's: `fiducia.conf` writes its own file, and that file
   * also carries the `/api/` requests nginx proxied to the API.
   */
  {
    name: "fiducia-front",
    pm2Name: "fiducia-front",
    metricsUrl: null,
    // Root, like `folio-front`: a Next front has no health route.
    healthUrl: "http://127.0.0.1:3016/",
    logGlob: "/var/log/nginx/fiducia.access.log",
  },
  {
    name: "fiducia-nest-api",
    pm2Name: "fiducia-nest-api",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:7400/api/health",
  },
  /*
   * Static sites with no PM2 process, like `landing-page` (IKN-84): files on disk behind a vhost,
   * and nothing but their visitors to show. Their domain is their only door into Iknos.
   */
  { name: "fighter", pm2Name: "fighter", metricsUrl: null, healthUrl: null, hosts: "fighter.1991computer.com" },
  /*
   * Folio's two arrive with FOL-18, registered from day one rather than found later by drift. The
   * API is instrumented in the same ticket (ECS logs, `/api/metrics`, a health that probes MySQL
   * and Redis), so both of its URLs are filled. Seed AFTER Folio's first deploy, for the same
   * reason as worldweathr's rows: before it, the collector writes failures for routes that do not
   * exist yet.
   *
   * The access log sits on the front's row, following `landing-page`: `folio.conf` is the site's
   * vhost and writes its own file, so its lines belong to the site. That file carries the `/api/`
   * requests nginx proxied as well; the API's own view of those is in its PM2 lines.
   */
  {
    name: "folio-front",
    pm2Name: "folio-front",
    metricsUrl: null,
    // Root, like `worldweathr-front`: a Next front has no health route.
    healthUrl: "http://127.0.0.1:3013/",
    logGlob: "/var/log/nginx/folio.access.log",
  },
  {
    name: "folio-nest-api",
    pm2Name: "folio-nest-api",
    metricsUrl: "http://127.0.0.1:7100/api/metrics",
    healthUrl: "http://127.0.0.1:7100/api/health",
  },
  // Stopped in PM2 today, and still enabled here: `enabled` says whether Iknos collects, not
  // whether the process is up. Its files are on disk and its history stays readable.
  { name: "halcyon", pm2Name: "halcyon", metricsUrl: null, healthUrl: null, hosts: "halcyon.1991computer.com" },
  { name: "hiwaysim", pm2Name: "hiwaysim", metricsUrl: null, healthUrl: null },
  {
    name: "iknos-api",
    pm2Name: "iknos-api",
    metricsUrl: null,
    // Outside /api, unlike PFA — the vhost routes /health straight to the Nest port, and this
    // is the URL Zeus's registry probes too.
    healthUrl: "http://127.0.0.1:6900/health",
  },
  {
    name: "iknos-front",
    pm2Name: "iknos-front",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3006/",
    // `deploy/nginx/iknos.conf` writes its own file, so it never reaches the shared one.
    logGlob: "/var/log/nginx/iknos.access.log",
  },
  /*
   * The portfolio at 1991computer.com, and the first row in this table that names no process at
   * all: a Next `output: "export"` build rsynced to a document root, with no PM2 entry, no port
   * and no stdout. `pm2Name` repeats `name` because there is nothing else to put there — the
   * consumers that read it look for a `process_sample` and correctly find none.
   *
   * It reaches this table by two doors, and both are named here. `hosts` files its lines of the
   * shared access log under it (IKN-84) — its vhost never got a file of its own, so the
   * `logGlob` it was first given named a file that does not exist. The browser reporter posts
   * JavaScript errors under this same name, which is what makes one rail entry hold both.
   */
  {
    name: "landing-page",
    pm2Name: "landing-page",
    metricsUrl: null,
    healthUrl: null,
    hosts: "1991computer.com",
  },
  { name: "loamkeep", pm2Name: "loamkeep", metricsUrl: null, healthUrl: null, hosts: "loamkeep.1991computer.com" },
  // Opifex (its OPI-14): first a static Vite build, a Next front under pm2 since 2026-11-07, run like
  // Vidar's below. Its vhost now writes its own file, so the row tails it instead of filing the shared
  // log by `hosts`; renamed to its pm2 name, which is what the tailer files its logs under.
  {
    name: "opifex-front",
    pm2Name: "opifex-front",
    spiraProject: "OPI",
    metricsUrl: null,
    // Root, like the other Next fronts: no health route of its own.
    healthUrl: "http://127.0.0.1:3024/",
    logGlob: "/var/log/nginx/opifex.access.log",
  },
  { name: "pfa-front", pm2Name: "pfa-front", metricsUrl: null, healthUrl: null, hosts: "pfa.1991computer.com" },
  {
    name: "pfa-nest-api",
    pm2Name: "pfa-nest-api",
    metricsUrl: "http://127.0.0.1:6100/api/metrics",
    healthUrl: "http://127.0.0.1:6100/api/health",
  },
  // shatter.1991computer.com is the game, served from disk, and this API behind its `/api/`.
  {
    name: "shatter-api",
    pm2Name: "shatter-api",
    metricsUrl: null,
    healthUrl: null,
    hosts: "shatter.1991computer.com",
  },
  { name: "spira-front", pm2Name: "spira-front", metricsUrl: null, healthUrl: null, hosts: "spira.1991computer.com" },
  { name: "spira-nest-api", pm2Name: "spira-nest-api", metricsUrl: null, healthUrl: null },
  /*
   * Tessera's two arrive with TES-24, seeded after Demo 1's first deploy (2026-11-01) for the reason
   * folio's were: the routes exist before the collector looks for them. The API is instrumented the
   * way folio's is (ECS logs, `/api/metrics` on loopback only, a health that probes PostgreSQL and
   * the tiles folder), so both of its URLs are filled. The access log sits on the front's row:
   * `tessera.conf` writes its own file, which also carries the `/api/` and `/tiles/` requests.
   */
  {
    name: "tessera-front",
    pm2Name: "tessera-front",
    metricsUrl: null,
    // Root, like `folio-front`: a Next front has no health route.
    healthUrl: "http://127.0.0.1:3018/",
    logGlob: "/var/log/nginx/tessera.access.log",
  },
  {
    name: "tessera-nest-api",
    pm2Name: "tessera-nest-api",
    metricsUrl: "http://127.0.0.1:7600/api/metrics",
    healthUrl: "http://127.0.0.1:7600/api/health",
  },
  { name: "trekker-api", pm2Name: "trekker-api", metricsUrl: null, healthUrl: null },
  {
    name: "trekker-front",
    pm2Name: "trekker-front",
    metricsUrl: null,
    healthUrl: null,
    hosts: "trekker.1991computer.com",
  },
  // Vigilia (its VIG-31): ECS logs on stdout, `/api/metrics` in Prometheus text, and a health that
  // answers 503 when the map has no regions. The front's traffic is nginx's own file.
  {
    name: "vigilia-front",
    pm2Name: "vigilia-front",
    metricsUrl: null,
    // Root, like the other Next fronts: no health route of its own.
    healthUrl: "http://127.0.0.1:3017/",
    logGlob: "/var/log/nginx/vigilia.access.log",
  },
  {
    name: "vigilia-nest-api",
    pm2Name: "vigilia-nest-api",
    metricsUrl: "http://127.0.0.1:7500/api/metrics",
    healthUrl: "http://127.0.0.1:7500/api/health",
  },
  // Excubia (its EXC-80): ECS logs on stdout from all three processes, `/api/metrics` in Prometheus
  // text on the API, a health that answers 503 when the simulator's feed is lost or the database is
  // down. The simulator is loopback only and never proxied: its own `/health` says whether its
  // producer runs. The front's traffic is nginx's own file.
  {
    name: "excubia-front",
    pm2Name: "excubia-front",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3019/",
    logGlob: "/var/log/nginx/excubia.access.log",
  },
  {
    name: "excubia-nest-api",
    pm2Name: "excubia-nest-api",
    metricsUrl: "http://127.0.0.1:7700/api/metrics",
    healthUrl: "http://127.0.0.1:7700/api/health",
  },
  {
    name: "excubia-simulator",
    pm2Name: "excubia-simulator",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:7701/health",
  },
  // Anamnesis (its ANA-29): ECS logs on stdout (no resource body, no query string ever logged),
  // `/api/metrics` in Prometheus text on loopback only, a health that counts the store's resources and
  // answers 503 when PostgreSQL is down. The front's traffic — and the API's, both behind one vhost — is
  // nginx's own file, written without query strings (a patient search carries a name).
  {
    name: "anamnesis-front",
    pm2Name: "anamnesis-front",
    metricsUrl: null,
    // Root, like the other Next fronts: no health route of its own.
    healthUrl: "http://127.0.0.1:3021/",
    logGlob: "/var/log/nginx/anamnesis.access.log",
  },
  {
    name: "anamnesis-nest-api",
    pm2Name: "anamnesis-nest-api",
    metricsUrl: "http://127.0.0.1:7900/api/metrics",
    healthUrl: "http://127.0.0.1:7900/api/health",
  },
  // Tomos (its TOM-23): ECS logs on stdout through nestjs-pino with patient name, ID and birth date
  // redacted, `/api/metrics` in Prometheus text on loopback only (403 through nginx), a health that
  // answers 503 when PostgreSQL or the DICOM store is down. The front's and the API's traffic, and the
  // DICOM instances nginx serves from disk, are in the vhost's own file.
  {
    name: "tomos-front",
    pm2Name: "tomos-front",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3020/",
    logGlob: "/var/log/nginx/tomos.access.log",
  },
  {
    name: "tomos-nest-api",
    pm2Name: "tomos-nest-api",
    metricsUrl: "http://127.0.0.1:7800/api/metrics",
    healthUrl: "http://127.0.0.1:7800/api/health",
  },
  // Vidar (its VID-16): the second app on Opifex's engine, an intelligence-fusion workbench whose models run
  // in the visitor's browser. A Next front under pm2 and nothing else: no API, no database. Its vhost
  // writes its own file, seeded after the first deploy made nginx write it.
  {
    name: "vidar-front",
    pm2Name: "vidar-front",
    spiraProject: "VID",
    metricsUrl: null,
    // Root, like the other Next fronts: no health route of its own.
    healthUrl: "http://127.0.0.1:3025/",
    logGlob: "/var/log/nginx/vidar.access.log",
  },
  // Auscult (its AUS-13): the third app on Officina, a clinical-documentation assistant whose models run
  // in the visitor's browser. A Next front under pm2 on 3026, no API, no database; its vhost writes its
  // own access log, seeded after the first deploy made nginx write it.
  {
    name: "auscult-front",
    pm2Name: "auscult-front",
    spiraProject: "AUS",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3026/",
    logGlob: "/var/log/nginx/auscult.access.log",
  },
  // Groma (its GRO-32): the fourth app on Officina, a planning-rules studio on a real Paris plot whose
  // models run in the visitor's browser. A Next front under pm2 on 3027, no API, no database; its vhost
  // writes its own access log, seeded after the first deploy made nginx write it.
  {
    name: "groma-front",
    pm2Name: "groma-front",
    spiraProject: "GRO",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3027/",
    logGlob: "/var/log/nginx/groma.access.log",
  },
  // Auspex (its ASP-42): the fifth app on Officina, the airside NOTAM picture for Paris-Charles de Gaulle
  // whose models run in the visitor's browser. A Next front under pm2 on 3028, no API, no database; its
  // vhost writes its own access log, seeded after the first deploy made nginx write it.
  {
    name: "auspex-front",
    pm2Name: "auspex-front",
    spiraProject: "ASP",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3028/",
    logGlob: "/var/log/nginx/auspex.access.log",
  },
  // Probatio (its PRB-29): a lab validation console. ECS logs on stdout, `/api/metrics` in Prometheus
  // text on loopback only, a health that counts today's files and connected analyzers and answers
  // 503 when PostgreSQL is down. The two simulators (analyzers over ASTM, the HIS over MLLP) are pm2
  // apps of their own with a loopback `/health`; none is proxied. Front and API share one vhost,
  // logged without query strings.
  {
    name: "probatio-front",
    pm2Name: "probatio-front",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3022/design-system",
    logGlob: "/var/log/nginx/probatio.access.log",
  },
  {
    name: "probatio-nest-api",
    pm2Name: "probatio-nest-api",
    metricsUrl: "http://127.0.0.1:8000/api/metrics",
    healthUrl: "http://127.0.0.1:8000/api/health",
  },
  {
    name: "probatio-analyzer-sim",
    pm2Name: "probatio-analyzer-sim",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:8001/health",
  },
  {
    name: "probatio-his-sim",
    pm2Name: "probatio-his-sim",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:8002/health",
  },
  // Affinis (its AFF-19): an assay & SAR workbench. ECS logs on stdout, `/api/metrics` in Prometheus
  // text on loopback only, a health that counts the compounds, raw wells and curves in the store and
  // answers 503 when PostgreSQL is down. Front and API share one vhost, logged without query strings
  // (a compound search carries a structure).
  {
    name: "affinis-front",
    pm2Name: "affinis-front",
    metricsUrl: null,
    // `/` redirects to the run's hero plate; /regulatory is a static 200.
    healthUrl: "http://127.0.0.1:3023/regulatory",
    logGlob: "/var/log/nginx/affinis.access.log",
  },
  {
    name: "affinis-nest-api",
    pm2Name: "affinis-nest-api",
    metricsUrl: "http://127.0.0.1:8100/api/metrics",
    healthUrl: "http://127.0.0.1:8100/api/health",
  },
  { name: "wanderer", pm2Name: "wanderer", metricsUrl: null, healthUrl: null, hosts: "wanderer.1991computer.com" },
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
  // Its own `/healthz`, not root (IKN-79, WEA-96). Root redirects an anonymous caller to /login,
  // `fetch` follows the redirect, and that page's render asked WorldWeathr's API for its config:
  // one API request every 30 s, from nobody. The trailing slash is the front's `trailingSlash:
  // true`, so the probe lands without a 308 first. `update: {}` below leaves an existing row alone,
  // so ks-b's row was changed by hand at the same time.
  {
    name: "worldweathr-front",
    pm2Name: "worldweathr-front",
    metricsUrl: null,
    healthUrl: "http://127.0.0.1:3002/healthz/",
    hosts: "worldweathr.com www.worldweathr.com",
  },
  {
    name: "zeus-front",
    pm2Name: "zeus-front",
    metricsUrl: null,
    healthUrl: null,
    // `zeus.conf` writes its own file, like iknos'.
    logGlob: "/var/log/nginx/zeus.access.log",
  },
  { name: "zeus-nest-api", pm2Name: "zeus-nest-api", metricsUrl: null, healthUrl: null },
];

async function main(): Promise<void> {
  for (const service of SERVICES) {
    await prisma.service.upsert({ where: { name: service.name }, update: {}, create: service });
  }

  /* Fill-only, like `metricsUrl` in the mock loader: a project set by hand is never overwritten. */
  for (const service of SERVICES.filter((row) => row.spiraProject !== undefined)) {
    await prisma.service.updateMany({
      where: { name: service.name, spiraProject: null },
      data: { spiraProject: service.spiraProject },
    });
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
