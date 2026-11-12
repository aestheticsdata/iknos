import { CHECKS, REVIEW, TELEMETRY } from "@lib/interfaces/aiRunTypes";
import { ratePct } from "@lib/versionDelta";

import type { Tone } from "@components/ui/surface";
import type { Checks, Rate, Review, Telemetry } from "@lib/interfaces/aiRunTypes";

/** How the AI traces screens print their values (IKN-91 … IKN-94). Pure. */

/** Checks as a tone: a failure earns red, a pass the accent, the rest stays quiet. */
export const CHECKS_TONE: Record<Checks, Tone> = {
  [CHECKS.passed]: "ok",
  [CHECKS.failed]: "error",
  [CHECKS.pending]: "warn",
  [CHECKS.none]: "neutral",
};

/** A rejection is the loud one; an edit is a warning — the human had to step in. */
export const REVIEW_TONE: Record<Review, Tone> = {
  [REVIEW.approve]: "ok",
  [REVIEW.edit]: "warn",
  [REVIEW.reject]: "error",
  [REVIEW.none]: "neutral",
};

export const TELEMETRY_TONE: Record<Telemetry, Tone> = {
  [TELEMETRY.full]: "info",
  [TELEMETRY.metadata]: "neutral",
};

/** `84.6%`, or a dash when there was nothing to count. */
export function formatPct(rate: Rate): string {
  const pct = ratePct(rate);
  return pct === null ? "–" : `${pct.toFixed(1)}%`;
}

/** A signed number with a real minus sign, at `digits` decimals. */
export function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return `±${text}`;
  return `${value > 0 ? "+" : "−"}${text}`;
}

/** The difference of two rates in percentage points, or `null` when either is empty. */
export function deltaPts(now: Rate, before: Rate | null): number | null {
  if (before === null) return null;
  const a = ratePct(now);
  const b = ratePct(before);
  return a === null || b === null ? null : a - b;
}

/** A trace id as the screens name a run: its first twelve characters. */
export const runName = (traceId: string): string => traceId.slice(0, 12);

/** WebLLM model ids are long and end in a build suffix; the screens keep the model and its quantisation. */
export function shortModel(model: string): string {
  return model.replace(/-MLC$/, "").replace(/-Instruct/, "");
}
