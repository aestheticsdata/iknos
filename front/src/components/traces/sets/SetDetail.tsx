"use client";

import { Modal } from "@components/ui/Modal";
import { readApiError } from "@lib/api";
import { deleteTestSet, removeRunFromSet, useTestSet } from "@lib/useTestSets";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";
import { LoadState } from "../shared/LoadState";
import { SetRunRow } from "./SetRunRow";

/**
 * One set (IKN-95): its name, what a kept run is, the runs, and the two ways out — remove a run,
 * delete the set. There is deliberately no replay: the note says why.
 */
export const SetDetail = ({ setId, onDeleted }: SetDetailProps) => {
  const detail = useTestSet(setId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (detail.data === null) {
    return (
      <section className="min-w-0 flex-[3_1_40rem] rounded-card border border-work-border bg-work-surface">
        <LoadState polled={detail} />
      </section>
    );
  }
  const { set, runs } = detail.data;

  const remove = async (runId: number) => {
    setError(null);
    try {
      await removeRunFromSet(setId, runId);
      detail.reload();
    } catch (failure) {
      setError(readApiError(failure, TRACES_TEXT.setFailed));
    }
  };

  const destroy = async () => {
    try {
      await deleteTestSet(setId);
      setConfirming(false);
      onDeleted();
    } catch (failure) {
      setError(readApiError(failure, TRACES_TEXT.setFailed));
    }
  };

  return (
    <section
      aria-label={set.name}
      className="flex min-w-0 flex-[3_1_40rem] flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
      data-testid="test-set-detail"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-work-border px-3.5 py-2.5">
        <h2 className="font-sans text-ui font-medium text-work-text">{set.name}</h2>
        <span className="text-row text-work-text-dim">
          {set.service} · {TRACES_TEXT.setRuns(set.runs)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-7 rounded-control border border-work-border-strong px-3 text-dense text-work-error transition-colors duration-150 ease-out hover:bg-work-inset"
          data-testid="delete-set"
        >
          {TRACES_TEXT.deleteSet}
        </button>
      </header>
      <div className="flex flex-col gap-1 border-b border-work-border px-3.5 py-2.5 text-label text-work-text-muted">
        <p>{TRACES_TEXT.copiesNote}</p>
        <p>{TRACES_TEXT.noReplay}</p>
        {error !== null && <p className="text-work-error">{error}</p>}
      </div>
      {runs.length === 0 ? (
        <p className="px-3.5 py-4 text-row text-work-text-dim">{TRACES_TEXT.setEmpty}</p>
      ) : (
        <ul className="flex flex-col">
          {runs.map((entry) => (
            <SetRunRow
              key={entry.id}
              entry={entry}
              onRemove={() => void remove(entry.id)}
            />
          ))}
        </ul>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        testId="delete-set-modal"
        tag={TRACES_TEXT.addTag}
        title={TRACES_TEXT.deleteSet}
        hint={TRACES_TEXT.deleteSetConfirm(set.name, set.runs)}
      >
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-7 rounded-control border border-chassis-border-strong px-3 text-dense text-chassis-text-muted transition-colors duration-150 ease-out hover:text-chassis-text"
          >
            {TRACES_TEXT.cancel}
          </button>
          <button
            type="button"
            onClick={() => void destroy()}
            className="h-7 rounded-control bg-chassis-error px-3 text-dense font-semibold text-chassis-deep transition-[filter] duration-150 ease-out hover:brightness-110"
            data-testid="delete-set-confirm"
          >
            {TRACES_TEXT.confirmDelete}
          </button>
        </div>
      </Modal>
    </section>
  );
};

type SetDetailProps = {
  setId: number;
  onDeleted: () => void;
};
