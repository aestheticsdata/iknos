"use client";

import { readApiError } from "@lib/api";
import { createTestSet } from "@lib/useTestSets";
import { cn } from "@lib/utils";
import { TRACES_TEXT } from "@text/traces";
import { useState } from "react";

import type { TestSetSummary } from "@lib/interfaces/testSetTypes";

/** The sets, newest first, each a button that opens it; and a name field to make one for the rail's service. */
export const SetList = ({ sets, service, openId, onOpen, onCreated }: SetListProps) => {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (service === null) return;
    setError(null);
    try {
      const set = await createTestSet(service, name.trim());
      setName("");
      onCreated(set.id);
    } catch (failure) {
      setError(readApiError(failure, TRACES_TEXT.addFailed));
    }
  };

  return (
    <section
      aria-label={TRACES_TEXT.setsTitle}
      className="flex min-w-0 flex-[1_1_16rem] flex-col overflow-hidden rounded-card border border-work-border bg-work-surface"
    >
      <ul className="ik-scroll-work flex max-h-[60dvh] flex-col overflow-y-auto">
        {sets.map((set) => (
          <li key={set.id}>
            <button
              type="button"
              aria-current={set.id === openId ? "true" : undefined}
              onClick={() => onOpen(set.id)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 border-b border-work-border px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-work-inset",
                set.id === openId && "border-l-2 border-l-work-accent bg-work-inset",
              )}
              data-testid="test-set"
            >
              <span className="text-dense font-medium text-work-text">{set.name}</span>
              <span className="text-micro text-work-text-dim">
                {set.service} · {TRACES_TEXT.setRuns(set.runs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-1.5 px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="flex gap-2">
          <input
            aria-label={TRACES_TEXT.newSetName}
            placeholder={TRACES_TEXT.newSetName}
            value={name}
            maxLength={128}
            disabled={service === null}
            onChange={(event) => setName(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-control border border-work-border-strong bg-work-inset px-2 text-ui text-work-text outline-none transition-[border-color] duration-150 ease-out focus:border-work-text-muted disabled:opacity-50"
            data-testid="new-set-name"
          />
          <button
            type="submit"
            disabled={service === null || name.trim() === ""}
            className="h-7 rounded-control border border-work-border-strong px-3 text-dense text-work-text transition-[background-color,opacity] duration-150 ease-out hover:bg-work-inset disabled:opacity-50"
          >
            {TRACES_TEXT.createSet}
          </button>
        </div>
        {service === null && <p className="text-micro text-work-text-dim">{TRACES_TEXT.createSetHint}</p>}
        {error !== null && <p className="text-micro text-work-error">{error}</p>}
      </form>
    </section>
  );
};

type SetListProps = {
  sets: TestSetSummary[];
  service: string | null;
  openId: number | null;
  onOpen: (id: number) => void;
  onCreated: (id: number) => void;
};
