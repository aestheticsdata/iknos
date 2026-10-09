import { TONE_FILL } from "@components/ui/surface";
import { formatCount } from "@lib/format";
import { formatShare, STATUS_TONE, statusParts } from "@lib/metricsFormat";
import { cn } from "@lib/utils";
import { METRICS_TEXT } from "@text/metrics";
import { DetailCard } from "./DetailCard";

import type { StatusSplit } from "@lib/metricsTypes";

/**
 * The route's responses by class, as one stacked bar with its legend (IKN-23 §2).
 *
 * The full split, unlike the service tile's error rate: that tile counts 5xx only, because a 401 on
 * a mistyped password is the application working — and this is the place a reader comes to see
 * how many of those there were anyway.
 */
export const StatusCodes = ({ split }: StatusCodesProps) => {
  const parts = statusParts(split);

  return (
    <DetailCard
      kicker={METRICS_TEXT.status}
      testId="status-codes"
    >
      {parts.length === 0 ? (
        <p className="text-row text-work-text-dim">{METRICS_TEXT.statusEmpty}</p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="flex h-2.25 overflow-hidden rounded-chip bg-work-inset"
          >
            {parts.map((part) => (
              <span
                key={part.key}
                className={cn("h-full transition-[width] duration-150 ease-out", TONE_FILL.work[STATUS_TONE[part.key]])}
                style={{ width: `${part.share * 100}%` }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {parts.map((part) => (
              <li
                key={part.key}
                className="flex items-center gap-1.25 text-row text-work-text-muted"
                title={formatCount(part.count)}
              >
                <span className={cn("size-1.5 rounded-xs", TONE_FILL.work[STATUS_TONE[part.key]])} />
                {part.key} <span className="tabular-nums text-work-text">{formatShare(part.share)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </DetailCard>
  );
};

type StatusCodesProps = {
  split: StatusSplit;
};
