import { statfs } from "node:fs/promises";
import { logger } from "@common/logger";
import { PrismaService } from "@db/prisma.service";
import { MaintenanceService } from "@maintenance/maintenance.service";
import { PURGE_AT } from "@maintenance/partitions";
import { Injectable } from "@nestjs/common";

import type { CollectorStorage, DiskUsage, StorageTable } from "@contracts/collector";

/**
 * What `GET /api/collector/storage` serves: real table sizes, the retention window in force, and
 * how much room is left (IKN-24).
 *
 * The mockup drew `4.2 GB` against `14d` as decoration. Everything here is measured — a retention
 * policy nobody can check from the interface is a retention policy nobody trusts, and the number
 * that matters on a VPS is the one that says how long before the disk fills.
 */

/**
 * How long a reading stays good for.
 *
 * `information_schema.TABLES` is not free on a partitioned table — InnoDB samples index pages to
 * answer it — and this panel has no reason at all to be fresh to the second: it is watching a
 * number that moves over days. Five minutes keeps it off the log queries' back entirely, and
 * `computedAt` travels with the payload so the panel can say how old the reading is rather than
 * implying it is live.
 */
export const CACHE_TTL_MS = 5 * 60_000;

/** The only table anything prunes. Everything else is the panel's `∞`. */
const PRUNED_TABLE = "log_entry";

type SizeRow = { name: string; bytes: bigint | number | null };

/** The snapshot, minus the per-request `meta` the controller adds. */
export type StorageSnapshot = Omit<CollectorStorage, "meta">;

@Injectable()
export class StorageService {
  private cached: { at: number; value: StorageSnapshot } | null = null;
  /**
   * The read in flight, so two tabs opening the panel at once ask MySQL once.
   *
   * Without it the cache is only a cache after the first answer lands: a cold start with three
   * open browsers issues three `information_schema` scans in the same second, which is the exact
   * cost this class exists to avoid.
   */
  private inFlight: Promise<StorageSnapshot> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenance: MaintenanceService,
  ) {}

  /**
   * `now` is a parameter rather than a `Date.now()` inside, and the stamp on the cached entry is
   * that same reading — one clock, not two. Stamping the entry with a second `Date.now()` after
   * the query returned made the freshness check unfalsifiable in a test that controls only the
   * first, and would have quietly extended the window by however long MySQL took.
   */
  async read(now: number = Date.now()): Promise<StorageSnapshot> {
    const cached = this.cached;
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.compute(now)
      .then((value) => {
        this.cached = { at: now, value };
        return value;
      })
      .finally(() => {
        // Cleared whether it resolved or threw, and the failure is deliberately not cached: a
        // database that was down for one request must not leave the panel dark for five minutes
        // after it comes back.
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async compute(now: number): Promise<StorageSnapshot> {
    const window = this.maintenance.window();

    const rows = await this.prisma.$queryRaw<SizeRow[]>`
      SELECT TABLE_NAME AS name, DATA_LENGTH + INDEX_LENGTH AS bytes
        FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`;

    const tables: StorageTable[] = rows
      .map((row) => ({
        name: row.name,
        // MySQL hands these back as BIGINT, which Prisma turns into a bigint; and both columns are
        // NULL for an engine that does not report them. Neither survives `JSON.stringify`.
        bytes: Number(row.bytes ?? 0),
        retentionDays: row.name === PRUNED_TABLE ? window.retentionDays : null,
      }))
      // Largest first: the panel is read top-down and the row that matters is the one growing.
      .sort((a, b) => b.bytes - a.bytes);

    return {
      tables,
      totalBytes: tables.reduce((sum, t) => sum + t.bytes, 0),
      retentionDays: window.retentionDays,
      oldestPartition: window.oldestPartition,
      lastPurgeAt: window.lastRunAt?.toISOString() ?? null,
      purgeAt: PURGE_AT,
      disk: await readDisk(),
      computedAt: new Date(now).toISOString(),
    };
  }
}

/**
 * The filesystem the API process is running on.
 *
 * **An assumption, and a deliberate one:** ks-b is a single VPS with one disk, so the volume Nest
 * was started from is the volume MySQL writes to. Asking MySQL for its own datadir and stat'ing
 * that would be exact, but it only differs on a host that does not exist here, and it puts a
 * second query behind the panel that is meant to keep working when queries are the problem.
 *
 * Returns `null` rather than zeroes if the platform will not answer — the footer then omits the
 * disk line instead of reporting a full disk, which is the difference between a quiet gap and a
 * false alarm.
 */
async function readDisk(): Promise<DiskUsage | null> {
  try {
    const fs = await statfs(process.cwd());
    return {
      // `bavail`, not `bfree`: the reserved blocks are root's, and counting them as free is how a
      // disk reports 5% remaining right up until writes start failing.
      freeBytes: Number(fs.bavail) * Number(fs.bsize),
      totalBytes: Number(fs.blocks) * Number(fs.bsize),
    };
  } catch (err) {
    logger.warn({ err }, "could not read filesystem usage for the storage panel");
    return null;
  }
}
