import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { Injectable } from "@nestjs/common";
import { type CpuTimes, cpuPctBetween, cpuTimesFromOs, parseProcStat } from "./host-stats";
import { toMetricRows } from "./metric-rows";
import { parseJlist } from "./pm2-jlist";
import { probeHealth } from "./probe-health";
import { scrapeTarget } from "./scrape-target";

import type { Prisma } from "@generated/prisma/client";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { ProbeFetch } from "./probe-health";
import type { FetchLike } from "./scrape-target";

export const SCRAPE_INTERVAL_MS = 15_000;
export const PROBE_INTERVAL_MS = 30_000;
export const SAMPLE_INTERVAL_MS = 30_000;

const JLIST_TIMEOUT_MS = 10_000;

const execFileAsync = promisify(execFile);

/**
 * Everything the cycles touch outside the process, in one injectable bag — tests hand in fakes
 * and never open a socket, read /proc or spawn pm2.
 */
export type ScrapeIo = {
  fetchMetrics: FetchLike;
  fetchHealth: ProbeFetch;
  readProcStat: () => Promise<string | null>;
  cpus: () => os.CpuInfo[];
  loadavg: () => number[];
  freemem: () => number;
  totalmem: () => number;
  statfs: (path: string) => Promise<{ bavail: number; blocks: number; bsize: number } | null>;
  jlist: () => Promise<string | null>;
};

export function defaultScrapeIo(): ScrapeIo {
  return {
    fetchMetrics: fetch,
    fetchHealth: fetch,
    readProcStat: () => readFile("/proc/stat", "utf8").catch(() => null),
    cpus: () => os.cpus(),
    loadavg: () => os.loadavg(),
    freemem: () => os.freemem(),
    totalmem: () => os.totalmem(),
    statfs: (path) =>
      statfs(path).then(
        (s) => ({ bavail: Number(s.bavail), blocks: Number(s.blocks), bsize: Number(s.bsize) }),
        () => null,
      ),
    jlist: async () => {
      try {
        const { stdout } = await execFileAsync("pm2", ["jlist"], {
          timeout: JLIST_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
        });
        // pm2 occasionally prints an update banner ahead of the JSON; the array is the JSON.
        const start = stdout.indexOf("[");
        return start === -1 ? null : stdout.slice(start);
      } catch {
        return null;
      }
    },
  };
}

/**
 * The metrics half of the collector (IKN-8): what Prometheus will do in its place the day one
 * is installed, hitting the same URLs.
 *
 * Same lifecycle shape as `IngestService`, and deliberately so: plain `setInterval` with one
 * boolean latch per task, because the requirement that matters is that cycles never overlap —
 * a scrape that outlives its interval must see the next tick skipped, not stacked, on the event
 * loop the API shares.
 *
 * Failures are data or log lines, never exceptions: an unreachable health endpoint becomes a
 * `health_check` row; a failed metrics scrape becomes a warn line — which the log collector
 * ingests, so the failure is queryable where everything else is.
 */
@Injectable()
export class ScrapeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timers: NodeJS.Timeout[] = [];
  private scraping = false;
  private probing = false;
  private sampling = false;
  private prevCpu: CpuTimes | null = null;
  private jlistDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly io: ScrapeIo,
  ) {}

  onApplicationBootstrap(): void {
    this.timers.push(
      setInterval(() => void this.scrapeTick(), SCRAPE_INTERVAL_MS),
      setInterval(() => void this.probeTick(), PROBE_INTERVAL_MS),
      setInterval(() => void this.sampleTick(), SAMPLE_INTERVAL_MS),
    );
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** Every 15 s: each enabled service with a `metricsUrl` → `metric_sample` rows. */
  async scrapeTick(): Promise<void> {
    if (this.scraping) return;
    this.scraping = true;
    try {
      const services = await this.prisma.service.findMany({
        where: { enabled: true, metricsUrl: { not: null } },
        select: { name: true, metricsUrl: true },
      });

      for (const service of services) {
        if (!service.metricsUrl) continue;
        try {
          const { samples } = await scrapeTarget(service.metricsUrl, this.io.fetchMetrics);
          const rows = toMetricRows(service.name, new Date(), samples);
          if (rows.length > 0) {
            await this.prisma.metricSample.createMany({ data: rows });
          }
        } catch (err) {
          // The one place a scrape failure is recorded: this line is itself ingested by the log
          // collector, so the failure is queryable like any other event.
          logger.warn({ err, service: service.name }, "metrics scrape failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "scrape cycle failed");
    } finally {
      this.scraping = false;
    }
  }

  /** Every 30 s: each enabled service with a `healthUrl` → one `health_check` row, always. */
  async probeTick(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      const services = await this.prisma.service.findMany({
        where: { enabled: true, healthUrl: { not: null } },
        select: { name: true, healthUrl: true },
      });

      const rows: Prisma.HealthCheckCreateManyInput[] = [];
      for (const service of services) {
        if (!service.healthUrl) continue;
        const outcome = await probeHealth(service.healthUrl, this.io.fetchHealth);
        rows.push({
          service: service.name,
          ts: new Date(),
          httpStatus: outcome.httpStatus,
          ok: outcome.ok,
          latencyMs: outcome.latencyMs,
          error: outcome.error,
          ...(outcome.checks ? { checks: outcome.checks as Prisma.InputJsonValue } : {}),
          version: outcome.version,
        });
      }
      if (rows.length > 0) {
        await this.prisma.healthCheck.createMany({ data: rows });
      }
    } catch (err) {
      logger.error({ err }, "health probe cycle failed");
    } finally {
      this.probing = false;
    }
  }

  /** Every 30 s: one `host_sample` reading, and one `process_sample` row per pm2 process. */
  async sampleTick(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      await this.sampleHost();
      await this.sampleProcesses();
    } catch (err) {
      logger.error({ err }, "host sample cycle failed");
    } finally {
      this.sampling = false;
    }
  }

  private async sampleHost(): Promise<void> {
    const procStat = await this.io.readProcStat();
    const cpuTimes = (procStat ? parseProcStat(procStat) : null) ?? cpuTimesFromOs(this.io.cpus());
    const cpuPct = cpuPctBetween(this.prevCpu, cpuTimes);
    this.prevCpu = cpuTimes;

    const [load1, load5, load15] = this.io.loadavg();
    const totalmem = this.io.totalmem();
    const disk = await this.io.statfs("/");

    await this.prisma.hostSample.create({
      data: {
        ts: new Date(),
        cpuPct,
        load1,
        load5,
        load15,
        memUsedBytes: totalmem - this.io.freemem(),
        memTotalBytes: totalmem,
        diskUsedBytes: disk ? (disk.blocks - disk.bavail) * disk.bsize : null,
        diskTotalBytes: disk ? disk.blocks * disk.bsize : null,
      },
    });
  }

  private async sampleProcesses(): Promise<void> {
    const json = await this.io.jlist();
    if (json === null) {
      // Missing data, not zeros — but said once per outage, not never: a pm2 that fell off the
      // PATH after a node upgrade would otherwise be indistinguishable from a table nobody
      // looked at. One line at onset, one at recovery, silence in between.
      if (!this.jlistDown) {
        this.jlistDown = true;
        logger.warn("pm2 jlist unavailable; process samples missing until it answers again");
      }
      return;
    }
    if (this.jlistDown) {
      this.jlistDown = false;
      logger.info("pm2 jlist answering again; process samples resume");
    }

    const readings = parseJlist(json);
    if (readings === null || readings.length === 0) return;

    const ts = new Date();
    await this.prisma.processSample.createMany({
      data: readings.map((r) => ({
        ts,
        pm2Name: r.pm2Name,
        pm2Id: r.pm2Id,
        status: r.status,
        restarts: r.restarts,
        cpuPct: r.cpuPct,
        memBytes: r.memBytes,
        startedAt: r.startedAt,
        nodeVersion: r.nodeVersion,
      })),
    });
  }
}
