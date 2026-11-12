"use client";

import { Field } from "@components/ui/Field";
import { Modal } from "@components/ui/Modal";
import { Select } from "@components/ui/Select";
import { readApiError } from "@lib/api";
import { addRunToSet, createTestSet, useTestSets } from "@lib/useTestSets";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";

import type { AiRunSummary } from "@lib/interfaces/aiRunTypes";

/** The select's value for "a new set…". */
const NEW_SET = "new";

/**
 * "Add to test set" on the run detail (IKN-95): the design's primary button, and a dialog to pick
 * one of the service's sets or name a new one. Once added the button says where the run went.
 */
export const AddToSet = ({ run }: AddToSetProps) => {
  const sets = useTestSets(run.service);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  const available = sets.data?.sets ?? [];
  const picked = choice ?? (available[0] ? String(available[0].id) : NEW_SET);
  const creating = picked === NEW_SET;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const set = creating
        ? await createTestSet(run.service, name.trim())
        : available.find((s) => String(s.id) === picked);
      if (!set) return;
      await addRunToSet(set.id, run.traceId);
      setAddedTo(set.name);
      setOpen(false);
      sets.reload();
    } catch (failure) {
      setError(readApiError(failure, TRACES_TEXT.addFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-7 rounded-control bg-work-accent px-3 text-dense font-semibold text-work-surface transition-[filter] duration-150 ease-out hover:brightness-110"
        data-testid="add-to-set"
      >
        {addedTo === null ? `+ ${TRACES_TEXT.addToSet}` : `✓ ${TRACES_TEXT.addedToSet(addedTo)}`}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        testId="add-to-set-modal"
        tag={TRACES_TEXT.addTag}
        title={TRACES_TEXT.addTitle}
        hint={TRACES_TEXT.addHint}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Select
            surface="chassis"
            label={TRACES_TEXT.pickSet}
            options={[
              ...available.map((set) => ({
                value: String(set.id),
                label: `${set.name} · ${TRACES_TEXT.setRuns(set.runs)}`,
              })),
              { value: NEW_SET, label: TRACES_TEXT.newSetOption },
            ]}
            value={picked}
            onChange={(event) => setChoice(event.target.value)}
            data-testid="add-to-set-pick"
          />
          {creating && (
            <Field
              surface="chassis"
              label={TRACES_TEXT.newSetName}
              value={name}
              maxLength={128}
              required
              onChange={(event) => setName(event.target.value)}
              data-testid="add-to-set-name"
            />
          )}
          {error !== null && <p className="text-row text-chassis-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded-control border border-chassis-border-strong px-3 text-dense text-chassis-text-muted transition-colors duration-150 ease-out hover:text-chassis-text"
            >
              {TRACES_TEXT.cancel}
            </button>
            <button
              type="submit"
              disabled={busy || (creating && name.trim() === "")}
              className="h-7 rounded-control bg-chassis-accent px-3 text-dense font-semibold text-chassis-deep transition-[filter,opacity] duration-150 ease-out hover:brightness-110 disabled:opacity-50"
              data-testid="add-to-set-submit"
            >
              {busy ? TRACES_TEXT.adding : TRACES_TEXT.add}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};

type AddToSetProps = {
  run: AiRunSummary;
};
