import { cn } from "@lib/utils";

import type { ChartTipRow } from "@lib/charts/interfaces/chartTypes";

/**
 * What a chart's crosshair says (IKN-86). The bucket as a title in capitals,
 * `SAT 7 · 14:00 → 15:00`, then one row per series: its 4×9 swatch, its name, and its value
 * aligned right so the values compare down the column.
 */
export const ChartTip = ({ title, rows }: ChartTipProps) => (
  <div className="flex flex-col">
    <div className="text-chart-label tracking-chart-tip text-chart-tip-muted uppercase">{title}</div>
    {rows.map((row) => (
      <div
        key={row.label}
        className="flex items-center gap-2"
      >
        <span className={cn("h-2.25 w-1 flex-none", row.swatch)} />
        <span className="flex-1 text-chart-tip-label">{row.label}</span>
        <span className="pl-3.5 text-right tabular-nums">{row.value}</span>
      </div>
    ))}
  </div>
);

type ChartTipProps = {
  title: string;
  rows: readonly ChartTipRow[];
};
