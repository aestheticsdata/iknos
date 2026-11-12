"use client";

import { BucketBars } from "@components/charts/BucketBars";
import { ShareMeter } from "@components/charts/ShareMeter";
import { seriesSummary } from "@lib/charts/chartFormat";
import { METRIC } from "@lib/charts/metricTokens";
import { useSelectedService } from "@lib/chassisState";
import { formatCount } from "@lib/format";
import { formatShare } from "@lib/trafficFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { SiteSummary } from "@lib/interfaces/trafficTypes";

/** One site at a glance: visitors, page views, the share that was people, and where they came from. */
export const SiteCard = ({ site }: SiteCardProps) => {
  const [, select] = useSelectedService();

  return (
    <button
      type="button"
      onClick={() => select(site.service)}
      aria-label={TRAFFIC_TEXT.openSite(site.service)}
      className="flex w-full flex-col gap-2 rounded-card border border-work-border bg-work-surface px-3 py-2.25 text-left transition-[border-color] duration-150 ease-out hover:border-work-text-dim"
      data-testid="traffic-site-card"
      data-site={site.service}
    >
      <span className="font-sans text-ui font-medium text-work-text">{site.service}</span>
      {site.requests === 0 ? (
        <span className="text-row text-work-text-dim">{TRAFFIC_TEXT.noRequests}</span>
      ) : (
        <>
          <div className="flex items-baseline gap-4">
            <Figure
              value={formatCount(site.visitorDays)}
              label={TRAFFIC_TEXT.visitors}
            />
            <Figure
              value={formatCount(site.pageViews)}
              label={TRAFFIC_TEXT.pageViews}
            />
          </div>
          {/* A count per bucket, so bars (IKN-86); the last bucket is the one in progress. */}
          <BucketBars
            series={{
              values: site.series,
              metric: METRIC.visitors,
              partialIndex: site.series.length > 0 ? site.series.length - 1 : null,
            }}
            height={24}
            label={seriesSummary({
              series: TRAFFIC_TEXT.sparkLabel(site.service),
              span: TRAFFIC_TEXT.visitors,
              total: formatCount(site.visitorDays),
              values: site.series,
              bucketName: () => null,
            })}
          />
          <div className="flex items-center gap-2 text-row text-work-text-muted">
            <span className="w-12 flex-none">{TRAFFIC_TEXT.humanShare}</span>
            <span className="flex flex-1 justify-end">
              <ShareMeter
                share={site.humanShare ?? 0}
                metric={METRIC.visitors}
              />
            </span>
            <span className="w-8 flex-none text-right tabular-nums">{formatShare(site.humanShare)}</span>
          </div>
          {site.topSource !== null && (
            <span className="text-row text-work-text-muted">
              {TRAFFIC_TEXT.topSource}: <span className="text-work-text">{site.topSource}</span>
            </span>
          )}
        </>
      )}
    </button>
  );
};

const Figure = ({ value, label }: FigureProps) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-signal font-medium text-work-text tabular-nums">{value}</span>
    <span className="text-label text-work-text-muted">{label}</span>
  </span>
);

type SiteCardProps = {
  site: SiteSummary;
};

type FigureProps = {
  value: string;
  label: string;
};
