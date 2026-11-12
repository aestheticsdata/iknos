import { Badge } from "@components/ui/Badge";
import { deltaPts, formatPct, signed } from "@lib/aiRunFormat";
import { formatCount } from "@lib/format";
import { formatMicros } from "@lib/spanTimeline";
import { TRACES_TEXT } from "@text/traces";

import type { Tone } from "@components/ui/surface";
import type { QualityKpis } from "@lib/interfaces/aiRunTypes";
import type { ReactNode } from "react";

/** A change smaller than this is not worth a colour. */
const QUIET_PTS = 1;

/** Higher is better for a rate: a drop past the quiet band is red, a rise green. */
function rateDelta(pts: number | null) {
  if (pts === null) return { text: TRACES_TEXT.noBaseline, tone: "neutral" as Tone };
  const tone: Tone = Math.abs(pts) < QUIET_PTS ? "neutral" : pts > 0 ? "ok" : "error";
  return { text: TRACES_TEXT.ptsDelta(signed(pts, 1)), tone };
}

/**
 * The four headline numbers (IKN-93), each against the window just before. Rates move in points;
 * the run count and the p95 in their own unit. The delta badge's word carries the direction, the
 * tone only repeats it.
 */
export const QualityKpiCards = ({ kpis }: QualityKpiCardsProps) => {
  const before = kpis.previous;
  const checks = rateDelta(deltaPts(kpis.checksPassed, before?.checksPassed ?? null));
  const approved = rateDelta(deltaPts(kpis.approved, before?.approved ?? null));
  const runsDelta = before === null || before.runs === 0 ? null : ((kpis.runs - before.runs) / before.runs) * 100;
  const p95Delta =
    before === null || before.durationP95Us === null || kpis.durationP95Us === null
      ? null
      : kpis.durationP95Us - before.durationP95Us;

  return (
    <div
      className="grid flex-none grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2.75"
      data-testid="quality-kpis"
    >
      <Card
        label={TRACES_TEXT.qkChecks}
        value={formatPct(kpis.checksPassed)}
        delta={<Badge tone={checks.tone}>{checks.text}</Badge>}
        hint={TRACES_TEXT.qkChecksHint}
      />
      <Card
        label={TRACES_TEXT.qkApproved}
        value={formatPct(kpis.approved)}
        delta={<Badge tone={approved.tone}>{approved.text}</Badge>}
        hint={TRACES_TEXT.qkApprovedHint(kpis.approved.total)}
      />
      <Card
        label={TRACES_TEXT.qkRuns}
        value={formatCount(kpis.runs)}
        delta={
          <Badge tone="neutral">
            {runsDelta === null ? TRACES_TEXT.noBaseline : TRACES_TEXT.pctDelta(signed(runsDelta, 0))}
          </Badge>
        }
        hint={TRACES_TEXT.qkRunsHint(kpis.fullTelemetryRuns)}
      />
      <Card
        label={TRACES_TEXT.qkP95}
        value={kpis.durationP95Us === null ? TRACES_TEXT.none : formatMicros(kpis.durationP95Us)}
        delta={
          <Badge tone={p95Delta !== null && p95Delta > 0 ? "error" : "neutral"}>
            {p95Delta === null
              ? TRACES_TEXT.noBaseline
              : `${p95Delta >= 0 ? "+" : "−"}${formatMicros(Math.abs(p95Delta))}`}
          </Badge>
        }
        hint={TRACES_TEXT.qkP95Hint}
      />
    </div>
  );
};

const Card = ({ label, value, delta, hint }: CardProps) => (
  <div className="flex flex-col gap-1.5 rounded-card border border-work-border bg-work-surface px-3.25 py-2.75">
    <span className="text-kicker tracking-kicker text-work-text-dim uppercase">{label}</span>
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-signal font-medium tabular-nums text-work-text">{value}</span>
      {delta}
    </div>
    <span className="text-label text-work-text-dim">{hint}</span>
  </div>
);

type QualityKpiCardsProps = {
  kpis: QualityKpis;
};

type CardProps = {
  label: string;
  value: string;
  delta: ReactNode;
  hint: string;
};
