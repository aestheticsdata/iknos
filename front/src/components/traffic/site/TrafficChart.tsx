"use client";

import { BucketPanel } from "@components/charts/BucketPanel";
import { useChartTrend } from "@lib/chartState";
import { formatChartValue, seriesSummary } from "@lib/charts/chartFormat";
import { METRIC, TRENDABLE } from "@lib/charts/metricTokens";
import { dayStarts } from "@lib/charts/timeAxis";
import { movingAverage, trendWindow } from "@lib/charts/trend";
import { rangeMinutes } from "@lib/timeRange";
import { BUCKET_MS, bucketTitle, CURRENT_BUCKET, readerTimeZone } from "@lib/trafficFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { PanelRow } from "@components/charts/interfaces/bucketPanelTypes";
import type { Metric } from "@lib/charts/interfaces/chartTypes";
import type { SiteTraffic, TrafficPoint } from "@lib/interfaces/trafficTypes";
import type { RangeKey } from "@lib/timeRange";

const DAY_MINUTES = 24 * 60;

/**
 * The range as three rows of bars sharing one crosshair (IKN-86): visitors arriving, page views,
 * and bots and scanners.
 *
 * Three rows rather than one chart with three series, because the scales differ by orders of
 * magnitude. A bucket before the retention cut is `null` and draws nothing, which is the honest
 * picture of requests that are gone. The last bucket is the one in progress, and it is hatched.
 *
 * The `24h trend` button lays a trailing day's moving average over visitors and page views, in
 * their own unit and on their own axis. Bots arrive in bursts and get no average.
 */
export const TrafficChart = ({ traffic, range }: TrafficChartProps) => {
  const tz = readerTimeZone();
  const [trendOn, toggleTrend] = useChartTrend();
  const points = traffic.series;
  const bucketMs = BUCKET_MS[traffic.bucket];
  const rangeMs = rangeMinutes(range) * 60_000;
  const partialIndex = points.at(-1)?.partial ? points.length - 1 : null;
  const days =
    rangeMinutes(range) >= DAY_MINUTES
      ? dayStarts(
          points.map((point) => Date.parse(point.t)),
          bucketMs,
          tz,
        )
      : [];
  const window = trendWindow(bucketMs, rangeMs);
  const rangeDays = rangeMinutes(range) / DAY_MINUTES;
  const perDay = (total: number) =>
    rangeDays > 1 ? TRAFFIC_TEXT.perDay(formatChartValue(total / rangeDays)) : TRAFFIC_TEXT.inRange;
  const name = (index: number) => (points[index] ? bucketTitle(points[index], traffic.bucket, tz) : null);

  const row = (spec: RowSpec): PanelRow => {
    const values = points.map(spec.pick);
    return {
      key: spec.key,
      label: spec.label,
      total: formatChartValue(spec.total),
      sub: spec.sub,
      tipLabel: spec.tipLabel,
      summary: seriesSummary({
        series: spec.label,
        span: TRAFFIC_TEXT.rangeLabel(range),
        total: formatChartValue(spec.total),
        values,
        bucketName: name,
      }),
      series: {
        values,
        metric: spec.metric,
        partialIndex,
        trend: trendOn && TRENDABLE.has(spec.metric) ? movingAverage(values, window) : null,
      },
    };
  };

  const automated = traffic.totals.botRequests + traffic.totals.scannerRequests;

  return (
    <BucketPanel
      title={TRAFFIC_TEXT.overTime}
      label={TRAFFIC_TEXT.panelLabel(range)}
      testId="traffic-chart"
      partialLabel={CURRENT_BUCKET[traffic.bucket]}
      trend={{ on: trendOn, toggle: toggleTrend }}
      days={days}
      tipTitle={(index) => name(index) ?? ""}
      rows={[
        row({
          key: METRIC.visitors,
          metric: METRIC.visitors,
          label: TRAFFIC_TEXT.seriesVisitors,
          tipLabel: TRAFFIC_TEXT.visitors,
          total: traffic.totals.visitorDays,
          sub: perDay(traffic.totals.visitorDays),
          pick: (point) => point.visitorDays,
        }),
        row({
          key: METRIC.views,
          metric: METRIC.views,
          label: TRAFFIC_TEXT.seriesPageViews,
          tipLabel: TRAFFIC_TEXT.pageViews,
          total: traffic.totals.pageViews,
          sub: perDay(traffic.totals.pageViews),
          pick: (point) => point.pageViews,
        }),
        row({
          key: METRIC.bots,
          metric: METRIC.bots,
          label: TRAFFIC_TEXT.seriesAutomated,
          tipLabel: TRAFFIC_TEXT.bots,
          total: automated,
          sub: TRAFFIC_TEXT.hits,
          pick: (point) =>
            point.botRequests === null || point.scannerRequests === null
              ? null
              : point.botRequests + point.scannerRequests,
        }),
      ]}
    />
  );
};

/** What one row of the panel is made from. */
type RowSpec = {
  key: string;
  metric: Metric;
  label: string;
  tipLabel: string;
  total: number;
  sub: string;
  pick: (point: TrafficPoint) => number | null;
};

type TrafficChartProps = {
  traffic: SiteTraffic;
  range: RangeKey;
};
