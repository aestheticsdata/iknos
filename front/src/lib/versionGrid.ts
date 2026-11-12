import { signed } from "@lib/aiRunFormat";
import { formatCount } from "@lib/format";
import { BETTER, VERSION_ROW } from "@lib/interfaces/aiRunTypes";
import { formatMicros } from "@lib/spanTimeline";
import { compareMeasure, compareRate, ratePct } from "@lib/versionDelta";
import { TRACES_TEXT } from "@text/traces";

import type { Better, Measure, Rate, VersionCell, VersionColumn, VersionRowKey } from "@lib/interfaces/aiRunTypes";

/**
 * The versions grid's cells (IKN-94), pure: each measure of a column printed, and — off the
 * reference column — its difference from the reference with the significance verdict.
 */

/** A column's key: its version and model, which together identify it. */
export const columnKey = (column: VersionColumn): string => `${column.version} · ${column.model}`;

/** The default reference: the column before the newest, the version most likely being replaced. */
export function defaultReference(columns: VersionColumn[]): string | null {
  if (columns.length === 0) return null;
  const byLast = [...columns].sort((a, b) => b.lastUs - a.lastUs);
  return columnKey(byLast[1] ?? byLast[0]);
}

type RateRow = {
  pick: (column: VersionColumn) => Rate;
  better: Better;
};

type MeasureRow = {
  pick: (column: VersionColumn) => Measure;
  better: Better;
  format: (value: number) => string;
};

const RATE_ROWS: Partial<Record<VersionRowKey, RateRow>> = {
  [VERSION_ROW.checks]: { pick: (column) => column.checksPassed, better: BETTER.up },
  [VERSION_ROW.approved]: { pick: (column) => column.approved, better: BETTER.up },
  [VERSION_ROW.rejected]: { pick: (column) => column.rejected, better: BETTER.down },
};

const micros = (value: number): string => formatMicros(value);
const ms = (value: number): string => formatMicros(value * 1000);

const MEASURE_ROWS: Partial<Record<VersionRowKey, MeasureRow>> = {
  [VERSION_ROW.p50]: { pick: (column) => column.latencyP50Us, better: BETTER.down, format: micros },
  [VERSION_ROW.p95]: { pick: (column) => column.latencyP95Us, better: BETTER.down, format: micros },
  [VERSION_ROW.ttft]: { pick: (column) => column.firstTokenMs, better: BETTER.down, format: ms },
  [VERSION_ROW.tps]: { pick: (column) => column.tokensPerSecond, better: BETTER.up, format: (v) => v.toFixed(0) },
  [VERSION_ROW.tokens]: {
    pick: (column) => column.tokensPerRun,
    better: BETTER.down,
    format: (v) => formatCount(Math.round(v)),
  },
};

const pctText = (rate: Rate): string => {
  const pct = ratePct(rate);
  return pct === null ? TRACES_TEXT.none : `${pct.toFixed(1)}%`;
};

/** One cell. `reference` is `null` for the reference column itself. */
export function versionCell(row: VersionRowKey, column: VersionColumn, reference: VersionColumn | null): VersionCell {
  if (row === VERSION_ROW.runs) return { value: formatCount(column.runs), delta: null, verdict: null };

  const rate = RATE_ROWS[row];
  if (rate) {
    const verdict = reference === null ? null : compareRate(rate.pick(column), rate.pick(reference), rate.better);
    return {
      value: pctText(rate.pick(column)),
      delta: verdict === null ? null : TRACES_TEXT.ptsWithCi(signed(verdict.delta, 1), verdict.spread.toFixed(1)),
      verdict,
    };
  }

  const measure = MEASURE_ROWS[row] as MeasureRow;
  const value = measure.pick(column).value;
  const verdict =
    reference === null
      ? null
      : compareMeasure(
          { measure: measure.pick(column), runs: column.runs },
          { measure: measure.pick(reference), runs: reference.runs },
          measure.better,
        );
  const sign = verdict !== null && verdict.delta < 0 ? "−" : "+";
  return {
    value: value === null ? TRACES_TEXT.none : measure.format(value),
    delta:
      verdict === null
        ? null
        : TRACES_TEXT.relDelta(`${sign}${measure.format(Math.abs(verdict.delta))}`, signed(verdict.spread * 100, 0)),
    verdict,
  };
}
