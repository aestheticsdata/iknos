import { TONE_TEXT } from "@components/ui/surface";
import { formatCount } from "@lib/format";
import { formatLatency, PERCENTILE, p95Tone } from "@lib/metricsFormat";
import { ABSENT, formatPercent, formatRate } from "@lib/serviceFormat";
import { cn } from "@lib/utils";
import { METRICS_TEXT } from "@text/metrics";
import { DetailCard } from "./DetailCard";

import type { RouteSummary } from "@lib/metricsTypes";
import type { ReactNode } from "react";

/**
 * The route's figures over the range, and — at the foot — where they came from (IKN-23 §2).
 *
 * The provenance line is the reason this card exists rather than four more numbers: it is what
 * stops a p95 being read as a measurement when it is an interpolation inside a bucket (§5.3).
 */
export const RouteSummaryCard = ({ summary, thresholdMs, scrapeIntervalMs }: RouteSummaryCardProps) => {
  return (
    <DetailCard
      kicker={METRICS_TEXT.summary}
      testId="route-summary"
      className="min-h-0 flex-1"
    >
      <dl className="flex flex-col gap-1.5 text-row">
        <Figure label={METRICS_TEXT.throughput}>
          {formatRate(summary.rate)} {METRICS_TEXT.rateUnit}
        </Figure>
        <Figure label={METRICS_TEXT.requests}>{formatCount(summary.requests)}</Figure>
        <Figure label={PERCENTILE.p50}>{formatLatency(summary.p50)}</Figure>
        <Figure
          label={PERCENTILE.p95}
          tone={TONE_TEXT.work[p95Tone(summary.p95, thresholdMs)]}
        >
          {formatLatency(summary.p95)}
        </Figure>
        <Figure label={PERCENTILE.p99}>{formatLatency(summary.p99)}</Figure>
        <Figure
          label={METRICS_TEXT.errorRate}
          tone={summary.errorRate !== null && summary.errorRate > 0 ? TONE_TEXT.work.error : undefined}
        >
          {summary.errorRate === null ? ABSENT : `${formatPercent(summary.errorRate)}%`}
        </Figure>
      </dl>
      <p
        className="mt-auto border-t border-work-border-strong pt-1.75 text-micro text-work-text-dim"
        title={METRICS_TEXT.provenanceHint}
        data-testid="route-provenance"
      >
        {METRICS_TEXT.provenance(Math.round(scrapeIntervalMs / 1000))}
      </p>
    </DetailCard>
  );
};

const Figure = ({ label, tone, children }: FigureProps) => (
  <div className="flex justify-between text-work-text-muted">
    <dt>{label}</dt>
    <dd className={cn("tabular-nums text-work-text transition-colors duration-150 ease-out", tone)}>{children}</dd>
  </div>
);

type RouteSummaryCardProps = {
  summary: RouteSummary;
  thresholdMs: number;
  scrapeIntervalMs: number;
};

type FigureProps = {
  label: string;
  tone?: string;
  children: ReactNode;
};
