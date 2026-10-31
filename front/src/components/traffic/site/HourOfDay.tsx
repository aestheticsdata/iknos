"use client";

import { BarSpark } from "@components/ui/BarSpark";
import { Card } from "@components/ui/Card";
import { formatCount } from "@lib/format";
import { TRAFFIC_TEXT } from "@text/traffic";

/** Human page views by hour of day, midnight first, on the reader's clock. */
export const HourOfDay = ({ hours }: HourOfDayProps) => (
  <Card title={TRAFFIC_TEXT.hourOfDay}>
    <div className="h-16">
      <BarSpark
        values={hours}
        tone="info"
        height={64}
        label={TRAFFIC_TEXT.hourOfDayLabel}
        tip={(hour) => TRAFFIC_TEXT.hourTip(hour, formatCount(hours[hour] ?? 0))}
      />
    </div>
    <div className="mt-1 flex justify-between text-micro text-work-text-dim tabular-nums">
      <span>00</span>
      <span>06</span>
      <span>12</span>
      <span>18</span>
      <span>23</span>
    </div>
  </Card>
);

type HourOfDayProps = {
  hours: number[];
};
