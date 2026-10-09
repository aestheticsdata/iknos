import { MeterBar } from "@components/ui/MeterBar";
import { formatCount } from "@lib/format";
import { bucketLabel, bucketShares, bucketTone, formatShare } from "@lib/metricsFormat";
import { METRICS_TEXT } from "@text/metrics";
import { DetailCard } from "./DetailCard";

import type { LatencyBucket } from "@lib/metricsTypes";

/**
 * Where the route's requests landed, one row per **scraped** bucket (IKN-23 §2–3).
 *
 * The mockup draws four round bins — `<50ms`, `50–200ms`, `200ms–1s`, `>1s` — and the ticket says
 * why the view does not: a count between two bounds cannot be split across a third that was never
 * measured. The rows are prom-client's bounds as configured, and they change when it does.
 */
export const LatencyDistribution = ({ buckets, thresholdMs }: LatencyDistributionProps) => {
  const shares = bucketShares(buckets);
  const empty = shares.every((share) => share === null);

  return (
    <DetailCard
      kicker={METRICS_TEXT.distribution}
      testId="latency-distribution"
    >
      {empty ? (
        <p className="text-row text-work-text-dim">{METRICS_TEXT.distributionEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {buckets.map((bucket, index) => (
            <li
              key={`${bucket.fromMs}-${bucket.toMs}`}
              className="flex items-center gap-2 text-row text-work-text-muted"
              title={METRICS_TEXT.bucketHint(bucketLabel(bucket), formatCount(bucket.count))}
            >
              <span className="w-20 flex-none tabular-nums">{bucketLabel(bucket)}</span>
              <MeterBar
                share={shares[index] ?? 0}
                tone={bucketTone(bucket, thresholdMs)}
                className="flex-1"
              />
              <span className="w-9 flex-none text-right tabular-nums text-work-text">{formatShare(shares[index])}</span>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
};

type LatencyDistributionProps = {
  buckets: LatencyBucket[];
  thresholdMs: number;
};
