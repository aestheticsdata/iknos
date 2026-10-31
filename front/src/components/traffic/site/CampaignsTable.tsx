import { Card } from "@components/ui/Card";
import { DenseTable } from "@components/ui/DenseTable";
import { formatCount } from "@lib/format";
import { ABSENT } from "@lib/serviceFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { Column } from "@components/ui/DenseTable";
import type { CampaignRow } from "@lib/interfaces/trafficTypes";

/** Links that carried `utm_` tags. Shown only when one did. */
export const CampaignsTable = ({ rows }: CampaignsTableProps) => {
  const columns: Column<CampaignRow>[] = [
    { key: "source", header: TRAFFIC_TEXT.colSource, render: (row) => row.source },
    { key: "medium", header: TRAFFIC_TEXT.colMedium, render: (row) => row.medium ?? ABSENT },
    { key: "campaign", header: TRAFFIC_TEXT.colCampaign, render: (row) => row.campaign ?? ABSENT },
    { key: "visitors", header: TRAFFIC_TEXT.colVisitors, numeric: true, render: (row) => formatCount(row.visitorDays) },
    { key: "views", header: TRAFFIC_TEXT.colViews, numeric: true, render: (row) => formatCount(row.pageViews) },
  ];

  return (
    <Card
      title={TRAFFIC_TEXT.campaigns}
      bodyClassName="flex flex-col"
    >
      <DenseTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.source} ${row.medium} ${row.campaign}`}
        testId="traffic-campaigns"
      />
    </Card>
  );
};

type CampaignsTableProps = {
  rows: CampaignRow[];
};
