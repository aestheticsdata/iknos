import { Card } from "@components/ui/Card";
import { DenseTable } from "@components/ui/DenseTable";
import { formatCount } from "@lib/format";
import { TRAFFIC_TEXT } from "@text/traffic";
import { RouteLink } from "./RouteLink";

import type { Column } from "@components/ui/DenseTable";
import type { SiteScope } from "../interfaces/trafficViewTypes";

/** Top pages (views and visitors) or entry pages (visitors only) — the same table, two questions. */
export const PagesTable = ({ title, scope, rows, more }: PagesTableProps) => {
  const columns: Column<PageLike>[] = [
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
    ...(rows.some((row) => row.pageViews !== undefined)
      ? [
          {
            key: "views",
            header: TRAFFIC_TEXT.colViews,
            numeric: true,
            render: (row: PageLike) => formatCount(row.pageViews ?? 0),
          },
        ]
      : []),
    { key: "visitors", header: TRAFFIC_TEXT.colVisitors, numeric: true, render: (row) => formatCount(row.visitorDays) },
  ];

  return (
    <Card
      title={title}
      bodyClassName="flex flex-col"
    >
      <DenseTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.route}
        empty={TRAFFIC_TEXT.emptyTable}
        testId={`traffic-${title.replace(/\s+/g, "-")}`}
      />
      {more > 0 && <p className="px-2 py-1 text-row text-work-text-dim">{TRAFFIC_TEXT.morePages(more)}</p>}
    </Card>
  );
};

type PageLike = { route: string; visitorDays: number; pageViews?: number };

type PagesTableProps = {
  title: string;
  scope: SiteScope;
  rows: PageLike[];
  more: number;
};
