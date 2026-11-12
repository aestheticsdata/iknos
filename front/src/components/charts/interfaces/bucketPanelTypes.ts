import type { BucketSeries } from "./bucketBarsTypes";

/** One row of a `BucketPanel`: a series and the column of words to its left. */
export type PanelRow = {
  key: string;
  /** `visitors arriving`. */
  label: string;
  /** The range's total, printed 16px in the series' ink: `249`. */
  total: string;
  /** Under or beside the total: `35.6 / day`, `hits`. */
  sub: string;
  /** The series' name in the tooltip: `visitors`. */
  tipLabel: string;
  /** The row's chart in one sentence, for a screen reader. */
  summary: string;
  series: BucketSeries;
};

/** The panel's 24h-trend switch: whether it is on, and how to flip it. `null` hides the button. */
export type TrendSwitch = { on: boolean; toggle: () => void };
