"use client";

import { formatBytes } from "@lib/format";
import { timeLabel } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { CHASSIS_TEXT } from "@text/chassis";

import type { CollectorStorage, StorageTable } from "@lib/collectorTypes";

/**
 * *Storage & retention* — one row per table, and a footer that says when the disk gets swept
 * (IKN-24).
 *
 * The mockup drew `4.2 GB` against `14d` as decoration and put this panel in the alerts view,
 * which is M3. Every number here is measured, and until the alerts view exists the panel is
 * reached from the ingest card in the rail — the same neighbourhood, and the component moves
 * across unchanged when IKN-15 builds its real home.
 *
 * Rendered on the chassis surface because it lives in an overlay, not on the work surface.
 */
export const StoragePanel = ({ storage }: { storage: CollectorStorage }) => {
  /*
   * The same clock as the log panel and the top bar's own — IKN-38's rule, and this panel is
   * exactly where breaking it would show. `computedAt` is an ISO instant in UTC; slicing the
   * characters out of it printed `19:57` two inches under a clock reading `21:57`, which reads as
   * the panel being two hours stale rather than as two formatters disagreeing.
   */
  const { tz } = useZone();
  // The bars are relative to the biggest table, not to the disk: `log_entry` against a 20 GB
  // volume is a sliver next to four slivers, and the panel's job is to show which table is the
  // one growing. Absolute pressure is the footer's line.
  const largest = Math.max(...storage.tables.map((t) => t.bytes), 1);

  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-1.5">
        {storage.tables.map((table) => (
          <Row
            key={table.name}
            table={table}
            share={table.bytes / largest}
          />
        ))}
      </ul>

      <footer className="flex flex-wrap gap-x-2 gap-y-1 border-t border-chassis-border pt-2 text-micro text-chassis-text-dim">
        {storage.disk && (
          <span>
            {CHASSIS_TEXT.storageDisk(
              formatBytes(storage.disk.totalBytes - storage.disk.freeBytes),
              formatBytes(storage.disk.totalBytes),
            )}
          </span>
        )}
        <Sep />
        <span>{CHASSIS_TEXT.storagePurge(storage.purgeAt)}</span>
        <Sep />
        {/*
         * The oldest partition is the retention window as MySQL actually holds it, rather than as
         * the configuration claims — the one number that says whether the nightly job is really
         * running. Absent until the first pass has completed, and it says so rather than showing
         * today's date.
         */}
        <span>
          {storage.oldestPartition === null
            ? CHASSIS_TEXT.storageNoPartition
            : CHASSIS_TEXT.storageOldest(storage.oldestPartition)}
        </span>
        <Sep />
        {/* The reading is cached for minutes at a time. A panel that hid that would be claiming a
            freshness it does not have. */}
        <span className="ik-zone-flash ik-zone-lift">
          {CHASSIS_TEXT.storageReadAt(timeLabel(Date.parse(storage.computedAt), 60_000, tz))}
        </span>
      </footer>
    </div>
  );
};

const Sep = () => (
  <span
    aria-hidden
    className="text-chassis-border-strong"
  >
    ·
  </span>
);

const Row = ({ table, share }: { table: StorageTable; share: number }) => (
  <li className="flex items-center gap-2 text-row text-chassis-text-muted">
    <span className="w-[104px] shrink-0 truncate text-chassis-text">{table.name}</span>
    {/*
     * `aria-hidden`, because the bar is a second rendering of the number sitting next to it. A
     * screen reader announcing "72 percent" and then "4.2 GB" reports one fact twice, in two units,
     * and neither is the one that was asked for.
     */}
    <span
      aria-hidden
      className="h-1 flex-1 overflow-hidden rounded-full bg-chassis-inset"
    >
      <span
        className="block h-full bg-chassis-accent"
        // Percentages of a parent width are the one thing Tailwind cannot express as a class here:
        // the value is data, and a class built from it is a class the scanner never emits.
        style={{ width: `${Math.max(share * 100, 1)}%` }}
      />
    </span>
    <span className="w-[62px] shrink-0 text-right tabular-nums">{formatBytes(table.bytes)}</span>
    <span className="w-[30px] shrink-0 text-right tabular-nums text-chassis-text-dim">
      {table.retentionDays === null ? CHASSIS_TEXT.storageForever : `${table.retentionDays}d`}
    </span>
  </li>
);
