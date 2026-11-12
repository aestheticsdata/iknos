import { formatPct } from "@lib/aiRunFormat";
import { formatCount } from "@lib/format";
import { formatMicros } from "@lib/spanTimeline";
import { TRACES_TEXT } from "@text/traces";
import { Stat } from "../shared/Stat";

import type { AiRunKpis } from "@lib/interfaces/aiRunTypes";

/** The window's headline numbers over the runs the filters keep (IKN-91). */
export const RunKpis = ({ kpis }: RunKpisProps) => (
  <div
    className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5 border-t border-work-border pt-2.75"
    data-testid="run-kpis"
  >
    <Stat
      label={TRACES_TEXT.kpiChecks}
      value={formatPct(kpis.checksPassed)}
    />
    <Stat
      label={TRACES_TEXT.kpiApproved}
      value={formatPct(kpis.approved)}
    />
    <Stat
      label={TRACES_TEXT.kpiRejected}
      value={formatPct(kpis.rejected)}
      tone={kpis.rejected.hits > 0 ? "text-work-error" : undefined}
    />
    <Stat
      label={TRACES_TEXT.kpiP95}
      value={kpis.durationP95Us === null ? TRACES_TEXT.none : formatMicros(kpis.durationP95Us)}
    />
    <Stat
      label={TRACES_TEXT.kpiTokens}
      value={formatCount(kpis.tokens)}
    />
  </div>
);

type RunKpisProps = {
  kpis: AiRunKpis;
};
