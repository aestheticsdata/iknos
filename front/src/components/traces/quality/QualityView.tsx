"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { useQuality } from "@lib/useAiRuns";
import { TRACES_TEXT } from "@text/traces";
import { LoadState } from "../shared/LoadState";
import { Notice } from "../shared/Notice";
import { FailureTable } from "./FailureTable";
import { QualityChart } from "./QualityChart";
import { QualityKpiCards } from "./QualityKpiCards";

/**
 * One service's AI quality (IKN-93): four KPIs against the window before, the daily rates with the
 * version changes marked, and the gates that fail most. The rail picks the service, the top bar the
 * window; the chart always spans the retention, so a change has days on both sides of it.
 */
export const QualityView = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const quality = useQuality(service, range);

  if (service === null) return <Notice>{TRACES_TEXT.pickService}</Notice>;
  const report = quality.data;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 overflow-y-auto bg-work-ground px-3 py-2.75"
      data-testid="quality-view"
    >
      <section className="flex flex-none flex-col gap-0.5 rounded-card border border-work-border bg-work-surface px-3.5 py-3">
        <h1 className="font-sans text-ui font-medium text-work-text">{TRACES_TEXT.qualityTitle(service)}</h1>
        {report !== null && (
          <p className="text-row text-work-text-dim">
            {TRACES_TEXT.qualityScope(report.pipeline, report.steps, report.gates, range)}
          </p>
        )}
      </section>

      {report === null ? (
        <section className="rounded-card border border-work-border bg-work-surface">
          <LoadState polled={quality} />
        </section>
      ) : report.kpis.runs === 0 && report.days.every((day) => day.runs === 0) ? (
        <p className="rounded-card border border-work-border bg-work-surface px-3 py-4 text-row text-work-text-muted">
          {TRACES_TEXT.noRunsQuality}
        </p>
      ) : (
        <>
          <QualityKpiCards kpis={report.kpis} />
          <QualityChart
            days={report.days}
            markers={report.markers}
          />
          <FailureTable
            failures={report.failures}
            ticketing={report.ticketing}
            context={{ service, range, onCreated: quality.reload }}
          />
        </>
      )}
    </div>
  );
};
