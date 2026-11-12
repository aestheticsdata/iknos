"use client";

import { useRunFilters } from "@lib/aiRunsState";
import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { useRunList } from "@lib/useAiRuns";
import { LoadState } from "../shared/LoadState";
import { RunFilters } from "./RunFilters";
import { RunKpis } from "./RunKpis";
import { RunTable } from "./RunTable";

/**
 * The run list (IKN-91) — every AI pipeline run of the rail's service, or of every service on `all`,
 * in the top bar's range: the filters and the window's headline numbers above, the runs below.
 *
 * A run opens on its own page (IKN-92), so the list keeps the whole height.
 */
export const RunsView = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const [state, setState] = useRunFilters();
  const filters = { checks: state.checks, review: state.review, prompt: state.prompt, model: state.model };
  const list = useRunList({ service, range, filters, page: state.page });

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 overflow-y-auto bg-work-ground px-3 py-2.75"
      data-testid="runs-view"
    >
      <section className="flex flex-none flex-col gap-3 rounded-card border border-work-border bg-work-surface px-3.5 py-3">
        <RunFilters
          list={list.data}
          range={range}
          filters={filters}
          onChange={(next) => void setState({ ...next, page: 0 })}
        />
        {list.data !== null && <RunKpis kpis={list.data.kpis} />}
      </section>

      {list.data !== null ? (
        <RunTable
          list={list.data}
          page={state.page}
          filtered={Object.values(filters).some((value) => value !== null)}
          onPage={(page) => void setState({ page })}
        />
      ) : (
        <section className="rounded-card border border-work-border bg-work-surface">
          <LoadState polled={list} />
        </section>
      )}
    </div>
  );
};
