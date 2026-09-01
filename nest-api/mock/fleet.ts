import { execFileSync, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadDatabaseUrl, looksLikeProduction, openPrisma, refuseUnlessLoopback } from "./env";
import { PROFILES } from "./profiles";

/**
 * The mock fleet's launcher (IKN-64): `pnpm mock:fleet` starts one `fleet-node.ts` per registry
 * service under pm2, `pnpm mock:fleet:stop` removes them, `pnpm mock:fleet:status` says what runs.
 *
 * **Its own pm2 daemon, not yours.** Everything lives under `PM2_HOME=~/.iknos-mock/pm2`: its own
 * process list, its own `logs/` directory. The dev API is pointed at that directory and nothing
 * else (`IKNOS_PM2_LOG_GLOB`), and runs its `pm2 jlist` against that daemon (`PM2_HOME`) — so the
 * real `~/.pm2` on this machine is never read, never listed, never touched. Only mock data reaches
 * the database, which is the whole point of a mock.
 *
 * Process names are the registry's, exactly: the tailer derives `log_entry.service` from the pm2
 * log filename, and `process_sample.pm2_name` must equal `service.pm2_name` for the header chips.
 *
 * Dev-only, without an escape hatch: ks-b has the real fleet, and a fake one beside it would be a
 * lie the tool itself would then report.
 */

export const MOCK_PM2_HOME = join(homedir(), ".iknos-mock", "pm2");
export const MOCK_LOG_GLOB = join(MOCK_PM2_HOME, "logs", "*.log");
const NAMESPACE = "iknos-mock";

/** What `load.ts` writes into an uninstrumented service's `metricsUrl`; the only value replaced. */
const LOADER_PLACEHOLDER = "http://127.0.0.1:3006/";

/** The real dev processes. A dummy never binds these, whatever the registry says. */
const RESERVED_PORTS = new Set([4310, 3006]);
const PORT_BASE = 7100;

const command = process.argv[2];
const flush = process.argv.includes("--flush");

/* ── guards ───────────────────────────────────────────────────────────────────────────────────── */

const pm2Version = spawnSync("pm2", ["-v"], { encoding: "utf8" });
if (pm2Version.status !== 0) {
  console.error("pm2 is not installed or not on PATH — `npm i -g pm2` (the fleet needs the real one).");
  process.exit(1);
}

const pm2 = (args: string[], quiet = false): string =>
  execFileSync("pm2", args, {
    encoding: "utf8",
    env: { ...process.env, PM2_HOME: MOCK_PM2_HOME },
    stdio: quiet ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "inherit"],
  });

/** pm2 exits non-zero for "nothing to delete" and "no daemon to kill" — both are fine here. */
const pm2Tolerant = (args: string[]): void => {
  try {
    pm2(args, true);
  } catch {
    // Absence is the state we wanted.
  }
};

type Pm2Process = { name: string; pm_id: number; pm2_env: { status?: string; restart_time?: number } };

function listed(): Pm2Process[] {
  const raw = pm2(["jlist"], true);
  const start = raw.indexOf("[");
  return start === -1 ? [] : (JSON.parse(raw.slice(start)) as Pm2Process[]);
}

/* ── stop / status need no database ───────────────────────────────────────────────────────────── */

if (command === "stop") {
  const running = listed();
  if (running.length > 0) pm2Tolerant(["delete", "all"]);
  pm2Tolerant(["kill"]);
  if (flush) rmSync(join(MOCK_PM2_HOME, "logs"), { recursive: true, force: true });
  console.log(`fleet stopped — ${running.length} process(es) removed, daemon killed${flush ? ", logs flushed" : ""}`);
  process.exit(0);
}

if (command === "status") {
  const running = listed();
  if (running.length === 0) console.log("fleet is not running");
  for (const p of running)
    console.log(`  ${p.name.padEnd(20)} ${p.pm2_env.status ?? "?"}  restarts ${p.pm2_env.restart_time ?? 0}`);
  process.exit(0);
}

if (command !== "start") {
  console.error("usage: tsx mock/fleet.ts start | stop [--flush] | status");
  process.exit(1);
}

/* ── start ────────────────────────────────────────────────────────────────────────────────────── */

const discovered = loadDatabaseUrl();
const dsn = new URL(discovered.url);
refuseUnlessLoopback(dsn);
if (looksLikeProduction(discovered)) {
  console.error("this looks like production (NODE_ENV or an ecosystem-sourced DATABASE_URL).");
  console.error("the mock fleet is dev-only: ks-b has the real one.");
  process.exit(1);
}

/*
 * The API must read this daemon and nothing else. Both lines live in nest-api/.env; without them the
 * tailer would read nothing (the default glob) or — worse — this machine's real pm2 logs.
 */
const wiring = [
  ["IKNOS_PM2_LOG_GLOB", MOCK_LOG_GLOB],
  ["PM2_HOME", MOCK_PM2_HOME],
] as const;
const miswired = wiring.filter(([key, expected]) => process.env[key] !== expected);
if (miswired.length > 0) {
  console.error("the API is not wired to the mock daemon. Put these in nest-api/.env and restart pnpm dev:");
  for (const [key, expected] of miswired) console.error(`  ${key}="${expected}"`);
  process.exit(1);
}

const portOf = (url: string | null): number | null => {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
    return Number(parsed.port || 80);
  } catch {
    return null;
  }
};

const prisma = openPrisma(dsn);

async function start(): Promise<void> {
  const registry = new Map(
    (await prisma.service.findMany({ select: { name: true, healthUrl: true, metricsUrl: true } })).map((r) => [
      r.name,
      r,
    ]),
  );

  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const plan: string[] = [];

  for (const [i, profile] of PROFILES.entries()) {
    const row = registry.get(profile.name);
    if (row === undefined) continue; // the seed decides who exists, not the fleet

    /* A dummy takes the port the registry already names for it — the real pfa/worldweathr ports,
       iknos-api's 6900, worldweathr-front's 3002 — so seed.ts's real URLs need no rewriting. A
       reserved port (the real dev front, the real dev API) is never bound; the dummy moves to the
       7100 block and the registry keeps pointing at the real thing. */
    const realMetricsPort =
      row.metricsUrl !== null && row.metricsUrl !== LOADER_PLACEHOLDER ? portOf(row.metricsUrl) : null;
    const realHealthPort = portOf(row.healthUrl);
    let port =
      realMetricsPort ??
      (realHealthPort !== null && !RESERVED_PORTS.has(realHealthPort) ? realHealthPort : null) ??
      PORT_BASE + i;
    if (RESERVED_PORTS.has(port)) port = PORT_BASE + i;

    const healthPath = realHealthPort === port && row.healthUrl !== null ? new URL(row.healthUrl).pathname : "/health";
    const metricsPath =
      realMetricsPort === port && row.metricsUrl !== null ? new URL(row.metricsUrl).pathname : "/metrics";
    const kind = profile.name === "hiwaysim" ? "stopped" : profile.name.endsWith("-front") ? "front" : "api";

    // Only the loader's placeholder is replaced, only a null healthUrl is filled: a real URL from
    // seed.ts is never touched. A stopped process serves nothing, so it keeps the silent
    // placeholder — pointing the scraper at a dead port would be a warn line every fifteen seconds.
    const data: { metricsUrl?: string; healthUrl?: string } = {};
    if (row.metricsUrl === LOADER_PLACEHOLDER && kind !== "stopped") {
      data.metricsUrl = `http://127.0.0.1:${port}${metricsPath}`;
    }
    if (row.healthUrl === null && kind !== "stopped") data.healthUrl = `http://127.0.0.1:${port}/health`;
    if (Object.keys(data).length > 0) await prisma.service.update({ where: { name: profile.name }, data });

    pm2Tolerant(["delete", profile.name]);
    pm2(
      [
        "start",
        "mock/fleet-node.ts",
        "--interpreter",
        tsx,
        "--name",
        profile.name,
        "--namespace",
        NAMESPACE,
        ...(kind === "stopped" ? ["--no-autorestart"] : []),
        "--",
        "--service",
        profile.name,
        "--port",
        String(port),
        "--kind",
        kind,
        "--health",
        healthPath,
        "--metrics",
        metricsPath,
      ],
      true,
    );
    plan.push(
      `  ${profile.name.padEnd(20)} :${port}  ${kind}${data.metricsUrl ? "  metricsUrl→dummy" : ""}${data.healthUrl ? "  healthUrl→dummy" : ""}`,
    );
  }

  console.log(`fleet started under ${MOCK_PM2_HOME} (namespace ${NAMESPACE}):`);
  for (const line of plan) console.log(line);
  console.log("logs:", join(MOCK_PM2_HOME, "logs"), "— the API tails this directory and only this one.");
  console.log("restart `pnpm dev` once if the API was already running: it reads .env at boot.");
}

start()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
