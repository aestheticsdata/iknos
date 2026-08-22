/**
 * `pm2 jlist` output → one reading per process (IKN-8).
 *
 * pm2's JSON is large, versioned by nobody, and produced by a subprocess that can fail or hang
 * — so the parsing is pure and defensive: only the fields the service header chips need are
 * read, each one allowed to be missing, and anything that is not a JSON array is `null`, a data
 * absence the caller records as such.
 */

export type ProcessReading = {
  pm2Name: string;
  pm2Id: number | null;
  status: string;
  restarts: number;
  cpuPct: number | null;
  memBytes: number | null;
  startedAt: Date | null;
  nodeVersion: string | null;
};

export function parseJlist(json: string): ProcessReading[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const readings: ProcessReading[] = [];
  for (const entry of parsed) {
    const reading = readEntry(entry);
    if (reading) readings.push(reading);
  }
  return readings;
}

function readEntry(entry: unknown): ProcessReading | null {
  if (typeof entry !== "object" || entry === null) return null;

  const e = entry as {
    name?: unknown;
    pm_id?: unknown;
    monit?: { memory?: unknown; cpu?: unknown } | null;
    pm2_env?: { status?: unknown; restart_time?: unknown; pm_uptime?: unknown; node_version?: unknown } | null;
  };
  if (typeof e.name !== "string" || e.name === "") return null;

  const env = e.pm2_env ?? {};
  const monit = e.monit ?? {};
  const uptime = asNumber(env.pm_uptime);

  return {
    pm2Name: e.name,
    pm2Id: asNumber(e.pm_id),
    status: typeof env.status === "string" ? env.status : "unknown",
    restarts: asNumber(env.restart_time) ?? 0,
    cpuPct: asNumber(monit.cpu),
    memBytes: asNumber(monit.memory),
    startedAt: uptime === null ? null : new Date(uptime),
    nodeVersion: typeof env.node_version === "string" ? env.node_version : null,
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
