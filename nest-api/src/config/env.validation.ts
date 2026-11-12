import { hostname } from "node:os";
import { plainToInstance } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from "class-validator";

import type { ValidationError } from "class-validator";

/** IKN-63 — see `IKNOS_SCRAPE_INTERVAL_SECONDS` below. Was a hard-coded 15 until then. */
export const DEFAULT_SCRAPE_INTERVAL_SECONDS = 30;

/** IKN-20 — see `IKNOS_ROLLUP_RETENTION_DAYS` below. */
export const DEFAULT_ROLLUP_RETENTION_DAYS = 90;

/** IKN-87 — see `IKNOS_OTLP_TOKEN_RATE_PER_MINUTE` below. */
export const DEFAULT_OTLP_TOKEN_RATE_PER_MINUTE = 120;

/** IKN-87 — see `IKNOS_OTLP_IP_RATE_PER_MINUTE` below. */
export const DEFAULT_OTLP_IP_RATE_PER_MINUTE = 240;

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

  /**
   * Days of raw metric, probe and machine samples kept (IKN-8). Its own knob and not the logs':
   * raw metrics run to ~1.4M rows per day per scraped service, and shortening their window must
   * never shorten the log window with it. Optional — three days unless said otherwise; long
   * ranges are the hourly rollups' job (IKN-20).
   */
  @IsOptional()
  @IsInt({ message: "IKNOS_METRIC_RETENTION_DAYS must be a number" })
  @Min(1, { message: "IKNOS_METRIC_RETENTION_DAYS must be at least 1" })
  IKNOS_METRIC_RETENTION_DAYS?: number;

  /**
   * Days of hourly rollups kept (IKN-20). Optional — 90. One row per series per hour is about 1 % of
   * the raw samples of that day, but it is kept thirty times longer: ~1 000 series on ks-b is
   * ~550 MB at 90 days and ~2.2 GB at a year. The ticket asked for a year; 90 was chosen against
   * that figure on 2026-10-09.
   */
  @IsOptional()
  @IsInt({ message: "IKNOS_ROLLUP_RETENTION_DAYS must be a number" })
  @Min(1, { message: "IKNOS_ROLLUP_RETENTION_DAYS must be at least 1" })
  IKNOS_ROLLUP_RETENTION_DAYS?: number;

  /**
   * Seconds between two scrapes of every `/metrics` (IKN-63). Optional — 30 unless said otherwise.
   *
   * **At most 60, and 30 by default rather than 60.** The finest grid a chart draws is a minute
   * (`MIN_METRIC_BUCKET_MS`): at 60 s each minute holds exactly one reading, and ordinary jitter
   * leaves some minute empty — a hole in the chart that is the scrape's punctuality, not the
   * service. At 30 s every minute holds two, and only a missed scrape can empty one. Above 60 the
   * holes are guaranteed. No alert rule needs finer than a minute: the engine runs every 60 s and
   * the two metric rules read ten-minute windows.
   */
  @IsOptional()
  @IsInt({ message: "IKNOS_SCRAPE_INTERVAL_SECONDS must be a number" })
  @Min(5, { message: "IKNOS_SCRAPE_INTERVAL_SECONDS must be at least 5" })
  @Max(60, { message: "IKNOS_SCRAPE_INTERVAL_SECONDS must be at most 60 — the charts' finest grid is a minute" })
  IKNOS_SCRAPE_INTERVAL_SECONDS?: number;

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

  /**
   * The bearer token Zeus presents on `GET /api/sli` (IKN-88), to read a service's error rate and
   * latency around a deploy.
   *
   * Optional for the reason `IKNOS_INGEST_TOKEN` is: absent, the route answers 503 and nothing else
   * changes. Unlike that one it **is** a secret — it never leaves ks-b, and it is the only check on
   * the route besides nginx refusing it from outside the box. Zeus holds the same value.
   */
  @IsOptional()
  @IsString()
  @MinLength(24, {
    message: "IKNOS_SLI_TOKEN must be at least 24 characters — generate one with `openssl rand -base64 24`",
  })
  IKNOS_SLI_TOKEN?: string;

  /**
   * The name the host badge shows, and the scope a host-wide alert opens under (IKN-65).
   *
   * **Optional, and `os.hostname()` when unset** — so a laptop with nothing configured says its own
   * name, which is true, instead of a server's, which was not. Set it where the machine's hostname
   * is not the name people use for it (`ks-b`), and in the mock world, where the corpus stamps
   * `web01` on every line and the badge has to tell the same story. No branch on the environment
   * anywhere: the configuration says which machine this is, and the code does not guess.
   */
  @IsOptional()
  @IsString()
  IKNOS_HOST_LABEL?: string;

  /**
   * nginx's shared access log, which every vhost without a file of its own writes to (IKN-84).
   * Unset means ks-b's path; blank means there is none to read.
   */
  @IsOptional()
  @IsString()
  IKNOS_NGINX_SHARED_LOG?: string;

  /**
   * Requests a minute one OTLP token may make on `POST /api/otlp/v1/traces` (IKN-87). Optional —
   * 120 unless said otherwise.
   *
   * The Officina exporters batch: one flush every few seconds while a pipeline runs, plus the
   * beacon on page hide. Two a second is a tab doing something wrong, and the cap is what turns a
   * runaway loop in one demo into a bounded number of rows instead of a full disk. Per token, so
   * one misbehaving app cannot spend another's budget.
   */
  @IsOptional()
  @IsInt({ message: "IKNOS_OTLP_TOKEN_RATE_PER_MINUTE must be a whole number" })
  @Min(1, { message: "IKNOS_OTLP_TOKEN_RATE_PER_MINUTE must be at least 1" })
  IKNOS_OTLP_TOKEN_RATE_PER_MINUTE?: number;

  /**
   * Requests a minute one client address may make on the same route, valid token or not
   * (IKN-87). Optional — 240.
   *
   * Counted **before** the token is looked up, so it is also what bounds a caller guessing tokens:
   * every guess costs a database read, and this is the ceiling on how many of those an address
   * gets. Twice the per-token budget, so an office behind one NAT running two demos side by side
   * is not throttled by its neighbour.
   */
  @IsOptional()
  @IsInt({ message: "IKNOS_OTLP_IP_RATE_PER_MINUTE must be a whole number" })
  @Min(1, { message: "IKNOS_OTLP_IP_RATE_PER_MINUTE must be at least 1" })
  IKNOS_OTLP_IP_RATE_PER_MINUTE?: number;
}

/** What the rest of the application injects. Nothing outside this file reads `process.env`. */
export type Config = {
  databaseUrl: string;
  redisUrl: string;
  port: number;
  logLevel: string;
  cookieSecret: string;
  retentionDays: number;
  metricRetentionDays: number;
  /** IKN-20. */
  rollupRetentionDays: number;
  /** IKN-63. Milliseconds, converted once here so no caller multiplies by a thousand. */
  scrapeIntervalMs: number;
  pm2LogGlob: string;
  /** `null` when unset — the ingestion route is then closed. */
  ingestToken: string | null;
  /** Empty means no origin restriction. */
  ingestOrigins: string[];
  /** IKN-88. `null` when unset — `GET /api/sli` then answers 503. */
  sliToken: string | null;
  /** IKN-65. `IKNOS_HOST_LABEL`, else the machine's own hostname — never empty. */
  hostLabel: string;
  /** IKN-84. `null` when set blank — no shared access log on this machine. */
  nginxSharedLog: string | null;
  /** IKN-87. Requests per minute per OTLP token. */
  otlpTokenRatePerMinute: number;
  /** IKN-87. Requests per minute per client address on the OTLP route. */
  otlpIpRatePerMinute: number;
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
    metricRetentionDays: parsed.IKNOS_METRIC_RETENTION_DAYS ?? 3,
    rollupRetentionDays: parsed.IKNOS_ROLLUP_RETENTION_DAYS ?? DEFAULT_ROLLUP_RETENTION_DAYS,
    scrapeIntervalMs: (parsed.IKNOS_SCRAPE_INTERVAL_SECONDS ?? DEFAULT_SCRAPE_INTERVAL_SECONDS) * 1000,
    pm2LogGlob: parsed.IKNOS_PM2_LOG_GLOB,
    ingestToken: parsed.IKNOS_INGEST_TOKEN ?? null,
    ingestOrigins: (parsed.IKNOS_INGEST_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
    sliToken: parsed.IKNOS_SLI_TOKEN ?? null,
    // `||`, not `??`: a label set to blank is a mistake in a config file, not a request for no name.
    hostLabel: parsed.IKNOS_HOST_LABEL?.trim() || hostname(),
    nginxSharedLog: sharedLog(parsed.IKNOS_NGINX_SHARED_LOG),
    otlpTokenRatePerMinute: parsed.IKNOS_OTLP_TOKEN_RATE_PER_MINUTE ?? DEFAULT_OTLP_TOKEN_RATE_PER_MINUTE,
    otlpIpRatePerMinute: parsed.IKNOS_OTLP_IP_RATE_PER_MINUTE ?? DEFAULT_OTLP_IP_RATE_PER_MINUTE,
  };
}

/** `ConfigModule.forRoot({ validate })`. Boot fails here, before anything opens a socket. */
export function validate(source: Record<string, unknown>): Record<string, unknown> {
  parseEnv(source);
  return source;
}

/** ks-b's, unless the configuration names another file or none. */
const sharedLog = (raw: string | undefined) => {
  if (raw === undefined) return "/var/log/nginx/access.log";
  return raw.trim() === "" ? null : raw.trim();
};
