import { Card } from "@components/ui/Card";
import { DenseTable } from "@components/ui/DenseTable";
import { formatCount } from "@lib/format";
import { TRAFFIC_TEXT } from "@text/traffic";
import { RouteLink } from "./RouteLink";

import type { Column } from "@components/ui/DenseTable";
import type { BrokenLink } from "@lib/interfaces/trafficTypes";
import type { SiteScope } from "../interfaces/trafficViewTypes";

/** The 404s people hit, and who sent them there — scanners' probes are not in it. */
export const BrokenLinks = ({ scope, rows }: BrokenLinksProps) => {
  const columns: Column<BrokenLink>[] = [
    {
      key: "route",
      header: TRAFFIC_TEXT.colPage,
      render: (row) => (
        <RouteLink
          scope={scope}
          route={row.route}
        />
      ),
    },
    { key: "from", header: TRAFFIC_TEXT.colFrom, render: (row) => row.source },
    { key: "hits", header: TRAFFIC_TEXT.colHits, numeric: true, render: (row) => formatCount(row.hits) },
  ];

  return (
    <Card
      title={TRAFFIC_TEXT.brokenLinks}
      bodyClassName="flex flex-col"
    >
      <DenseTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.route} ${row.source}`}
        empty={TRAFFIC_TEXT.emptyTable}
        testId="traffic-broken-links"
      />
    </Card>
  );
};

type BrokenLinksProps = {
  scope: SiteScope;
  rows: BrokenLink[];
};
