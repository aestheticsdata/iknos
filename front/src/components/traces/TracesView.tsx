"use client";

import { useSelectedService, useTimeRange } from "@lib/chassisState";
import { useSelectedRun } from "@lib/tracesState";
import { useTraceList } from "@lib/useTraces";
import { TRACES_TEXT } from "@text/traces";
import { RunDetail } from "./RunDetail";
import { RunList } from "./RunList";

import type { ReactNode } from "react";

/**
 * The Traces view (IKN-87) — the AI pipeline runs a service reported over OTLP, and the span tree
 * of one of them.
 *
 * Scoped by the rail and the range like every view. Runs belong to one service, so `all` gets a
 * sentence rather than a list summed across the fleet.
 *
 * **What is open defaults to the newest run**, read but not written — the metrics view's rule: the
 * screen answers on arrival and the address bar stays clean until the reader picks something. A
 * picked run that slid out of the window falls back the same way.
 *
 * The list takes a fixed two fifths of the height and the detail the rest, so a list growing on
 * the next poll never moves the waterfall under the pointer.
 */
export const TracesView = () => {
  const [service] = useSelectedService();
  const [range] = useTimeRange();
  const [picked, select] = useSelectedRun();

  const list = useTraceList(service, range);
  const runs = list.data?.traces ?? [];
  const open = runs.find((run) => run.traceId === picked) ?? runs[0] ?? null;

  if (service === null) return <Notice>{TRACES_TEXT.pickService}</Notice>;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 bg-work-ground px-3 py-2.75"
      data-testid="traces-view"
    >
      <RunList
        service={service}
        range={range}
        list={list}
        selected={open?.traceId ?? null}
        onSelect={(traceId) => void select(traceId)}
      />

      {open !== null ? (
        // Keyed by the run, so the picked span and the hover of one run never carry into the next.
        <RunDetail
          key={open.traceId}
          run={open}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-card border border-work-border bg-work-surface text-row text-work-text-dim">
          {list.data !== null ? TRACES_TEXT.pickRun : null}
        </div>
      )}
    </div>
  );
};

const Notice = ({ children }: NoticeProps) => (
  <div className="flex h-full items-center justify-center bg-work-ground px-3 text-row text-work-text-muted">
    <p data-testid="traces-notice">{children}</p>
  </div>
);

type NoticeProps = {
  children: ReactNode;
};
