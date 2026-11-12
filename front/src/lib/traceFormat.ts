import { timeLabel } from "@lib/zone";

/**
 * Small display helpers for the Traces view (IKN-87).
 */

const DAY_MS = 86_400_000;
const SECOND_MS = 1000;

/** `11-12 14:02:31` on the reader's clock — the default range is a week, so a time alone is ambiguous. */
export const runStartLabel = (startUs: number, tz: string): string => {
  const ms = startUs / 1000;
  return `${timeLabel(ms, DAY_MS, tz)} ${timeLabel(ms, SECOND_MS, tz)}`;
};

/** An attribute value as one line of text: strings bare, everything else as JSON. */
export const attrText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Attributes sorted by key, so the same span always reads the same way down the inspector. */
export const sortedAttrs = (attrs: Record<string, unknown> | null): [string, unknown][] =>
  Object.entries(attrs ?? {}).sort(([a], [b]) => a.localeCompare(b));
