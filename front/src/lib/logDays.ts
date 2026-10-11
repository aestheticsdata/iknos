import { calendarDay } from "@lib/zone";

import type { LogFeedItem } from "@lib/logTypes";

/**
 * The rows that open a new calendar day in `tz`, mapped to the day's label (IKN-39) — the log
 * table draws a separator above each.
 *
 * The first row is always one: the top of the list needs its date as much as a midnight halfway
 * down does. A gap row does not interrupt a day — what it reports is lines that never arrived, not
 * time passing — so the comparison is always against the last *row*.
 *
 * Kept out of the feed itself on purpose. The panel's selection, keyboard walk and "expanded"
 * lookup all run over `LogFeedItem`s, and a third kind of item would be a third case in each of
 * them for something that is drawing, not data.
 */
export const dayStarts = (items: LogFeedItem[], tz: string) => {
  const starts = new Map<string, string>();
  let current: string | null = null;

  for (const item of items) {
    if (item.kind !== "row") continue;

    const day = calendarDay(item.row.ts, tz);
    if (day === null || day.key === current) continue;

    starts.set(item.key, day.label);
    current = day.key;
  }

  return starts;
};
