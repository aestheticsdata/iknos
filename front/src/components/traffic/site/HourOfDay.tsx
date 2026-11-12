"use client";

import { BucketBars } from "@components/charts/BucketBars";
import { ChartTip } from "@components/charts/ChartTip";
import { Card } from "@components/ui/Card";
import { formatChartValue, seriesSummary } from "@lib/charts/chartFormat";
import { METRIC, METRIC_INK } from "@lib/charts/metricTokens";
import { TRAFFIC_TEXT } from "@text/traffic";

/**
 * Human page views by hour of day, midnight first, on the reader's clock: a count per bucket, so
 * bars (IKN-86). No bucket is in progress here. Every bar sums the same hour across the range.
 */
export const HourOfDay = ({ hours }: HourOfDayProps) => (
  <Card title={TRAFFIC_TEXT.hourOfDay}>
    <BucketBars
      series={{ values: hours, metric: METRIC.views }}
      height={56}
      showPeak
      label={seriesSummary({
        series: TRAFFIC_TEXT.hourOfDayLabel,
        span: TRAFFIC_TEXT.pageViews,
        total: null,
        values: hours,
        bucketName: TRAFFIC_TEXT.hourName,
      })}
      tip={(hour) => (
        <ChartTip
          title={TRAFFIC_TEXT.hourName(hour)}
          rows={[
            {
              label: TRAFFIC_TEXT.pageViews,
              value: formatChartValue(hours[hour] ?? 0),
              swatch: METRIC_INK[METRIC.views].swatch,
            },
          ]}
        />
      )}
    />
    <div className="mt-1 flex justify-between text-chart-label text-chart-ref tabular-nums">
      <span>00</span>
      <span>06</span>
      <span>12</span>
      <span>18</span>
      <span>23</span>
    </div>
  </Card>
);

type HourOfDayProps = {
  hours: number[];
};
