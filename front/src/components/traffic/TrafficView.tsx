"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { TRAFFIC_TEXT } from "@text/traffic";
import { TrafficOverview } from "./overview/TrafficOverview";
import { SiteLinks } from "./SiteLinks";
import { SiteTrafficView } from "./site/SiteTrafficView";

import type { Service } from "@lib/services";

/**
 * The traffic view (IKN-83) — scoped by the rail like every view.
 *
 * `all` is the overview, one card per site. A site is its dashboard. Anything else is a PM2 app
 * with no access log, which has no traffic to show and says so, with the sites one click away.
 */
export const TrafficView = ({ services }: TrafficViewProps) => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const sites = services.filter((s) => s.site).map((s) => s.name);

  if (service === null) return <TrafficOverview range={range} />;

  if (!sites.includes(service)) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 bg-work-ground px-3 text-row text-work-text-muted"
        data-testid="traffic-notice"
      >
        <p>{TRAFFIC_TEXT.notASite}</p>
        <SiteLinks sites={sites} />
      </div>
    );
  }

  return (
    <SiteTrafficView
      service={service}
      range={range}
    />
  );
};

type TrafficViewProps = {
  services: Service[];
};
