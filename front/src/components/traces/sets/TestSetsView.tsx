"use client";

import { useOpenSet } from "@lib/aiRunsState";
import { useSelectedService } from "@lib/chassisState";
import { useTestSets } from "@lib/useTestSets";
import { TRACES_TEXT } from "@text/traces";
import { LoadState } from "../shared/LoadState";
import { SetDetail } from "./SetDetail";
import { SetList } from "./SetList";

/**
 * Test sets (IKN-95) — no design artboard of its own, so it is built from the run detail's and the
 * versions screen's language: the sets on the left, the open set's kept runs on the right.
 *
 * Scoped by the rail like every view; on `all` it lists every service's sets. A set is made from a
 * run's page ("add to test set"), or here for the rail's service.
 */
export const TestSetsView = () => {
  const [service] = useSelectedService();
  const [view, setView] = useOpenSet();
  const sets = useTestSets(service);
  const list = sets.data?.sets ?? [];
  const open = list.find((set) => set.id === view.set) ?? list[0] ?? null;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.75 overflow-y-auto bg-work-ground px-3 py-2.75"
      data-testid="test-sets-view"
    >
      <section className="flex flex-none flex-col gap-0.5 rounded-card border border-work-border bg-work-surface px-3.5 py-3">
        <h1 className="font-sans text-ui font-medium text-work-text">{TRACES_TEXT.setsTitle}</h1>
        <p className="text-row text-work-text-dim">{TRACES_TEXT.setsScope(service)}</p>
      </section>

      {sets.data === null ? (
        <section className="rounded-card border border-work-border bg-work-surface">
          <LoadState polled={sets} />
        </section>
      ) : (
        <div className="flex min-h-0 flex-wrap items-start gap-2.75">
          <SetList
            sets={list}
            service={service}
            openId={open?.id ?? null}
            onOpen={(id) => void setView({ set: id })}
            onCreated={(id) => {
              sets.reload();
              void setView({ set: id });
            }}
          />
          {open === null ? (
            <p className="min-w-0 flex-[3_1_40rem] rounded-card border border-work-border bg-work-surface px-3 py-4 text-row text-work-text-muted">
              {TRACES_TEXT.noSets}
            </p>
          ) : (
            <SetDetail
              key={open.id}
              setId={open.id}
              onDeleted={() => {
                sets.reload();
                void setView({ set: null });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
