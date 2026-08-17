import { plainToInstance } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from "class-validator";

import type { ValidationError } from "class-validator";

/**
 * Boot-time contract. Every variable the API needs is declared here, and a missing or malformed
 * one stops the process at startup instead of surfacing as a confusing failure three hours later
 * on the first request that happens to need it.
 *
 * Keep this in sync with `ecosystem.config.example.js` and `.env.example`. The asymmetry is
 * one-way: everything declared below must appear in both, never the reverse. `NODE_ENV` is PM2's
 * to set, and `SHADOW_DATABASE_URL` belongs to `prisma migrate dev` and never exists in
 * production — neither is declared here.
 *
 * Nothing here controls registration. The instance seals itself once the account exists,
 * enforced by a UNIQUE constraint rather than a flag: there is no line to forget to set, and
 * none to switch back on by accident while debugging at two in the morning.
 */
class EnvironmentVariables {
  @IsString()
  @MinLength(1, { message: "DATABASE_URL must not be empty" })
  DATABASE_URL!: string;

  @IsString()
  @MinLength(1, { message: "REDIS_URL must not be empty" })
  REDIS_URL!: string;

  @IsInt({ message: "IKNOS_PORT must be a whole number between 1 and 65535" })
  @Min(1, { message: "IKNOS_PORT must be a whole number between 1 and 65535" })
  @Max(65535, { message: "IKNOS_PORT must be a whole number between 1 and 65535" })
  IKNOS_PORT!: number;

  @IsIn(["trace", "debug", "info", "warn", "error"], {
    message: "IKNOS_LOG_LEVEL must be one of trace, debug, info, warn, error",
  })
  IKNOS_LOG_LEVEL!: string;

  /** Long enough to sign cookies with real entropy — `openssl rand -base64 48` clears it. */
  @IsString()
  @MinLength(64, {
    message: "IKNOS_COOKIE_SECRET must be at least 64 characters — generate one with `openssl rand -base64 48`",
  })
  IKNOS_COOKIE_SECRET!: string;

  /**
   * Days of logs kept. One is the floor rather than zero: retention is implemented as
   * `DROP PARTITION` over whole days, so a window of zero would drop the partition currently
   * being written to.
   */
  @IsInt({ message: "IKNOS_RETENTION_DAYS must be a number" })
  @Min(1, { message: "IKNOS_RETENTION_DAYS must be at least 1" })
  IKNOS_RETENTION_DAYS!: number;

  @IsString()
  @MinLength(1, { message: "IKNOS_PM2_LOG_GLOB must not be empty" })
  IKNOS_PM2_LOG_GLOB!: string;

  /**
   * The token browsers present on `POST /api/ingest` (IKN-29).
   *
   * **Optional, and the route is inert without it.** Every other variable here is required
   * because the API cannot do its job without one; this one gates a feature, and making it
   * required would mean an existing deployment refuses to boot after a `git pull` until someone
   * edits a chmod-600 file on the server. Absent, the route answers 503 — closed, and closed
   * loudly, without taking the rest of the API down with it.
   *
   * It ships inside a JavaScript bundle, so it is **not a secret**: it names a sender, the way
   * Sentry's DSN key does. The real protection is the service registry, the origin allowlist and
   * the rate limit. Length is asked for anyway so it cannot be guessed by hand.
   */
  @IsOptional()
  @IsString()
  @MinLength(24, {
    message: "IKNOS_INGEST_TOKEN must be at least 24 characters — generate one with `openssl rand -base64 24`",
  })
  IKNOS_INGEST_TOKEN?: string;

  /**
   * Comma-separated origins allowed to POST logs, e.g.
   * `https://pfa.1991computer.com,https://iknos.1991computer.com`.
   *
   * Empty means no origin check, which is what a server-to-server caller needs — a `curl` or a
   * pino transport sends no `Origin` header at all. The check only ever applies to a request
   * that presented one, so leaving this unset does not weaken anything a browser could exploit;
   * it simply stops distinguishing browsers.
   */
  @IsOptional()
  @IsString()
  IKNOS_INGEST_ORIGINS?: string;
}

/** What the rest of the application injects. Nothing outside this file reads `process.env`. */
export type Config = {
  databaseUrl: string;
  redisUrl: string;
  port: number;
  logLevel: string;
  cookieSecret: string;
  retentionDays: number;
  pm2LogGlob: string;
  /** `null` when unset — the ingestion route is then closed. */
  ingestToken: string | null;
  /** Empty means no origin restriction. */
  ingestOrigins: string[];
};

/**
 * Validates a plain source object and returns the typed config.
 *
 * It takes the source as an argument rather than reading `process.env` so that the tests carry
 * no global state and do not depend on each other's ordering.
 */
export function parseEnv(source: Record<string, unknown>): Config {
  // enableImplicitConversion is what turns "4310" into 4310 for the two numeric fields — and
  // turns "http" into NaN, which @IsInt then rejects by name.
  const parsed = plainToInstance<EnvironmentVariables, Record<string, unknown>>(EnvironmentVariables, source, {
    enableImplicitConversion: true,
  });

  const errors: ValidationError[] = validateSync(parsed, { skipMissingProperties: false });

  if (errors.length > 0) {
    // Every offending variable, named, in one message. A boot that reports one problem per
    // attempt costs a restart cycle per variable, which is how a five-minute deploy becomes
    // half an hour.
    const details = errors
      .map((error) => {
        // Deduplicated: a non-numeric port is NaN, which trips @IsInt, @Min and @Max at once
        // and would otherwise print the same sentence three times.
        const messages = [...new Set(Object.values(error.constraints ?? {}))];
        return `  ${error.property}: ${messages.join(", ")}`;
      })
      .join("\n");
    throw new Error(`Invalid environment.\n${details}\n\nSee nest-api/.env.example.`);
  }

  return {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    port: parsed.IKNOS_PORT,
    logLevel: parsed.IKNOS_LOG_LEVEL,
    cookieSecret: parsed.IKNOS_COOKIE_SECRET,
    retentionDays: parsed.IKNOS_RETENTION_DAYS,
    pm2LogGlob: parsed.IKNOS_PM2_LOG_GLOB,
    ingestToken: parsed.IKNOS_INGEST_TOKEN ?? null,
    ingestOrigins: (parsed.IKNOS_INGEST_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
  };
}

/** `ConfigModule.forRoot({ validate })`. Boot fails here, before anything opens a socket. */
export function validate(source: Record<string, unknown>): Record<string, unknown> {
  parseEnv(source);
  return source;
}
