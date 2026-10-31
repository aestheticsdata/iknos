import { SignalTile } from "@components/service/SignalTile";
import { formatBytes, formatCount } from "@lib/format";
import { dailyAverage, formatShare, pagesPerVisit } from "@lib/trafficFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { TrafficTotals } from "@lib/interfaces/trafficTypes";
import type { RangeKey } from "@lib/timeRange";

/** The six numbers that answer "did anyone come" before anything else is read. */
export const HeadlineTiles = ({ totals, range }: HeadlineTilesProps) => {
  const average = dailyAverage(totals, range);
  const share = totals.requests > 0 ? totals.humanRequests / totals.requests : null;

  return (
    <div className="grid flex-none grid-cols-6 gap-2.75 max-rail:grid-cols-3">
      <SignalTile
        tile="visitors"
        kicker={TRAFFIC_TEXT.visitors}
        value={formatCount(totals.visitorDays)}
        unit={TRAFFIC_TEXT.visitorsUnit}
        hint={TRAFFIC_TEXT.visitorsHint}
      >
        {average !== null && (
          <span className="text-row text-work-text-muted">{TRAFFIC_TEXT.dailyAverage(average.toFixed(1))}</span>
        )}
      </SignalTile>
      <SignalTile
        tile="page-views"
        kicker={TRAFFIC_TEXT.pageViews}
        value={formatCount(totals.pageViews)}
        unit={TRAFFIC_TEXT.pageViewsUnit}
        hint={TRAFFIC_TEXT.pageViewsHint}
      >
        {null}
      </SignalTile>
      <SignalTile
        tile="per-visit"
        kicker={TRAFFIC_TEXT.perVisit}
        value={pagesPerVisit(totals)}
        unit={TRAFFIC_TEXT.perVisitUnit}
      >
        {null}
      </SignalTile>
      <SignalTile
        tile="human-share"
        kicker={TRAFFIC_TEXT.humanShare}
        value={formatShare(share)}
        unit={TRAFFIC_TEXT.humanShareUnit}
        hint={TRAFFIC_TEXT.humanShareHint}
      >
        {null}
      </SignalTile>
      <SignalTile
        tile="shared"
        kicker={TRAFFIC_TEXT.shared}
        value={formatCount(totals.previews)}
        unit={TRAFFIC_TEXT.sharedUnit}
        hint={TRAFFIC_TEXT.sharedHint}
      >
        {null}
      </SignalTile>
      <SignalTile
        tile="bandwidth"
        kicker={TRAFFIC_TEXT.bandwidth}
        value={formatBytes(totals.bytes)}
        unit={TRAFFIC_TEXT.bandwidthUnit}
      >
        {null}
      </SignalTile>
    </div>
  );
};

type HeadlineTilesProps = {
  totals: TrafficTotals;
  range: RangeKey;
};
