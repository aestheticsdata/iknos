import { Card } from "@components/ui/Card";
import { DenseTable } from "@components/ui/DenseTable";
import { formatCount } from "@lib/format";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { Column } from "@components/ui/DenseTable";
import type { SiteTraffic, StatusRow } from "@lib/interfaces/trafficTypes";

/** Responses by class, people against automated clients, and the most frequent exact codes. */
export const StatusPanel = ({ traffic }: StatusPanelProps) => {
  const columns: Column<StatusRow>[] = [
    { key: "class", header: TRAFFIC_TEXT.colClass, render: (row) => row.class },
    { key: "people", header: TRAFFIC_TEXT.colPeople, numeric: true, render: (row) => formatCount(row.human) },
    {
      key: "automated",
      header: TRAFFIC_TEXT.colAutomated,
      numeric: true,
      render: (row) => formatCount(row.automated),
    },
  ];

  return (
    <Card
      title={TRAFFIC_TEXT.status}
      bodyClassName="flex flex-col"
    >
      <DenseTable
        columns={columns}
        rows={traffic.status}
        rowKey={(row) => row.class}
        testId="traffic-status"
      />
      {traffic.topCodes.length > 0 && (
        <p className="flex flex-wrap gap-x-3 border-t border-work-border px-2 py-1.5 text-row text-work-text-muted tabular-nums">
          {traffic.topCodes.map((code) => (
            <span key={code.code}>
              <span className="text-work-text">{code.code}</span> {formatCount(code.requests)}
            </span>
          ))}
        </p>
      )}
    </Card>
  );
};

type StatusPanelProps = {
  traffic: SiteTraffic;
};
