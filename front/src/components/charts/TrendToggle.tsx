import { cn } from "@lib/utils";

import type { TrendSwitch } from "./interfaces/bucketPanelTypes";

/**
 * `24h trend` in a panel header (IKN-86): a real button whose `aria-pressed` says whether the
 * moving average is drawn. Off by default. On, it is filled dark like the tooltip, so the state
 * can be read without reading the word.
 */
export const TrendToggle = ({ trend }: TrendToggleProps) => (
  <button
    type="button"
    aria-pressed={trend.on}
    onClick={trend.toggle}
    className={cn(
      "flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-row transition-colors duration-150 ease-out",
      trend.on
        ? "border-chart-tip-bg bg-chart-tip-bg text-chart-tip-fg"
        : "border-chart-axis bg-transparent text-chart-ref hover:border-chart-ref",
    )}
    data-testid="trend-toggle"
  >
    <span className="block h-0.5 w-3 rounded-full bg-current" />
    24h trend
  </button>
);

/** The swatch and the words for the hatched bucket, in a panel header. */
export const PartialLegend = ({ label }: PartialLegendProps) => (
  <span className="flex items-center gap-1.25 text-micro text-chart-ref">
    <span className="ik-chart-hatch block h-2.75 w-1.5 text-chart-ref" />
    {label}
  </span>
);

type TrendToggleProps = {
  trend: TrendSwitch;
};

type PartialLegendProps = {
  /** `current hour`, `current bucket`. */
  label: string;
};
