"use client";

import { Modal } from "@components/ui/Modal";
import { Sparkline } from "@components/ui/Sparkline";
import { formatBytes, formatCount } from "@lib/format";
import { useCollectorStatus, useCollectorStorage } from "@lib/useCollector";
import { CHASSIS_TEXT } from "@text/chassis";
import { useState } from "react";
import { StoragePanel } from "./StoragePanel";

/**
 * The rail's `INGEST · 60m` card, and the door to the storage panel (IKN-24).
 *
 * The mockup's card carries a sparkline, an event count and a byte figure. Two of those come from
 * the collector's own memory; the third — how much the database is costing — is a query, so it
 * lives behind the click rather than in the rail. Chrome that is on screen permanently should not
 * be running `information_schema` scans.
 *
 * **The card is absent until the collector has something to report**, rather than drawn flat at
 * zero. A rail card showing a straight line and `0 ev` says "nothing is being collected" in the
 * same shape as "I started thirty seconds ago", and the second of those is not news.
 */
export const IngestCard = () => {
  const { status } = useCollectorStatus();
  const [open, setOpen] = useState(false);
  const { storage, loading, reload } = useCollectorStorage(open);

  const rate = status?.rate ?? null;

  return (
    <section className="mx-1 rounded-card border border-chassis-border bg-chassis-inset px-2.5 py-2 max-rail:mx-0 max-rail:px-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full flex-col gap-1.5 text-left"
        title={CHASSIS_TEXT.ingestOpen}
      >
        <span className="flex items-baseline gap-1 text-kicker tracking-kicker text-chassis-text-dim uppercase">
          <span>{CHASSIS_TEXT.ingest}</span>
          <span aria-hidden>·</span>
          <span>{CHASSIS_TEXT.ingestWindow}</span>
        </span>

        {rate === null ? (
          /* No reading yet. `Sparkline` already refuses to draw an empty series; this says why, so
             the gap reads as a state rather than as a component that failed to render. */
          <span className="text-micro text-chassis-text-dim max-rail:sr-only">{CHASSIS_TEXT.ingestNothingYet}</span>
        ) : (
          <>
            <Sparkline
              surface="chassis"
              tone="ok"
              values={rate.perMinute}
              width={128}
              height={24}
              label={CHASSIS_TEXT.ingestEvents(formatCount(rate.lines))}
              className="w-full max-rail:hidden"
            />
            <span className="flex w-full justify-between text-micro tabular-nums text-chassis-text-dim max-rail:flex-col max-rail:items-center max-rail:gap-0.5">
              <span>{CHASSIS_TEXT.ingestEvents(formatCount(rate.lines))}</span>
              <span>{formatBytes(rate.bytes)}</span>
            </span>
          </>
        )}

        {/*
         * Drops are the one counter here that is an actual fault — lines that existed and are now
         * gone — so they are shown whenever they are non-zero, and never otherwise. They do not
         * colour the pastille (see `healthOf`), because the count is cumulative from process start
         * and would leave permanent chrome amber for days after a single burst.
         */}
        {status !== null && status.dropped > 0 && (
          <span className="text-micro text-chassis-error max-rail:sr-only">
            {CHASSIS_TEXT.ingestDropped(formatCount(status.dropped))}
          </span>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        tag={CHASSIS_TEXT.storageTag}
        title={CHASSIS_TEXT.storageTitle}
        hint={status === null ? undefined : CHASSIS_TEXT.storageFiles(status.files.length)}
      >
        {storage !== null ? (
          <StoragePanel storage={storage} />
        ) : loading ? (
          <p className="text-row text-chassis-text-dim">{CHASSIS_TEXT.storageLoading}</p>
        ) : (
          <p className="flex items-center gap-2 text-row text-chassis-text-muted">
            {CHASSIS_TEXT.storageFailed}
            <button
              type="button"
              onClick={reload}
              className="text-chassis-info underline"
            >
              {CHASSIS_TEXT.storageRetry}
            </button>
          </p>
        )}
      </Modal>
    </section>
  );
};
