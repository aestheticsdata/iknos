import type { Tone } from "../surface";

/**
 * A horizontal line across a chart at a value on its own axis — the disk chart's alert lines
 * (IKN-25). Drawn in its own tone, so the line a reading must not cross reads as the rule it is
 * rather than as part of the series.
 */
export type ChartMark = {
  value: number;
  tone: Tone;
};
