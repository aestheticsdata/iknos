"use client";

import { SURFACE_SCROLL } from "@components/ui/surface";
import { useSiteTraffic } from "@lib/useTraffic";
import { cn } from "@lib/utils";
import { TRAFFIC_TEXT } from "@text/traffic";
import { LoadState } from "../LoadState";
import { AudiencePanel } from "./AudiencePanel";
import { BrokenLinks } from "./BrokenLinks";
import { CampaignsTable } from "./CampaignsTable";
import { HeadlineTiles } from "./HeadlineTiles";
import { HourOfDay } from "./HourOfDay";
import { PagesTable } from "./PagesTable";
import { SetupPanel } from "./SetupPanel";
import { SiteHeader } from "./SiteHeader";
import { SourcesTable } from "./SourcesTable";
import { StatusPanel } from "./StatusPanel";
import { TrafficChart } from "./TrafficChart";

import type { SiteScope } from "../interfaces/trafficViewTypes";

/**
 * One site's dashboard (spec §6.2): the headline numbers, the series, then the tables in two
 * columns — one below the rail breakpoint. The page scrolls inside the work area.
 */
export const SiteTrafficView = ({ service, range }: SiteScope) => {
  const traffic = useSiteTraffic(service, range);
  const scope = { service, range };

  if (traffic.data === null) {
    return (
      <LoadState
        error={traffic.error}
        onRetry={traffic.reload}
      />
    );
  }

  const data = traffic.data;

  /* A site nobody requested in the range gets a sentence, not six zeros dressed as data (spec §6). */
  if (data.totals.requests === 0) {
    return (
      <div
        className="flex h-full flex-col gap-2.75 bg-work-ground px-3 py-2.75"
        data-testid="traffic-site"
      >
        <SiteHeader
          scope={scope}
          traffic={data}
        />
        <p className="text-row text-work-text-muted">{TRAFFIC_TEXT.noRequests}</p>
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-full flex-col gap-2.75 overflow-y-auto bg-work-ground px-3 py-2.75", SURFACE_SCROLL.work)}
      data-testid="traffic-site"
    >
      <SiteHeader
        scope={scope}
        traffic={data}
      />
      <HeadlineTiles
        totals={data.totals}
        range={range}
      />
      <TrafficChart
        traffic={data}
        range={range}
      />
      <div className="grid flex-none grid-cols-2 items-start gap-2.75 max-rail:grid-cols-1">
        <PagesTable
          title={TRAFFIC_TEXT.topPages}
          scope={scope}
          rows={data.topPages}
          more={data.morePages}
        />
        <PagesTable
          title={TRAFFIC_TEXT.entryPages}
          scope={scope}
          rows={data.entryPages}
          more={0}
        />
        <SourcesTable
          scope={scope}
          rows={data.sources}
        />
        <SetupPanel traffic={data} />
        {data.campaigns.length > 0 && <CampaignsTable rows={data.campaigns} />}
        <HourOfDay hours={data.hourOfDay} />
        <AudiencePanel traffic={data} />
        <StatusPanel traffic={data} />
        <BrokenLinks
          scope={scope}
          rows={data.brokenLinks}
        />
      </div>
    </div>
  );
};
