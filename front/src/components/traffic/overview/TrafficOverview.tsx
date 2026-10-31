"use client";

import { SURFACE_SCROLL } from "@components/ui/surface";
import { useTrafficOverview } from "@lib/useTraffic";
import { cn } from "@lib/utils";
import { TRAFFIC_TEXT } from "@text/traffic";
import { LoadState } from "../LoadState";
import { SiteCard } from "./SiteCard";

import type { RangeKey } from "@lib/timeRange";

/** Every site, busiest first (spec §6.1). A card selects its site in the rail. */
export const TrafficOverview = ({ range }: TrafficOverviewProps) => {
  const overview = useTrafficOverview(true, range);

  if (overview.data === null) {
    return (
      <LoadState
        error={overview.error}
        onRetry={overview.reload}
      />
    );
  }

  return (
    <div
      className={cn("h-full overflow-y-auto bg-work-ground px-3 py-2.75", SURFACE_SCROLL.work)}
      data-testid="traffic-overview"
    >
      <header className="mb-2.75 flex items-baseline gap-3">
        <h1 className="font-sans text-ui font-medium text-work-text">
          {TRAFFIC_TEXT.title} · {TRAFFIC_TEXT.allSites}
        </h1>
        <span className="text-kicker tracking-kicker text-work-text-dim uppercase">
          {TRAFFIC_TEXT.rangeLabel(range)}
        </span>
      </header>
      {overview.data.sites.length === 0 ? (
        <p className="text-row text-work-text-muted">{TRAFFIC_TEXT.noSites}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2.75 max-rail:grid-cols-1">
          {overview.data.sites.map((site) => (
            <li key={site.service}>
              <SiteCard site={site} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

type TrafficOverviewProps = {
  range: RangeKey;
};
