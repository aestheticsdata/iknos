import { Badge } from "@components/ui/Badge";
import { TRACES_TEXT } from "@text/traces";

import type { GateVerdict, GateView } from "@lib/interfaces/spanKindTypes";

/** A count is all a metadata-level run says; the rules' own words come with the content. */
const reasonsCount = (reasons: GateVerdict["reasons"]): string | null =>
  typeof reasons === "number" && reasons > 0 ? TRACES_TEXT.reasonsCount(reasons) : null;

const reasonLines = (reasons: GateVerdict["reasons"]): string[] => (Array.isArray(reasons) ? reasons : []);

/**
 * The gates the selection concerns (IKN-92) — the gate it sits in, the gates that looped back to
 * its step, or all of them for the run — each with its verdicts attempt by attempt. A failed verdict
 * lists its broken rules in their own words while the run's content is kept (OPI-36 sends one
 * evaluation event per rule); otherwise it says how many there were.
 */
export const ChecksTab = ({ gates }: ChecksTabProps) => {
  if (gates.length === 0) return <p className="py-5.5 text-dense text-work-text-dim">{TRACES_TEXT.noChecks}</p>;
  const failed = gates.filter((gate) => !gate.passed).length;

  return (
    <div
      className="flex flex-col"
      data-testid="span-checks"
    >
      <p className="py-2 text-label text-work-text-dim">{TRACES_TEXT.checksSummary(gates.length - failed, failed)}</p>
      {gates.map((gate) => (
        <div
          key={gate.node.spanId}
          className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2.5 border-t border-work-border py-2"
        >
          <span>
            <Badge tone={gate.passed ? "ok" : "error"}>{gate.passed ? TRACES_TEXT.passed : TRACES_TEXT.failed_}</Badge>
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-dense text-work-text">{gate.node.name}</span>
            {gate.verdicts.map((verdict) => (
              <div
                key={verdict.spanId}
                className="flex flex-col"
              >
                <span className="text-label text-work-text-muted">
                  {TRACES_TEXT.verdictLine(verdict.attempt)} ·{" "}
                  {verdict.passed ? TRACES_TEXT.passed : TRACES_TEXT.failed_}
                  {verdict.score !== null && ` · ${verdict.score.toFixed(2)}`}
                  {reasonsCount(verdict.reasons) !== null && ` · ${reasonsCount(verdict.reasons)}`}
                </span>
                {reasonLines(verdict.reasons).map((reason, index) => (
                  <span
                    key={reason}
                    className="pl-3 text-label text-work-text"
                  >
                    {TRACES_TEXT.ruleLine(index, reason)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

type ChecksTabProps = {
  gates: GateView[];
};
