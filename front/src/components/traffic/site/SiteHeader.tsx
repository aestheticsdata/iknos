import { logsHref } from "@lib/logsHref";
import { retentionCut } from "@lib/trafficFormat";
import { TRAFFIC_TEXT } from "@text/traffic";
import Link from "next/link";

import type { SiteTraffic } from "@lib/interfaces/trafficTypes";
import type { SiteScope } from "../interfaces/trafficViewTypes";

/** The title, the range, the way to the raw lines, and the two caveats a number can carry. */
export const SiteHeader = ({ scope, traffic }: SiteHeaderProps) => (
  <header className="flex flex-none flex-col gap-1">
    <div className="flex items-baseline gap-3">
      <h1 className="font-sans text-ui font-medium text-work-text">
        {TRAFFIC_TEXT.title} · {scope.service}
      </h1>
      <span className="text-kicker tracking-kicker text-work-text-dim uppercase">
        {TRAFFIC_TEXT.rangeLabel(scope.range)}
      </span>
      <Link
        href={logsHref({ range: scope.range, values: { service: scope.service } })}
        className="ml-auto text-micro text-work-text-dim underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text hover:underline"
        data-testid="traffic-raw-lines"
      >
        {TRAFFIC_TEXT.rawLines}
      </Link>
    </div>
    {retentionCut(scope.range, traffic.retentionDays) && (
      <p className="text-row text-work-text-muted">{TRAFFIC_TEXT.retention(traffic.retentionDays)}</p>
    )}
    {traffic.partial && <p className="text-row text-work-warn">{TRAFFIC_TEXT.partial}</p>}
  </header>
);

type SiteHeaderProps = {
  scope: SiteScope;
  traffic: SiteTraffic;
};
