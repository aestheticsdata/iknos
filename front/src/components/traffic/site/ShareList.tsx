import { MeterBar } from "@components/ui/MeterBar";
import { formatShare } from "@lib/trafficFormat";
import { TRAFFIC_TEXT } from "@text/traffic";

import type { ShareRow } from "@lib/interfaces/trafficTypes";

/** A short list of names with their share of visitor-days — browsers, systems, devices. */
export const ShareList = ({ title, rows }: ShareListProps) => {
  const total = rows.reduce((sum, row) => sum + row.visitorDays, 0);

  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h4 className="text-kicker tracking-kicker text-work-text-dim uppercase">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-row text-work-text-dim">{TRAFFIC_TEXT.emptyTable}</p>
      ) : (
        rows.slice(0, 6).map((row) => (
          <div
            key={row.name}
            className="flex items-center gap-2 text-row text-work-text"
          >
            <span className="w-24 flex-none truncate">{row.name}</span>
            <MeterBar
              share={total > 0 ? row.visitorDays / total : 0}
              className="flex-1"
            />
            <span className="w-8 flex-none text-right text-work-text-muted tabular-nums">
              {formatShare(total > 0 ? row.visitorDays / total : null)}
            </span>
          </div>
        ))
      )}
    </section>
  );
};

type ShareListProps = {
  title: string;
  rows: ShareRow[];
};
