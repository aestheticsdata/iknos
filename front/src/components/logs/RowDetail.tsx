"use client";

import { Button } from "@components/ui/Button";
import { Modal } from "@components/ui/Modal";
import { Pending } from "@components/ui/Pending";
import {
  SURFACE_BORDER,
  SURFACE_INSET_BG,
  SURFACE_TEXT,
  SURFACE_TEXT_DIM,
  SURFACE_TEXT_MUTED,
  TONE_TEXT,
} from "@components/ui/surface";
import { severityOf, userAgentOf } from "@lib/logTypes";
import { cn } from "@lib/utils";
import { fullInstant } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { LOGS_TEXT } from "@text/logs";

import type { LogRow } from "@lib/logTypes";
import type { LogDetailState } from "@lib/useLogDetail";

/**
 * The log line's detail, in a modal — IKN-60.
 *
 * Was `LogTable`'s in-place `RowDetail`, a second `<tr>` that pushed every row below it. IKN-53
 * built the fade-and-scale gesture this now reuses and, at the time, named the row as one of the
 * two things deliberately kept out of it — "a row unfolding is the same surface getting taller",
 * not something arriving on top of the page. This ticket is that row asking for the other reading:
 * the same content, the same fetch, now surfaced the way the trace timeline already is.
 *
 * **`LogRow` still carries no `attrs`, and that is still the point.** IKN-19 leaves it out of the
 * list payload deliberately, because two hundred rows of arbitrary JSON is a payload nobody reads
 * and everybody pays for. IKN-58 added the per-row fetch (`GET /api/logs/entry/:id`) that lands in
 * `state.detail`, and the two panes below stopped being redundant — the left one is the event as
 * the API has it, `attrs` included, rather than the list row re-serialised.
 *
 * Until it arrives — and forever, for a live-tail row that has no id to fetch by — the pane still
 * renders what the line genuinely carries and nothing else. No invented keys, no empty `attrs: {}`,
 * and no `—` beside a label for a field this event does not have.
 *
 * For an error the right pane is headed `stack` and leads with the message unclipped and
 * pre-wrapped, because a pino-serialised error folds `err.stack` into exactly that field. That is
 * the row showing what it has, not this file claiming a stack exists.
 *
 * **Mounted for the whole session, like `TraceTimeline`.** `open` is derived from `row` rather than
 * kept as a state of its own, so the element survives its own close — a `<dialog>` returns focus to
 * whichever row opened it, and a node torn down in the same frame would take that with it. `Modal`
 * already latches the last real content while it leaves (IKN-53), so `row` going back to `null` the
 * instant the panel closes never blanks the card mid-exit.
 *
 * `title`/`tag` deliberately do not use the message: it is exactly the one field on a `LogRow` with
 * no length bound, and `Modal`'s header has no `truncate` of its own to fall back on. The full
 * instant is what the row's own time cell already uses to say "which line" (its `title` attribute),
 * so reusing it here costs nothing new to read.
 */
export const RowDetail = ({
  row,
  state,
  onClose,
  onOpenTrace,
  onCopy,
}: {
  row: LogRow | null;
  /** The panel's fetch for this row: `detail` is null while it is in flight, and for a live row. */
  state: LogDetailState;
  onClose: () => void;
  onOpenTrace: (traceId: string) => void;
  onCopy: (row: LogRow) => void;
}) => {
  const { tz, abbrev } = useZone();
  const { detail, loading: detailLoading, error: detailError } = state;

  const isError = row !== null && severityOf(row.level) === "error";
  const traceId = row?.traceId ?? null;
  // `user_agent.original` is a key and not a path — see `userAgentOf`, which is where that is
  // spelled out and tested, because reaching for it as a path finds `undefined` every time.
  const agent = userAgentOf(detail?.attrs);

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      // This panel has nothing a stray click could cost — see `Modal`'s own doc for the default
      // this opts out of, and why it is an opt-in rather than the other way round.
      closeOnBackdropClick
      tag={row?.service ?? ""}
      title={row !== null ? fullInstant(row.ts, tz) : ""}
      actions={
        row !== null && (
          <>
            {/* Close is an action here too, even with the backdrop click above: `Modal` still draws
                no control of its own beyond the `esc` hint, and a reader on a keyboard alone — or
                who never discovers the backdrop is clickable — still needs something to aim
                `Enter` at. Same reasoning as `TraceTimeline`. */}
            <Button
              variant="quiet"
              onClick={onClose}
            >
              {LOGS_TEXT.close}
            </Button>
            {/* Two actions, and `issue` is **absent rather than disabled**. Raising an issue from a
                line is IKN-14's, and the design doc's rule about a control that is visible and dead
                applies to it: a greyed `issue` here reads as a permission problem or as a broken
                build, and would have to be un-greyed by the ticket that can actually answer it
                anyway. */}
            {traceId !== null && (
              <Button
                variant="quiet"
                onClick={() => onOpenTrace(traceId)}
              >
                {LOGS_TEXT.openTrace}
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() => onCopy(detail ?? row)}
            >
              {LOGS_TEXT.copyRow}
            </Button>
          </>
        )
      }
    >
      {row !== null && (
        /* One column below `rail`, where the rail has already folded and two panes of JSON side by
           side would each be too narrow to hold a line of it. */
        <div className="grid grid-cols-1 gap-3 rail:grid-cols-2">
          <section>
            <PaneHeading>{LOGS_TEXT.rawEvent(abbrev)}</PaneHeading>
            {/*
             * The event serialised — the same object `copy NDJSON` puts on the clipboard, pretty
             * printed, which is why both read `detail ?? row` rather than one of them keeping a
             * second copy. Before the fetch answers (and forever, for a live row) that is the list
             * row itself, which is genuinely all the client has.
             *
             * Capped rather than left to grow: `attrs` is arbitrary and a serialised `err.stack`
             * is not small, so without a ceiling one line's event could be taller than the modal
             * a `<dialog>` is height-limited to in the first place.
             *
             * Its `ts` stays UTC when the column above has been switched to a local zone, and that
             * is the point rather than an oversight: this is what the API said and what `jq` will
             * read, so converting it would make the pane a paraphrase of the event instead of the
             * event. The heading carries the `· utc` that says so whenever the two differ.
             */}
            <pre
              className={cn(
                // `ik-scroll-x`, not `ik-scroll`: the vertical variant's `overscroll-behavior:
                // none` would eat every wheel event the pointer spends over it, which matters less
                // inside a modal than it did over the stream but is still the wrong default for a
                // pane that scrolls sideways.
                "ik-scroll-x max-h-64 overflow-auto rounded-chip border p-2 text-row leading-hint",
                SURFACE_BORDER.chassis,
                SURFACE_INSET_BG.chassis,
                SURFACE_TEXT_MUTED.chassis,
              )}
            >
              {JSON.stringify(detail ?? row, null, 2)}
            </pre>
          </section>

          <section>
            <PaneHeading>{isError ? LOGS_TEXT.stack : LOGS_TEXT.context}</PaneHeading>
            <div className={cn("rounded-chip border p-2", SURFACE_BORDER.chassis, SURFACE_INSET_BG.chassis)}>
              {isError && (
                <pre className={cn("mb-2 text-row leading-hint whitespace-pre-wrap", TONE_TEXT.chassis.error)}>
                  {row.message}
                </pre>
              )}
              {/*
               * Every pair the row genuinely carries, and no line for one it does not — a `route` of
               * `—` on a worker's log line describes nothing that happened. The labels are the column
               * names rather than a second vocabulary, so the pane reads as the row unfolded.
               */}
              <dl className="flex flex-col gap-1 text-row">
                <DetailField label={LOGS_TEXT.columns.time(abbrev)}>
                  <span className="ik-zone-flash ik-zone-lift">{fullInstant(row.ts, tz)}</span>
                </DetailField>
                <DetailField label={LOGS_TEXT.columns.service}>{row.service}</DetailField>
                <DetailField label={LOGS_TEXT.columns.level}>
                  {row.levelName} ({row.level})
                </DetailField>
                {row.route !== null && (
                  <DetailField label={LOGS_TEXT.columns.route}>
                    {row.httpMethod === null ? row.route : `${row.httpMethod} ${row.route}`}
                  </DetailField>
                )}
                {row.statusCode !== null && (
                  <DetailField label={LOGS_TEXT.columns.status}>{row.statusCode}</DetailField>
                )}
                {row.durationMs !== null && (
                  <DetailField label={LOGS_TEXT.columns.duration}>{row.durationMs} ms</DetailField>
                )}
                {traceId !== null && <DetailField label={LOGS_TEXT.columns.trace}>{traceId}</DetailField>}
                {/*
                 * The half of the line that had to be fetched — IKN-58, and the reason this pane
                 * can now answer "who". Same rule as the pairs above: a field the event does not
                 * carry gets no line, because `client —` on a worker's log line describes nothing.
                 *
                 * `clientIp` is what the *service* reported. An app behind nginx that does not
                 * trust its proxy logs every caller as `127.0.0.1`, and that is a true fact about
                 * that app's logger rather than something for this pane to second-guess.
                 */}
                {detail?.clientIp != null && (
                  <DetailField label={LOGS_TEXT.columns.client}>{detail.clientIp}</DetailField>
                )}
                {detail?.userId != null && <DetailField label={LOGS_TEXT.columns.user}>{detail.userId}</DetailField>}
                {detail?.hostname != null && (
                  <DetailField label={LOGS_TEXT.columns.host}>{detail.hostname}</DetailField>
                )}
                {agent !== null && <DetailField label={LOGS_TEXT.columns.agent}>{agent}</DetailField>}
                {/*
                 * One line while the fetch is in flight, so the panel grows into its answer from
                 * somewhere rather than appearing out of nothing. The mark is what makes it read as
                 * a question and not as a field called `loading` (IKN-57).
                 */}
                {detailLoading && (
                  <div className={SURFACE_TEXT_DIM.chassis}>
                    <Pending>{LOGS_TEXT.loading}</Pending>
                  </div>
                )}
                {/*
                 * Said here rather than over the stream: the line itself is still on screen behind
                 * the modal and still readable, and only the fetched half is missing. A banner over
                 * the stream would suggest the search had failed, which it has not.
                 */}
                {detailError !== null && <p className={TONE_TEXT.chassis.warn}>{detailError}</p>}
              </dl>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
};

const PaneHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className={cn("pb-1 text-kicker tracking-kicker uppercase", SURFACE_TEXT_DIM.chassis)}>{children}</h3>
);

/**
 * One key and its value.
 *
 * Wrapped in a `<div>` rather than left as a bare `dt`/`dd` pair, which HTML5 allows precisely so a
 * list like this can be laid out in rows without a grid template: `w-14` reserves the label column
 * at a step off the spacing scale, and the value takes what is left and wraps inside it.
 */
const DetailField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2">
    <dt className={cn("w-14 flex-none", SURFACE_TEXT_DIM.chassis)}>{label}</dt>
    <dd className={cn("min-w-0 flex-1 break-all", SURFACE_TEXT.chassis)}>{children}</dd>
  </div>
);
