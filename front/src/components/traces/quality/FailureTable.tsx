import { Badge } from "@components/ui/Badge";
import { DenseTable } from "@components/ui/DenseTable";
import { signed } from "@lib/aiRunFormat";
import { formatCount } from "@lib/format";
import { TRACES_TEXT } from "@text/traces";

import type { Column } from "@components/ui/DenseTable";
import type { Tone } from "@components/ui/surface";
import type { FailurePattern } from "@lib/interfaces/aiRunTypes";
import type { RangeKey } from "@lib/timeRange";

/** The trend against the window before: more failures is red, fewer green, a new gate failing says so. */
function trendOf(pattern: FailurePattern) {
  if (pattern.previous === null) return { text: TRACES_TEXT.noBaseline, tone: "neutral" as Tone };
  const change = pattern.failures - pattern.previous;
  if (change === 0) return { text: TRACES_TEXT.trendSame, tone: "neutral" as Tone };
  if (pattern.previous === 0) return { text: TRACES_TEXT.trendNew(change), tone: "error" as Tone };
  const pct = (change / pattern.previous) * 100;
  return {
    text: `${change > 0 ? "▲" : "▼"} ${signed(change, 0)} (${signed(pct, 0)}%)`,
    tone: (change > 0 ? "error" : "ok") as Tone,
  };
}

/**
 * The gates that fail, by volume (IKN-93): the step they loop back to, the gate, its failed verdicts
 * in the window, its share against the worst, and the trend. The Spira ticket column is IKN-96's.
 */
export const FailureTable = ({ failures, range }: FailureTableProps) => {
  const worst = Math.max(1, ...failures.map((pattern) => pattern.failures));

  const columns: Column<FailurePattern>[] = [
    { key: "step", header: TRACES_TEXT.colStep, render: (pattern) => pattern.step ?? TRACES_TEXT.none },
    { key: "gate", header: TRACES_TEXT.colGate, render: (pattern) => pattern.gateLabel },
    {
      key: "failures",
      header: TRACES_TEXT.colFailures,
      numeric: true,
      render: (pattern) => formatCount(pattern.failures),
    },
    {
      key: "share",
      header: TRACES_TEXT.colShare,
      render: (pattern) => (
        <span className="block h-1.5 w-40 overflow-hidden rounded-chip bg-work-inset">
          <span
            className="block h-full bg-chart-neutral transition-[width] duration-300 ease-out"
            style={{ width: `${(pattern.failures / worst) * 100}%` }}
          />
        </span>
      ),
    },
    {
      key: "trend",
      header: TRACES_TEXT.colTrend,
      render: (pattern) => {
        const trend = trendOf(pattern);
        return <Badge tone={trend.tone}>{trend.text}</Badge>;
      },
    },
  ];

  return (
    <section
      className="flex flex-none flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
      data-testid="failure-patterns"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-work-border px-3 py-2.5">
        <h2 className="flex-1 font-sans text-ui font-medium text-work-text">{TRACES_TEXT.failuresTitle}</h2>
        <span className="text-label text-work-text-dim">{TRACES_TEXT.failuresScope(range)}</span>
      </header>
      <DenseTable
        columns={columns}
        rows={failures}
        rowKey={(pattern) => pattern.gate}
        rowAttrs={(pattern) => ({ "data-testid": "failure-row", "data-gate": pattern.gate })}
        empty={TRACES_TEXT.noFailures}
        testId="failures-scroll"
      />
    </section>
  );
};

type FailureTableProps = {
  failures: FailurePattern[];
  range: RangeKey;
};
