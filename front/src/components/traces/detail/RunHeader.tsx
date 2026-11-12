"use client";

import { runName, shortModel } from "@lib/aiRunFormat";
import { formatCount } from "@lib/format";
import { RUN_STATE } from "@lib/interfaces/aiRunTypes";
import { formatMicros } from "@lib/spanTimeline";
import { runStartLabel } from "@lib/traceFormat";
import { useZone } from "@lib/zoneState";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";
import { ChecksBadge, ReviewBadge, TelemetryBadge } from "../badges/RunBadges";
import { Stat } from "../shared/Stat";

import type { AiRunSummary } from "@lib/interfaces/aiRunTypes";

/** How long "copied" stays on the button. */
const COPIED_MS = 1500;

/**
 * The run's summary (IKN-92): its name and three verdicts, the copy action, then the numbers a
 * reader checks first — duration, tokens, structure, what ran it and when.
 */
export const RunHeader = ({ run }: RunHeaderProps) => {
  const { tz } = useZone();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(run.traceId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  return (
    <section
      aria-label={runName(run.traceId)}
      className="flex flex-none flex-col gap-3 rounded-card border border-work-border bg-work-surface px-3.5 py-3"
      data-testid="run-header"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="font-mono text-ui font-semibold text-work-text">{runName(run.traceId)}</h1>
        <ChecksBadge run={run} />
        <ReviewBadge review={run.review} />
        <TelemetryBadge telemetry={run.telemetry} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={copy}
          className="h-7 rounded-control border border-work-border-strong px-3 text-dense text-work-text transition-colors duration-150 ease-out hover:bg-work-inset"
          data-testid="copy-trace-id"
        >
          {copied ? TRACES_TEXT.copied : TRACES_TEXT.copyTraceId}
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4.5 gap-y-3 border-t border-work-border pt-2.75">
        <Stat
          label={TRACES_TEXT.sumDuration}
          value={run.state === RUN_STATE.running ? TRACES_TEXT.running : formatMicros(run.durationUs)}
        />
        <Stat
          label={TRACES_TEXT.sumTokens}
          value={formatCount(run.inputTokens + run.outputTokens)}
          hint={TRACES_TEXT.sumTokensSplit(formatCount(run.inputTokens), formatCount(run.outputTokens))}
        />
        <Stat
          label={TRACES_TEXT.sumStructure}
          value={TRACES_TEXT.structure(run.steps, run.spanCount)}
        />
        <Stat
          label={TRACES_TEXT.sumService}
          value={run.service}
        />
        <Stat
          label={TRACES_TEXT.sumPipeline}
          value={TRACES_TEXT.pipelineVersion(run.pipeline, run.pipelineVersion)}
        />
        <Stat
          label={TRACES_TEXT.sumPrompts}
          value={run.prompts.join(" · ") || TRACES_TEXT.none}
        />
        <Stat
          label={TRACES_TEXT.sumModel}
          value={run.model === null ? TRACES_TEXT.none : shortModel(run.model)}
        />
        <Stat
          label={TRACES_TEXT.sumStarted}
          value={runStartLabel(run.startUs, tz)}
        />
        <Stat
          label={TRACES_TEXT.sumTelemetry}
          value={
            run.contentUntilUs === null
              ? TRACES_TEXT.telemetryLong[run.telemetry]
              : TRACES_TEXT.telemetryUntil(runStartLabel(run.contentUntilUs, tz))
          }
        />
      </div>
    </section>
  );
};

type RunHeaderProps = {
  run: AiRunSummary;
};
