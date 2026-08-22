import { labelsHash } from "./labels-hash";

import type { PromSample } from "./prometheus-parser";

/** What `metric_sample.createMany` accepts; `labels` absent means SQL NULL. */
export type MetricRow = {
  service: string;
  ts: Date;
  name: string;
  labels?: Record<string, string>;
  labelsHash: string;
  value: number;
};

const MAX_NAME_LENGTH = 128;

/**
 * Samples → rows (IKN-8). This is where storability is decided, away from the parser: MySQL
 * DOUBLE holds neither Inf nor NaN, so non-finite values are dropped; a name longer than the
 * column is dropped whole, because truncation would mint a series that does not exist.
 */
export function toMetricRows(service: string, ts: Date, samples: PromSample[]): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.value)) continue;
    if (sample.name.length > MAX_NAME_LENGTH) continue;

    rows.push({
      service,
      ts,
      name: sample.name,
      ...(sample.labels ? { labels: sample.labels } : {}),
      labelsHash: labelsHash(sample.labels),
      value: sample.value,
    });
  }
  return rows;
}
