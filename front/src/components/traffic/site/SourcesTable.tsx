import { Card } from "@components/ui/Card";
import { DenseTable } from "@components/ui/DenseTable";
import { formatCount } from "@lib/format";
import { TRAFFIC_TEXT } from "@text/traffic";
import { RouteLink } from "./RouteLink";

import type { Column } from "@components/ui/DenseTable";
import type { SourceRow } from "@lib/interfaces/trafficTypes";
import type { SiteScope } from "../interfaces/trafficViewTypes";

/** Where visitors came from, and where each source sent them. */
export const SourcesTable = ({ scope, rows }: SourcesTableProps) => {
  const columns: Column<SourceRow>[] = [
    {
      key: "source",
      header: TRAFFIC_TEXT.colSource,
      render: (row) => <span title={row.host ?? undefined}>{row.name}</span>,
    },
    { key: "visitors", header: TRAFFIC_TEXT.colVisitors, numeric: true, render: (row) => formatCount(row.visitorDays) },
    { key: "views", header: TRAFFIC_TEXT.colViews, numeric: true, render: (row) => formatCount(row.pageViews) },
    {
      key: "landings",
      header: TRAFFIC_TEXT.colLandings,
      render: (row) => (
        <span className="flex flex-col">
          {row.landings.map((route) => (
            <RouteLink
              key={route}
              scope={scope}
              route={route}
            />
          ))}
        </span>
      ),
    },
  ];

  return (
    <Card
      title={TRAFFIC_TEXT.sources}
      bodyClassName="flex flex-col"
    >
      <DenseTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.name}
        empty={TRAFFIC_TEXT.emptyTable}
        testId="traffic-sources"
      />
    </Card>
  );
};

type SourcesTableProps = {
  scope: SiteScope;
  rows: SourceRow[];
};
