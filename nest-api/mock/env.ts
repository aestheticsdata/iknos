import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * What every mock command must know before it touches anything: where the database is, whether
 * this is production, and how to open a client the way `seed.ts` and `create-account.ts` do.
 * Shared by `load.ts` and `fleet.ts` so the two cannot disagree about what "production" means.
 */

export type DiscoveredDatabase = { url: string; fromEcosystem: boolean };

/**
 * DATABASE_URL discovery, same chain as `scripts/create-account.ts`: the environment, then `.env`,
 * then the pm2 ecosystem beside the release on ks-b. Which step answered matters: an URL that came
 * from the ecosystem file means this is the production box, and production is asked for
 * explicitly — `NODE_ENV` alone cannot be trusted to say so, because a plain ssh shell on ks-b
 * does not set it.
 */
export function loadDatabaseUrl(): DiscoveredDatabase {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, fromEcosystem: false };

  if (existsSync(".env")) {
    process.loadEnvFile();
    if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, fromEcosystem: false };
  }

  const ecosystem = resolve("../ecosystem.config.js");
  if (existsSync(ecosystem)) {
    // CJS require of the operator-owned pm2 config — the same move create-account.ts makes.
    const config = require(ecosystem) as { apps?: Array<{ name?: string; env_production?: Record<string, string> }> };
    const app = config.apps?.find((a) => a.name === "iknos-api");
    const url = app?.env_production?.DATABASE_URL;
    if (url) return { url, fromEcosystem: true };
  }

  console.error("DATABASE_URL is not set — not in the environment, not in ./.env, not in ../ecosystem.config.js.");
  process.exit(1);
}

/**
 * A remote database is never a target a mock command erases or rewires by accident. Anything that
 * is not a loopback address is refused by name — same fail-at-startup logic as `env.validation.ts`.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function refuseUnlessLoopback(dsn: URL): void {
  if (LOOPBACK.has(dsn.hostname)) return;
  console.error(`refusing to run against a non-loopback database host: ${dsn.hostname}`);
  process.exit(1);
}

export const looksLikeProduction = (discovered: DiscoveredDatabase): boolean =>
  process.env.NODE_ENV === "production" || discovered.fromEcosystem;

export function openPrisma(dsn: URL): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaMariaDb({
      host: dsn.hostname,
      port: dsn.port ? Number(dsn.port) : 3306,
      user: decodeURIComponent(dsn.username),
      password: decodeURIComponent(dsn.password),
      database: dsn.pathname.replace(/^\//, ""),
      // Same reason as seed.ts: MySQL 8 wipes its auth cache on restart, and without this a
      // one-shot script run after a reboot dies as a pool timeout instead of connecting.
      allowPublicKeyRetrieval: true,
    }),
  });
}
