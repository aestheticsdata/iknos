import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Seeds the service registry.
 *
 * Iknos' own two processes are in here, and that is not vanity. It watches itself through the
 * same pipeline it asks of everything else (spec §3.3), so without these rows the service rail
 * shows a single application on the day M1 ships — losing the most convincing demonstration
 * the tool has.
 *
 * `nginx` is deliberately absent: it is not a PM2 process and its logs come from somewhere
 * else entirely. It joins the registry with IKN-16, which brings its own ingestion source.
 *
 * Idempotent by `name`, so re-running it after adding an app is safe.
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

const SERVICES = [
  {
    name: "pfa-api",
    pm2Name: "pfa-nest-api",
    metricsUrl: "http://127.0.0.1:6100/api/metrics",
    healthUrl: "http://127.0.0.1:6100/api/health",
  },
  {
    name: "pfa-front",
    pm2Name: "pfa-front",
    metricsUrl: null,
    healthUrl: null,
  },
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
  },
];

async function main(): Promise<void> {
  for (const service of SERVICES) {
    await prisma.service.upsert({ where: { name: service.name }, update: {}, create: service });
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
