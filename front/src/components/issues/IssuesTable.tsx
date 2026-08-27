"use client";

import { sparkTip } from "@components/issues/sparkTip";
import { BarSpark } from "@components/ui/BarSpark";
import { DenseTable } from "@components/ui/DenseTable";
import { Dot } from "@components/ui/Dot";
import { TONE_TEXT } from "@components/ui/surface";
import { formatCount } from "@lib/format";
import {
  formatAgo,
  formatRelease,
  isHot,
  issueLine,
  issueTitle,
  recencyTone,
  shortFingerprint,
} from "@lib/issueFormat";
import { cn } from "@lib/utils";
import { fullInstant } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { ISSUES_TEXT } from "@text/issues";

import type { Column } from "@components/ui/DenseTable";
import type { IssueRow } from "@lib/issueTypes";

/**
 * The full issues table (IKN-14 §1) — the mockup's eight columns.
 *
 * **`ERROR` carries two lines and that is the whole column**: the type in evidence, the message and
 * the file under it. It is the pair that lets a reader recognise an error without opening it, and
 * splitting it across two columns would put half of an identity at the other end of the row.
 *
 * **The affordance is a button inside that cell, not a click handler on the row.** A `<tr>` with an
 * `onClick` is a control a keyboard cannot reach and a screen reader does not announce, and giving
 * the row `role="button"` to fix that costs it its row semantics — so the widest cell holds a real
 * button spanning it, which is both the largest target on the row and a thing `Tab` finds.
 *
 * `RELEASE` shows `—` rather than being dropped while no deploy writes a marker the collector can
 * read (§8.7): a column that appears the day it starts working shifts every other column with it.
 */
export const IssuesTable = ({
  rows,
  spark,
  onOpen,
}: {
  rows: IssueRow[];
  /** The axis every row's series is drawn on — served with the page so the rows are comparable. */
  /** The one axis every row's bars are drawn on — `from` as well as the width, so a bar can name
   *  the two hours it counts rather than only how wide they were. */
  spark: { from: string; bucketMs: number } | null;
  onOpen: (fingerprint: string) => void;
}) => {
  const { tz } = useZone();
  // One instant for the whole table, so two rows in the same minute cannot land in different tiers.
  const now = Date.now();

  const columns: Column<IssueRow>[] = [
    {
      key: "fingerprint",
      header: ISSUES_TEXT.colFingerprint,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <Dot
            tone={recencyTone(row.lastSeen, now)}
            label={ISSUES_TEXT.recency[recencyTone(row.lastSeen, now)] ?? ""}
          />
          <span
            title={row.fingerprint}
            className="rounded-chip border border-work-border-strong bg-work-inset px-1.25 text-work-text-muted"
          >
            {shortFingerprint(row.fingerprint)}
          </span>
        </span>
      ),
    },
    {
      key: "error",
      header: ISSUES_TEXT.colError,
      render: (row) => (
        <button
          type="button"
          onClick={() => onOpen(row.fingerprint)}
          className="flex w-full min-w-0 flex-col text-left transition-colors duration-150 ease-out hover:text-work-accent"
        >
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate", isHot(row, now) && TONE_TEXT.work.error)}>{issueTitle(row)}</span>
            {row.regression && (
              <span className={cn("flex-none text-kicker tracking-kicker uppercase", TONE_TEXT.work.error)}>
                {ISSUES_TEXT.regression}
              </span>
            )}
          </span>
          <span className="truncate text-micro text-work-text-muted">{issueLine(row)}</span>
        </button>
      ),
    },
    { key: "service", header: ISSUES_TEXT.colService, render: (row) => row.service },
    {
      key: "spark",
      header: ISSUES_TEXT.colEvents,
      render: (row) =>
        spark === null ? null : (
          <span className="block h-3.5 w-13">
            <BarSpark
              values={row.spark}
              tone={isHot(row, now) ? "error" : "neutral"}
              height={14}
              label={ISSUES_TEXT.sparkLabel(issueTitle(row))}
              tip={sparkTip(spark, row.spark, tz)}
            />
          </span>
        ),
    },
    {
      key: "count",
      header: ISSUES_TEXT.colCount,
      numeric: true,
      render: (row) => formatCount(row.eventCount),
    },
    {
      key: "first",
      header: ISSUES_TEXT.colFirstSeen,
      numeric: true,
      render: (row) => <span title={fullInstant(row.firstSeen, tz)}>{formatAgo(row.firstSeen, now)}</span>,
    },
    {
      key: "last",
      header: ISSUES_TEXT.colLastSeen,
      numeric: true,
      render: (row) => <span title={fullInstant(row.lastSeen, tz)}>{formatAgo(row.lastSeen, now)}</span>,
    },
    {
      key: "release",
      header: ISSUES_TEXT.colRelease,
      render: (row) => formatRelease(row.lastRelease),
    },
  ];

  return (
    <DenseTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.fingerprint}
      empty={ISSUES_TEXT.emptyTable}
    />
  );
};
