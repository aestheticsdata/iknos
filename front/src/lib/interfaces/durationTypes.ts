/**
 * The units a duration is printed in (IKN-40), smallest first. No day: a request that logs 31 hours
 * reads `31h 04min`, legible enough for something already impossible.
 */
export const DURATION_UNIT = {
  ms: "ms",
  s: "s",
  min: "min",
  h: "h",
} as const;

export type DurationUnit = (typeof DURATION_UNIT)[keyof typeof DURATION_UNIT];

/**
 * One number and the unit bound to it — `15` and `min`. A duration is one or two of these, kept apart
 * so the log table can dim each unit without dimming its number.
 */
export type DurationSegment = {
  value: string;
  unit: DurationUnit;
};
