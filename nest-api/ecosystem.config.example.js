/**
 * PM2 config for the Iknos API — TEMPLATE.
 *
 * Copy to `ecosystem.config.js`, fill in the secrets, and keep that copy out of git (it is in
 * .gitignore, same rule as the rest of the fleet).
 *
 * **This file is the production environment.** There is no `.env` on ks-b: pm2 injects
 * `env_production` into the process before Nest starts, and `nest-api/.env` is a development
 * convenience that never leaves the laptop. `deploy-api.sh` also reads `DATABASE_URL` out of the
 * copy on the server to run `prisma migrate deploy`, so this is the single place production
 * credentials live.
 *
 * Keep it in sync with `src/config/env.validation.ts`, which refuses to boot on a missing or
 * malformed value and names every offender at once.
 *
 * Port 6900, block 6900–6999, reserved in Zeus's registry. `iknos-api` is the pm2 name that
 * registry row expects — renaming it here breaks the health probe and the deploy report.
 */
const prodConfig = {
  // The database user's rights stop at the iknos schema. @127.0.0.1 and not @localhost: MySQL
  // treats those as different accounts, and this URL connects over TCP.
  DATABASE_URL: "mysql://iknos:PASSWORD@127.0.0.1:3306/iknos",

  // Shared with every other app on the box, which is why every key Iknos writes is namespaced
  // `iknos:`.
  REDIS_URL: "redis://127.0.0.1:6379",

  // 6900 on ks-b, 4310 in development. Keeping them equal would buy nothing.
  IKNOS_PORT: "6900",

  IKNOS_LOG_LEVEL: "info",

  // openssl rand -base64 48
  //
  // Signs `iknos.sid`. Changing it invalidates every live session, which is the correct behaviour
  // and worth knowing before doing it casually.
  IKNOS_COOKIE_SECRET: "CHANGE-ME",

  // Days of logs kept. Retention drops whole daily partitions, so one is the floor — zero would
  // drop the partition currently being written to.
  IKNOS_RETENTION_DAYS: "14",

  // Days of raw metric, probe and machine samples kept. Its own knob and not the logs': raw
  // metrics run to well over a million rows a day per scraped service, and shortening their window
  // must never shorten the log window with it. It is also what decides, per request, whether a
  // range is answered from `metric_sample` or from `metric_rollup` (IKN-13) — so widening it moves
  // that boundary as well as the retention it names. Defaults to 3 when unset.
  IKNOS_METRIC_RETENTION_DAYS: "3",

  // What the collector tails. PM2 writes every app's stdout and stderr here, which is the whole
  // reason Iknos needs no agent installed anywhere.
  IKNOS_PM2_LOG_GLOB: "/home/debian/.pm2/logs/*.log",

  // --- Explicit HTTP ingestion (IKN-29) ---------------------------------------------------
  //
  // The only two optional variables in this file. Without a token, POST /api/ingest answers 503
  // and the rest of the API boots normally — deliberately, so that pulling this feature onto an
  // existing deployment never turns into an API that refuses to start.
  //
  // The token travels inside a JavaScript bundle and is therefore NOT a secret: it names a
  // sender, like Sentry's DSN key. The registry lookup, the origin list and the rate limit are
  // what hold. Rotating it is harmless — the worst case is a front that stops reporting until
  // it is redeployed.
  //
  // openssl rand -base64 24
  IKNOS_INGEST_TOKEN: "",

  // Comma-separated, e.g. "https://iknos.1991computer.com,https://pfa.1991computer.com".
  // Checked only against requests that carried an Origin, so an empty value still admits curl
  // and server-side senders.
  IKNOS_INGEST_ORIGINS: "",
};

module.exports = {
  apps: [
    {
      name: "iknos-api",
      cwd: "/var/www/iknos/nest-api",
      script: "dist/src/main.js",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production",
        ...prodConfig,
      },
    },
  ],
};
