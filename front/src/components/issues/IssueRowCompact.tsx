"use client";

import { BarSpark } from "@components/ui/BarSpark";
import { Dot } from "@components/ui/Dot";
import { SURFACE_TEXT, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED, TONE_TEXT } from "@components/ui/surface";
import { formatCount } from "@lib/format";
import { formatAgo, isHot, issueLine, issueTitle, recencyTone, shortFingerprint } from "@lib/issueFormat";
import { cn } from "@lib/utils";
import { ISSUES_TEXT } from "@text/issues";

import type { IssueRow } from "@lib/issueTypes";

/**
 * One issue as the rail draws it (IKN-14 §2) — the mockup's three lines.
 *
 * Severity dot, fingerprint chip, count and age on the first; the type and a sparkline on the
 * second; the message and where it happened, clamped to two lines, on the third. The order is the
 * mockup's and it is the order the questions come in: *is this happening now*, *what is it*, *where*.
 *
 * A button rather than a link, like every other row in this application: opening an issue sets a
 * query parameter on the view the reader is already on rather than navigating away from it.
 */
export const IssueRowCompact = ({
  row,
  now,
  onOpen,
}: {
  row: IssueRow;
  /** Passed in rather than taken here, so a panel of four rows agrees with itself about "now". */
  now: number;
  onOpen: () => void;
}) => {
  const tone = recencyTone(row.lastSeen, now);
  const hot = isHot(row, now);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={row.fingerprint}
      className={cn(
        "flex w-full flex-col gap-1 border-b px-2.75 py-2 text-left transition-colors duration-150 ease-out last:border-0",
        "border-work-border hover:bg-work-inset",
        // The hot ground is the mockup's, and it is the *same* threshold the dot uses — a row
        // painted hot under a warn dot would be saying two things about one issue.
        hot && "bg-work-error-bg",
      )}
    >
      <span className="flex items-center gap-1.75">
        <Dot
          tone={tone}
          label={ISSUES_TEXT.recency[tone] ?? tone}
        />
        {/* Half the hash: enough to recognise across a session, not enough to verify. The full
            value is on the row's title and in the URL, which is where an exact value belongs. */}
        <span className="flex-none rounded-chip border border-work-border-strong bg-work-inset px-1.25 text-row text-work-text-muted">
          {shortFingerprint(row.fingerprint)}
        </span>
        <span className="flex-1" />
        <span className={cn("text-row font-medium tabular-nums", hot ? TONE_TEXT.work.error : SURFACE_TEXT.work)}>
          {formatCount(row.eventCount)}
        </span>
        <span className={cn("text-micro", SURFACE_TEXT_DIM.work)}>{formatAgo(row.lastSeen, now)}</span>
      </span>

      <span className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-row", SURFACE_TEXT.work)}>{issueTitle(row)}</span>
        {/* 52×14, the mockup's own box. Bars rather than the prototype's polyline: an occurrence
            count per two-hour interval is a measurement of that interval and nothing lies between
            two of them — the argument `BarSpark` makes for itself. */}
        <span className="h-3.5 w-13 flex-none">
          <BarSpark
            values={row.spark}
            tone={hot ? "error" : "neutral"}
            height={14}
            label={ISSUES_TEXT.sparkLabel(issueTitle(row))}
          />
        </span>
      </span>

      <span className={cn("line-clamp-2 text-micro leading-relaxed", SURFACE_TEXT_MUTED.work)}>{issueLine(row)}</span>
    </button>
  );
};
