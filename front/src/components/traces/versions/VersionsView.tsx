"use client";

import { Select } from "@components/ui/Select";
import { useVersionView } from "@lib/aiRunsState";
import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { useVersions } from "@lib/useAiRuns";
import { TRACES_TEXT } from "@text/traces";
import { LoadState } from "../shared/LoadState";
import { Notice } from "../shared/Notice";
import { VersionGrid } from "./VersionGrid";

/** The step select's value for the whole pipeline. */
const PIPELINE = "";

/**
 * One step of a service's pipeline — or the whole of it — compared across the prompt versions and
 * models it ran with (IKN-94). The reference column is the reader's pick, in the URL; every other
 * column says how far it is from it and whether that is more than noise.
 */
export const VersionsView = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const [view, setView] = useVersionView();
  const versions = useVersions({ service, step: view.step, range });

  if (service === null) return <Notice>{TRACES_TEXT.pickService}</Notice>;
  const report = versions.data;
  const steps = report?.steps ?? [];
  const stepLabel = steps.find((step) => step.id === view.step)?.label ?? TRACES_TEXT.wholePipeline;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 overflow-y-auto bg-work-ground px-3 py-2.75"
      data-testid="versions-view"
    >
      <section className="flex flex-none flex-wrap items-end gap-3 rounded-card border border-work-border bg-work-surface px-3.5 py-3">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
          <h1 className="font-sans text-ui font-medium text-work-text">{TRACES_TEXT.versionsTitle(service)}</h1>
          <p className="text-row text-work-text-dim">{TRACES_TEXT.versionsScope(stepLabel, range)}</p>
        </div>
        <Select
          label={TRACES_TEXT.stepLabel}
          options={[
            { value: PIPELINE, label: TRACES_TEXT.wholePipeline },
            ...steps.map((step) => ({ value: step.id, label: step.label })),
          ]}
          value={view.step ?? PIPELINE}
          onChange={(event) => void setView({ step: event.target.value || null, ref: null })}
          className="w-filter"
          data-testid="version-step"
        />
      </section>

      {report === null ? (
        <section className="rounded-card border border-work-border bg-work-surface">
          <LoadState polled={versions} />
        </section>
      ) : report.columns.length === 0 ? (
        <p className="rounded-card border border-work-border bg-work-surface px-3 py-4 text-row text-work-text-muted">
          {TRACES_TEXT.noVersions}
        </p>
      ) : (
        <VersionGrid
          columns={report.columns}
          reference={view.ref}
          onReference={(ref) => void setView({ ref })}
        />
      )}
    </div>
  );
};
