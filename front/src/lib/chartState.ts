"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";

/** Written to the URL only when the trend is on, so an ordinary link stays clean. */
export const TREND = { on: "on", off: "off" } as const;

const TREND_STATES = [TREND.on, TREND.off] as const;

/**
 * Whether the 24h trend is drawn over the traffic bars (IKN-86). Off by default.
 *
 * In the URL like every other view preference here (`useSignalsOpen`, the range, the zone): it
 * survives a reload, the back button walks it, and a shared link opens the way it was sent.
 */
export const useChartTrend = (): [boolean, () => void] => {
  const [state, setState] = useQueryState("trend", parseAsStringLiteral(TREND_STATES).withDefault(TREND.off));
  const toggle = () => {
    void setState((current) => (current === TREND.on ? null : TREND.on));
  };
  return [state === TREND.on, toggle];
};
