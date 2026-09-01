import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "@ingest/parser";
import { persistBatch } from "@ingest/writer";
import { loadDatabaseUrl, looksLikeProduction, openPrisma, refuseUnlessLoopback } from "./env";

import type { PrismaService } from "@db/prisma.service";
import type { LogRecord } from "@ingest/log-record";

/**
 * Loads the committed corpus under `mock/` into the database (IKN-61). One shot: it reads the
 * fixture files, shifts every timestamp by one delta so the newest line lands on "now", writes the
 * rows, and exits. Nothing runs behind it — the corpus does not move again until the next
 * `pnpm mock`.
 *
 * The API is never told. Once these rows are in MySQL it cannot distinguish mock from real, and it
 * must not try — there is no dev flag on any request path, here or anywhere.
 *
 * This file never imports `author.ts`. Loading must not regenerate; the committed files are the
 * source of truth, and `pnpm mock:author` is a different verb for a different, rarer act.
 *
 * Log lines take the exact production path: the real `parse()` from `@ingest/parser` (so a field
 * the parser does not promote cannot appear in the base by magic) and the real `persistBatch` from
 * `@ingest/writer` (so the clamps that guard the columns guard the corpus too).
 */

const MOCK_DIR = __dirname;
const CHUNK = 800;

/* ── guards, before the first byte is written ─────────────────────────────────────────────────── */

const wantsProduction = process.argv.includes("--production");

const discovered = loadDatabaseUrl();
const { url } = discovered;
const dsn = new URL(url);
refuseUnlessLoopback(dsn);

const isProduction = looksLikeProduction(discovered);
if (isProduction && !wantsProduction) {
  console.error("this looks like production (NODE_ENV or an ecosystem-sourced DATABASE_URL).");
  console.error("loading resets the data tables, real ingested rows included. If that is what you");
  console.error("want, say so: pnpm mock -- --production");
  process.exit(1);
}

/* ── the registry first — without its rows the rail is empty and no view opens ────────────────── */

const seed = spawnSync("pnpm", ["seed"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
if (seed.status !== 0) {
  console.error("registry seed failed — not touching the data tables.");
  process.exit(1);
}

/**
 * The registry gate, unlocked. Signals and the runtime tile exist only for a service whose row
 * carries a `metricsUrl`, and the real fleet has exactly two instrumented apps — but the corpus
 * carries metrics for the whole fleet, and a demo that lights two tiles out of nineteen reads as
 * a half-finished product. So the loader fills the gap — **only where the seed left null**, so
 * the day an app gets real instrumentation, seed.ts sets the true URL and this never touches it.
 *
 * The placeholder points at the front's own port (3006 in dev and prod alike): it answers 200
 * HTML, the exposition parser reads zero samples out of it, and the scraper stays silent instead
 * of warning at a dead port every fifteen seconds — a warn line the collector would then ingest.
 * `healthUrl` is deliberately NOT filled: a probe at a dead port writes a failing row, and the
 * loader must not paint the fleet red to decorate it.
 */
const MOCK_METRICS_PLACEHOLDER = "http://127.0.0.1:3006/";

/* ── read the corpus ──────────────────────────────────────────────────────────────────────────── */

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(MOCK_DIR, file), "utf8")) as T;

type SeriesFile = Array<{
  service: string;
  name: string;
  labels: Record<string, string> | null;
  labelsHash: string;
  points: Array<[string, number]>;
}>;
type RollupFile = Array<{
  service: string;
  name: string;
  labels: Record<string, string> | null;
  labelsHash: string;
  hours: Array<[string, number, number, number, number, number]>;
}>;
type HealthFile = Array<{
  service: string;
  rows: Array<{
    ts: string;
    httpStatus: number | null;
    ok: boolean;
    latencyMs: number | null;
    error: string | null;
    checks: Record<string, { status: string; latencyMs: number }> | null;
    version: string | null;
  }>;
}>;
type HostFile = Array<{
  ts: string;
  cpuPct: number | null;
  load1: number;
  load5: number;
  load15: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
}>;
type ProcessFile = Array<{
  ts: string;
  pm2Name: string;
  pm2Id: number;
  status: string;
  restarts: number;
  cpuPct: number | null;
  memBytes: number | null;
  startedAt: string | null;
  nodeVersion: string | null;
}>;
type IssueFile = Array<{
  fingerprint: string;
  service: string;
  type: string | null;
  message: string;
  culprit: string | null;
  level: number;
  levelName: string;
  status: string;
  regression: boolean;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  sample: Record<string, unknown> | null;
  events: Array<{ ts: string; traceId: string | null; message: string; stack: string | null; count: number }>;
}>;
type AlertFile = Array<{
  ruleKey: string;
  service: string;
  severity: string;
  title: string;
  expr: string;
  threshold: number | null;
  unit: string | null;
  value: number | null;
  state: string;
  openedAt: string;
  pendingSince: string | null;
  firedAt: string | null;
  resolvedAt: string | null;
  ackedAt: string | null;
  occurrences: number;
  lastSeenAt: string;
  changes: Array<{ ts: string; fromState: string | null; toState: string; value: number | null }>;
}>;

const metrics = readJson<SeriesFile>("metrics.json");
const rollups = readJson<RollupFile>("rollups.json");
const health = readJson<HealthFile>("health.json");
const host = readJson<HostFile>("host.json");
const processes = readJson<ProcessFile>("processes.json");
const issues = readJson<IssueFile>("issues.json");
const alerts = readJson<AlertFile>("alerts.json");

/**
 * NDJSON log files, through the real parser. The service is the filename stem, exactly as the
 * tailer derives it from a PM2 log path. Plain lines (a Nest boot banner, a line cut mid-JSON)
 * carry no timestamp of their own and `parse()` stamps them "now" — here they inherit the line
 * above them plus 400 ms instead, which is where they sat in the stream that wrote them.
 */
const hasOwnTimestamp = (line: string): boolean => {
  if (!line.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && "@timestamp" in (parsed as Record<string, unknown>);
  } catch {
    return false;
  }
};

const logRecords: LogRecord[] = [];
const logsDir = join(MOCK_DIR, "logs");
for (const file of readdirSync(logsDir).sort()) {
  if (!file.endsWith(".ndjson")) continue;
  const service = basename(file, ".ndjson");
  let lastTs: number | null = null;
  for (const line of readFileSync(join(logsDir, file), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const record = parse(line, service, "out");
    if (record === null) continue;
    if (!hasOwnTimestamp(line)) record.ts = new Date((lastTs ?? Date.parse("2026-08-25T12:00:00Z")) + 400);
    lastTs = record.ts.getTime();
    logRecords.push(record);
  }
}

/* ── one delta for everything: newest corpus instant → now ────────────────────────────────────── */

let referenceMs = 0;
const see = (isoTs: string | null): void => {
  if (isoTs === null) return;
  const ms = Date.parse(isoTs);
  if (ms > referenceMs) referenceMs = ms;
};
for (const record of logRecords) referenceMs = Math.max(referenceMs, record.ts.getTime());
for (const series of metrics) for (const [t] of series.points) see(t);
for (const series of rollups) for (const [t] of series.hours) see(t);
for (const entry of health) for (const row of entry.rows) see(row.ts);
for (const row of host) see(row.ts);
for (const row of processes) see(row.ts);
for (const issue of issues) {
  see(issue.lastSeen);
  for (const event of issue.events) see(event.ts);
}
for (const alert of alerts) {
  see(alert.lastSeenAt);
  for (const change of alert.changes) see(change.ts);
}

const delta = Date.now() - referenceMs;
const shift = (isoTs: string): Date => new Date(Date.parse(isoTs) + delta);
const shiftOrNull = (isoTs: string | null): Date | null => (isoTs === null ? null : shift(isoTs));

/* ── write ────────────────────────────────────────────────────────────────────────────────────── */

const prisma = openPrisma(dsn);

/**
 * `persistBatch` wants the Nest `PrismaService`, but the only members it touches — `$transaction`,
 * `logEntry`, `ingestOffset` — are the client's own. The cast states that, once, here.
 */
const db = prisma as unknown as PrismaService;

/**
 * In dev the API usually keeps running while the corpus loads, and its schedulers (alert engine,
 * maintenance, samplers) share the tables being rewritten — a chunk insert can lose a lock race.
 * Three tries with a breath between them turn that from a failed load into a log line.
 */
async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`${label}: attempt ${attempt} lost a lock race, retrying — ${String(err).slice(0, 120)}`);
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

async function main(): Promise<void> {
  const unlocked = await prisma.service.updateMany({
    where: { metricsUrl: null },
    data: { metricsUrl: MOCK_METRICS_PLACEHOLDER },
  });
  if (unlocked.count > 0) console.log(`registry: metricsUrl filled on ${unlocked.count} uninstrumented service(s)`);

  /*
   * The engine's open alerts survive a reload. Every fixture episode is closed, so an open row
   * (`open_key` non-null) can only be the live engine's work — and wiping it made "5 alerts"
   * vanish in front of whoever was looking, for the minutes the engine needs to re-notice.
   * Resolved rows are the corpus's to reset; open ones belong to the present.
   */
  const openAlerts = await prisma.alert.findMany({ where: { openKey: { not: null } }, select: { id: true } });
  const openIds = openAlerts.map((alert) => alert.id);

  /*
   * Reset, by default and on purpose: without it a second `pnpm mock` stacks a second corpus a few
   * minutes out of phase. Mock and real rows are indistinguishable by construction, so on ks-b
   * this also clears the real ingested history — accepted in IKN-61, retention capped it at 14
   * days anyway and the tailer refills within the minute. Two tables are never touched:
   * `app_user` (the account must survive every reload) and `ingest_offset` (deleting the tailer's
   * read positions would re-ingest every file as duplicates). `service` is never deleted either —
   * the seed owns its rows; the loader only fills the missing metricsUrl above.
   */
  const reset = await withRetry("reset", () =>
    prisma.$transaction([
      prisma.logEntry.deleteMany(),
      prisma.metricSample.deleteMany(),
      prisma.metricRollup.deleteMany(),
      prisma.healthCheck.deleteMany(),
      prisma.hostSample.deleteMany(),
      prisma.processSample.deleteMany(),
      prisma.issueEvent.deleteMany(),
      prisma.issue.deleteMany(),
      prisma.alertStateChange.deleteMany({ where: { alertId: { notIn: openIds } } }),
      prisma.alert.deleteMany({ where: { openKey: null } }),
    ]),
  );
  const cleared = reset.reduce((a, r) => a + r.count, 0);

  /* Logs, oldest first so autoincrement ids rise with ts — the keyset cursor ties on (ts, id).
   * Rows dated days back all land in the oldest partition that accepts them: partition planning
   * is forward-only (partitions.ts:78), which works — the RANGE stays satisfied and queries prune
   * — but retention will drop the whole block at once when that partition ages out. */
  logRecords.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (const record of logRecords) record.ts = new Date(record.ts.getTime() + delta);
  for (let i = 0; i < logRecords.length; i += CHUNK) {
    await withRetry("log_entry", () => persistBatch(db, logRecords.slice(i, i + CHUNK), []));
  }

  const sampleRows = metrics
    .flatMap((series) =>
      series.points.map(([t, value]) => ({
        ts: shift(t),
        service: series.service,
        name: series.name,
        labels: series.labels ?? undefined,
        labelsHash: series.labelsHash,
        value,
      })),
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (let i = 0; i < sampleRows.length; i += CHUNK) {
    await withRetry("metric_sample", () => prisma.metricSample.createMany({ data: sampleRows.slice(i, i + CHUNK) }));
  }

  const rollupRows = rollups
    .flatMap((series) =>
      series.hours.map(([t, count, sum, min, max, last]) => ({
        ts: shift(t),
        service: series.service,
        name: series.name,
        labels: series.labels ?? undefined,
        labelsHash: series.labelsHash,
        count,
        sum,
        min,
        max,
        last,
      })),
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (let i = 0; i < rollupRows.length; i += CHUNK) {
    await withRetry("metric_rollup", () => prisma.metricRollup.createMany({ data: rollupRows.slice(i, i + CHUNK) }));
  }

  const healthRows = health
    .flatMap((entry) =>
      entry.rows.map((row) => ({
        ts: shift(row.ts),
        service: entry.service,
        httpStatus: row.httpStatus,
        ok: row.ok,
        latencyMs: row.latencyMs,
        error: row.error,
        checks: row.checks ?? undefined,
        version: row.version,
      })),
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (let i = 0; i < healthRows.length; i += CHUNK) {
    await withRetry("health_check", () => prisma.healthCheck.createMany({ data: healthRows.slice(i, i + CHUNK) }));
  }

  const hostRows = host.map((row) => ({
    ts: shift(row.ts),
    cpuPct: row.cpuPct,
    load1: row.load1,
    load5: row.load5,
    load15: row.load15,
    memUsedBytes: BigInt(row.memUsedBytes),
    memTotalBytes: BigInt(row.memTotalBytes),
    diskUsedBytes: row.diskUsedBytes === null ? null : BigInt(row.diskUsedBytes),
    diskTotalBytes: row.diskTotalBytes === null ? null : BigInt(row.diskTotalBytes),
  }));
  for (let i = 0; i < hostRows.length; i += CHUNK) {
    await withRetry("host_sample", () => prisma.hostSample.createMany({ data: hostRows.slice(i, i + CHUNK) }));
  }

  const processRows = processes.map((row) => ({
    ts: shift(row.ts),
    pm2Name: row.pm2Name,
    pm2Id: row.pm2Id,
    status: row.status,
    restarts: row.restarts,
    cpuPct: row.cpuPct,
    memBytes: row.memBytes === null ? null : BigInt(row.memBytes),
    startedAt: shiftOrNull(row.startedAt),
    nodeVersion: row.nodeVersion,
  }));
  for (let i = 0; i < processRows.length; i += CHUNK) {
    await withRetry("process_sample", () => prisma.processSample.createMany({ data: processRows.slice(i, i + CHUNK) }));
  }

  let issueEvents = 0;
  for (const issue of issues) {
    const created = await prisma.issue.create({
      data: {
        fingerprint: issue.fingerprint,
        service: issue.service,
        type: issue.type,
        message: issue.message,
        culprit: issue.culprit,
        level: issue.level,
        levelName: issue.levelName,
        status: issue.status,
        regression: issue.regression,
        firstSeen: shift(issue.firstSeen),
        lastSeen: shift(issue.lastSeen),
        eventCount: issue.eventCount,
        // Same seam as the writer's `attrs as object`: JSON columns take the object whole.
        sample: issue.sample === null ? undefined : (issue.sample as object),
      },
    });
    const events = issue.events
      .map((event) => ({
        ts: shift(event.ts),
        issueId: created.id,
        service: issue.service,
        traceId: event.traceId,
        message: event.message,
        stack: event.stack,
        count: event.count,
      }))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    await prisma.issueEvent.createMany({ data: events });
    issueEvents += events.length;
  }

  let alertChanges = 0;
  for (const alert of alerts) {
    // `open_key` is a STORED generated column MySQL computes itself; it is never assigned here,
    // and every fixture episode is closed so it computes to NULL and cannot collide with a live
    // alert the engine opens later.
    const created = await prisma.alert.create({
      data: {
        ruleKey: alert.ruleKey,
        service: alert.service,
        severity: alert.severity,
        title: alert.title,
        expr: alert.expr,
        threshold: alert.threshold,
        unit: alert.unit,
        value: alert.value,
        state: alert.state,
        openedAt: shift(alert.openedAt),
        pendingSince: shiftOrNull(alert.pendingSince),
        firedAt: shiftOrNull(alert.firedAt),
        resolvedAt: shiftOrNull(alert.resolvedAt),
        ackedAt: shiftOrNull(alert.ackedAt),
        occurrences: alert.occurrences,
        lastSeenAt: shift(alert.lastSeenAt),
      },
    });
    const changes = alert.changes
      .map((change) => ({
        ts: shift(change.ts),
        alertId: created.id,
        fromState: change.fromState,
        toState: change.toState,
        value: change.value,
      }))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    await prisma.alertStateChange.createMany({ data: changes });
    alertChanges += changes.length;
  }

  const newest = new Date(referenceMs + delta);
  const oldest = logRecords.length > 0 ? logRecords[0].ts : newest;
  console.log(`cleared ${cleared} rows, then loaded:`);
  console.log(`  log_entry          ${logRecords.length}`);
  console.log(`  metric_sample      ${sampleRows.length}`);
  console.log(`  metric_rollup      ${rollupRows.length}`);
  console.log(`  health_check       ${healthRows.length}`);
  console.log(`  host_sample        ${hostRows.length}`);
  console.log(`  process_sample     ${processRows.length}`);
  console.log(`  issue              ${issues.length} (+ ${issueEvents} events)`);
  console.log(`  alert              ${alerts.length} (+ ${alertChanges} state changes)`);
  console.log(`anchored on now: newest row ${newest.toISOString()}, oldest log ${oldest.toISOString()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
