"use client";

import { BarSpark } from "@components/ui/BarSpark";
import { Card } from "@components/ui/Card";
import { formatCount } from "@lib/format";
import { bucketLabel, readerTimeZone } from "@lib/trafficFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { Tone } from "@components/ui/surface";
import type { SiteTraffic, TrafficPoint } from "@lib/interfaces/trafficTypes";

/**
 * The range as three aligned bar rows: visitors arriving, page views, and automated requests.
 *
 * Three rows rather than one chart with three series, because the scales differ by an order of
 * magnitude — a bot crawl of 400 requests would flatten a day of 12 visitors to nothing. Each row
 * sets its own top. A bucket before the retention cut is `null` and draws nothing (`BarSpark`'s
 * third state), which is the honest picture of requests that are gone.
 */
export const TrafficChart = ({ traffic }: TrafficChartProps) => {
  const tz = readerTimeZone();
  const rows: ChartRow[] = [
    { label: TRAFFIC_TEXT.seriesVisitors, tone: "ok", pick: (p) => p.visitorDays },
    { label: TRAFFIC_TEXT.seriesPageViews, tone: "info", pick: (p) => p.pageViews },
    {
      label: TRAFFIC_TEXT.seriesAutomated,
      tone: "neutral",
      pick: (p) => (p.botRequests === null || p.scannerRequests === null ? null : p.botRequests + p.scannerRequests),
    },
  ];

  return (
    <Card
      title={TRAFFIC_TEXT.overTime}
      className="flex-none"
      data-testid="traffic-chart"
    >
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const values = traffic.series.map(row.pick);
          return (
            <div
              key={row.label}
              className="flex items-center gap-3"
            >
              <span className="w-28 flex-none text-row text-work-text-muted">{row.label}</span>
              <div className="h-10 min-w-0 flex-1">
                <BarSpark
                  values={values}
                  tone={row.tone}
                  height={40}
                  label={TRAFFIC_TEXT.chartLabel(row.label)}
                  tip={(index) => {
                    const point = traffic.series[index];
                    if (!point) return null;
                    const when = bucketLabel(point, traffic.bucket, tz);
                    const value = values[index];
                    return value === null
                      ? TRAFFIC_TEXT.tipGone(when)
                      : TRAFFIC_TEXT.tip(when, formatCount(value), row.label);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

type ChartRow = {
  label: string;
  tone: Tone;
  pick: (point: TrafficPoint) => number | null;
};

type TrafficChartProps = {
  traffic: SiteTraffic;
};
