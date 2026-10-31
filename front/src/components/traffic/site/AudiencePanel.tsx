import { Card } from "@components/ui/Card";
import { DenseTable } from "@components/ui/DenseTable";
import { formatCount } from "@lib/format";
import { formatAgo } from "@lib/issueFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { Column } from "@components/ui/DenseTable";
import type { BotRow, SiteTraffic } from "@lib/interfaces/trafficTypes";

/** The named bots, link previews first, and the scanners as one line of counts — never addresses. */
export const AudiencePanel = ({ traffic }: AudiencePanelProps) => {
  const columns: Column<BotRow>[] = [
    {
      key: "name",
      header: TRAFFIC_TEXT.colName,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {row.name}
          {row.preview && (
            <span className="text-kicker tracking-kicker text-work-accent uppercase">{TRAFFIC_TEXT.previewTag}</span>
          )}
        </span>
      ),
    },
    { key: "requests", header: TRAFFIC_TEXT.colRequests, numeric: true, render: (row) => formatCount(row.requests) },
    { key: "seen", header: TRAFFIC_TEXT.colLastSeen, numeric: true, render: (row) => formatAgo(row.lastSeen) },
  ];

  return (
    <Card
      title={TRAFFIC_TEXT.bots}
      bodyClassName="flex flex-col"
    >
      <DenseTable
        columns={columns}
        rows={traffic.bots}
        rowKey={(row) => row.name}
        empty={TRAFFIC_TEXT.emptyTable}
        testId="traffic-bots"
      />
      {traffic.scanners.requests > 0 && (
        <p className="border-t border-work-border px-2 py-1.5 text-row text-work-text-muted">
          {TRAFFIC_TEXT.scanners(formatCount(traffic.scanners.requests), formatCount(traffic.scanners.addresses))}
        </p>
      )}
    </Card>
  );
};

type AudiencePanelProps = {
  traffic: SiteTraffic;
};
