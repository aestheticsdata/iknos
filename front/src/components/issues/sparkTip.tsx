"use client";

import { TooltipBlock } from "@components/ui/Tooltip";
import { formatCount } from "@lib/format";
import { intervalLabel } from "@lib/zone";
import { ISSUES_TEXT } from "@text/issues";

import type { ReactNode } from "react";

/**
 * What one bar of an issue's sparkline says under the pointer — IKN-14's charts, given an axis.
 *
 * The three of them (the rail's row, the table's column, the modal's chart) are drawn from three
 * different payloads and were the same shape with no scale on any of them: fifty-two pixels of
 * bars over forty-eight hours, with the count of the *whole* window written beside it and nothing
 * saying what any single bar was worth. This is the one thing all three were missing, so it is
 * written once and passed to all three as `tip`.
 *
 * **The window comes from the server, never from the client's clock.** `IssuePage.spark` and
 * `OccurrenceSeries` both carry the `from` their counts start at, because the bars are only
 * comparable across rows if they share one axis — inferring "48 hours back from now" here would
 * put every row on a slightly different one, and would drift further with every minute the page
 * stayed open.
 */
export const sparkTip =
  (window: { from: string; bucketMs: number } | null, counts: number[], tz: string) =>
  (index: number): ReactNode => {
    const count = counts[index];
    if (window === null || count === undefined) return null;

    const start = Date.parse(window.from);
    if (!Number.isFinite(start)) return null;

    return (
      <TooltipBlock
        subject={intervalLabel(start + index * window.bucketMs, window.bucketMs, tz)}
        rows={[{ label: ISSUES_TEXT.sparkRow, value: formatCount(count) }]}
      />
    );
  };
