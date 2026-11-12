"use client";

import { Badge } from "@components/ui/Badge";
import { runName, shortModel } from "@lib/aiRunFormat";
import { runPath } from "@lib/routes";
import { joinedMessages, messagesOf } from "@lib/runInsights";
import { numberedCalls } from "@lib/testSetFormat";
import { runStartLabel } from "@lib/traceFormat";
import { useZone } from "@lib/zoneState";
import { TRACES_TEXT } from "@text/traces";
import Link from "next/link";
import { useState } from "react";
import { ChecksBadge, ReviewBadge } from "../badges/RunBadges";
import { MessageBlock } from "../detail/inspector/MessageBlock";

import type { TestSetRun } from "@lib/interfaces/testSetTypes";

/**
 * One kept run: what it was when it was added — its verdicts, prompts and model — and, opened, each
 * model call's input and reference output as they were copied. The run's own page may be gone by
 * now (the spans expire); the link stays, and the page says so.
 */
export const SetRunRow = ({ entry, onRemove }: SetRunRowProps) => {
  const { tz } = useZone();
  const [open, setOpen] = useState(false);
  const { run } = entry;

  return (
    <li
      className="border-b border-work-border last:border-0"
      data-testid="set-run"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2 text-row">
        <Link
          href={runPath(entry.traceId)}
          className="font-medium text-work-text underline-offset-2 transition-colors duration-150 ease-out hover:text-work-accent hover:underline"
        >
          {runName(entry.traceId)}
        </Link>
        <span className="text-work-text-dim">
          {TRACES_TEXT.colAdded} {runStartLabel(Date.parse(entry.addedAt) * 1000, tz)}
        </span>
        <span className="text-work-text-muted">
          {[run.prompts.join(" "), run.model === null ? null : shortModel(run.model)].filter(Boolean).join(" · ")}
        </span>
        <ChecksBadge run={run} />
        <ReviewBadge review={run.review} />
        <Badge tone={entry.hasInputs ? "info" : "neutral"}>
          {TRACES_TEXT.colInputs} {entry.hasInputs ? TRACES_TEXT.inputsKept : TRACES_TEXT.inputsMissing}
        </Badge>
        <span className="flex-1" />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="text-label text-work-text-muted underline-offset-2 transition-colors duration-150 ease-out hover:text-work-text hover:underline"
        >
          {open ? TRACES_TEXT.hideCalls : `${TRACES_TEXT.showCalls} (${entry.calls.length})`}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-label text-work-error underline-offset-2 transition-[filter] duration-150 ease-out hover:underline hover:brightness-110"
          data-testid="remove-set-run"
        >
          {TRACES_TEXT.removeRun}
        </button>
      </div>
      {open && (
        <ol className="flex flex-col gap-3 bg-work-inset/40 px-3.5 py-3">
          {numberedCalls(entry.calls).map((call) => (
            <li
              key={call.position}
              className="flex flex-col gap-2"
            >
              <span className="text-kicker tracking-kicker text-work-text-dim uppercase">
                {TRACES_TEXT.callHead(
                  call.step,
                  call.promptVersion,
                  call.model === null ? null : shortModel(call.model),
                )}
              </span>
              {call.input === null ? (
                <span className="text-label text-work-text-dim">{TRACES_TEXT.noCallContent}</span>
              ) : (
                <div className="grid gap-2.5 lg:grid-cols-2">
                  <MessageBlock
                    title={TRACES_TEXT.input}
                    tokens={null}
                    messages={joinedMessages(call.system, call.input)}
                  />
                  <MessageBlock
                    title={TRACES_TEXT.referenceOutput}
                    tokens={null}
                    messages={messagesOf(call.output)}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
};

type SetRunRowProps = {
  entry: TestSetRun;
  onRemove: () => void;
};
