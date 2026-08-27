"use client";

import { Button } from "@components/ui/Button";
import { Dot } from "@components/ui/Dot";
import { Modal } from "@components/ui/Modal";
import { Pending } from "@components/ui/Pending";
import { SURFACE_TEXT, SURFACE_TEXT_DIM, SURFACE_TEXT_MUTED, TONE_FILL, TONE_TEXT } from "@components/ui/surface";
import { Tooltip, TooltipBlock } from "@components/ui/Tooltip";
import { severityOf } from "@lib/logTypes";
import { cn } from "@lib/utils";
import { timeOfDay } from "@lib/zone";
import { useZone } from "@lib/zoneState";
import { LOGS_TEXT } from "@text/logs";

import type { Tone } from "@components/ui/surface";
import type { LogRow, Trace } from "@lib/logTypes";

/**
 * The trace timeline — IKN-12 §4, design doc §8.3.
 *
 * **This is not distributed tracing and is deliberately not drawn as one.** Iknos never asked the
 * services to propagate a span context; it only reads the lines they happened to write, and every
 * line that carries the same `traceId` is treated as a peer. So there is no nesting, no
 * parent/child, no inferred hierarchy — a flat list in time order, one lane each. Drawing a span
 * tree here would be inventing a causal structure out of a shared string, and the moment a service
 * logs three lines in a row the invented tree would start asserting relationships that nothing in
 * the data supports. A flat waterfall can only ever be wrong about *when*, which the data does say.
 *
 * Purely presentational: the fetch, the retry and the "which trace" question all belong to the view
 * that owns the URL. It is given the answer and the two things that can be true instead of one
 * (`loading`, `error`), and it renders whichever it was handed.
 *
 * Chassis surface throughout, and not by inheritance from `Modal` — §3.1 puts everything that
 * overhangs on the dark ramp, and the log stream is the one place you are genuinely in a terminal
 * (design doc U3), so the trace pulled out of it stays on the same ground it came from.
 */
export const TraceTimeline = ({
  trace,
  loading,
  error,
  onClose,
  onOpenInLogs,
  onCopyId,
}: {
  trace: Trace | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onOpenInLogs: (traceId: string) => void;
  onCopyId: (traceId: string) => void;
}) => {
  const traceId = trace?.traceId ?? null;

  return (
    <Modal
      /*
       * Open is derived rather than a prop of its own, so the caller can keep this mounted for the
       * whole session and drive it by handing over a trace, a spinner or a failure. That matters
       * for more than tidiness: `<dialog>` restores focus to whatever opened it when it closes, and
       * unmounting the element on close throws that away — the user lands back at the top of the
       * document instead of on the row they came from, which on a keyboard-first chassis (U5) is
       * the difference between the modal being usable and being a trap.
       */
      open={loading || error !== null || trace !== null}
      onClose={onClose}
      tag={LOGS_TEXT.traceTitle}
      /*
       * The header names the trace the moment the id is known and says nothing before that. The id
       * is the caller's, not ours, so inventing a placeholder for it would put a string in the
       * title bar that is not the thing about to be copied.
       */
      title={loading ? LOGS_TEXT.loading : (traceId ?? "")}
      actions={
        <>
          {/*
           * Close is an action here rather than a corner cross, because `Modal` deliberately has
           * no backdrop dismiss and draws no control of its own — its `esc` is a hint, not a
           * button. Without this the only exit is a key, which strands anyone using a pointer.
           */}
          <Button
            variant="quiet"
            onClick={onClose}
          >
            {LOGS_TEXT.close}
          </Button>
          <Button
            variant="quiet"
            disabled={traceId === null}
            onClick={() => {
              if (traceId !== null) onCopyId(traceId);
            }}
          >
            {LOGS_TEXT.copyTraceId}
          </Button>
          <Button
            disabled={traceId === null}
            onClick={() => {
              if (traceId !== null) onOpenInLogs(traceId);
            }}
          >
            {LOGS_TEXT.openInLogs}
          </Button>
        </>
      }
    >
      <TraceBody
        trace={trace}
        loading={loading}
        error={error}
      />
    </Modal>
  );
};

/**
 * The four things the body can be, in the order they take precedence.
 *
 * Split out so each state is an early return instead of a stack of nested ternaries — and so the
 * empty case cannot be confused with the failed one. **An empty result is not an error**: the
 * caller asked a well-formed question about a well-formed id and the range simply holds no line
 * carrying it, which is an answer. Colouring that red would send someone looking for a broken
 * endpoint instead of widening their window.
 */
const TraceBody = ({ trace, loading, error }: { trace: Trace | null; loading: boolean; error: string | null }) => {
  /* Before the early returns, because hooks cannot run conditionally — and the same `tz` the table
     the reader came from is on. Two clocks for one dataset is the rule `@lib/zone` exists for. */
  const { tz } = useZone();

  if (error !== null) return <p className={cn("text-ui leading-hint", TONE_TEXT.chassis.error)}>{error}</p>;

  // Before the `trace === null` check, not after it: a hook that keeps the previous trace while
  // fetching the next one would otherwise render the old rows under the new id, with nothing on
  // screen saying a request was in flight.
  if (loading)
    return (
      <p className={cn("text-ui", SURFACE_TEXT_DIM.chassis)}>
        <Pending>{LOGS_TEXT.loading}</Pending>
      </p>
    );

  // Nothing asked for, nothing in flight, nothing failed — the modal is closed above and this only
  // exists because the element stays mounted to keep the `<dialog>` focus return working.
  if (trace === null) return null;

  if (trace.rows.length === 0)
    return <p className={cn("text-ui leading-hint", SURFACE_TEXT_DIM.chassis)}>{LOGS_TEXT.traceEmpty}</p>;

  const lanes = lanesFor(trace);

  return (
    <div className="flex flex-col gap-2">
      <p className={cn("text-dense tabular-nums", SURFACE_TEXT_MUTED.chassis)}>
        {LOGS_TEXT.traceTotal(Math.round(trace.totalMs))}
      </p>

      {/*
       * Never optional and never quiet. `truncated` means the request logged more lines than came
       * back, so the total below it measures the lines shown and not the request — a timeline
       * silently cut is a claim about a request that is not true, and the person reading it is
       * about to draw a conclusion from a shape that is missing its middle.
       */}
      {trace.truncated && (
        <p className={cn("text-micro leading-hint", TONE_TEXT.chassis.warn)}>{LOGS_TEXT.traceTruncated}</p>
      )}

      {/*
       * An ordered list because the order is the content — these are the lines in the sequence they
       * were written, and that is the one relationship between them this view is willing to assert.
       * Capped and scrolled: `<dialog>` is height-limited by the UA, and a trace of eighty lines
       * would otherwise render past the bottom of the card with no way to reach the rest.
       */}
      <ol
        aria-label={LOGS_TEXT.traceTitle}
        className="ik-scroll flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto"
      >
        {lanes.map((lane) => (
          <li key={lane.key}>
            {/*
             * One bubble for the whole row, and it carries the three things the row cannot: the
             * absolute instant (the line only shows `+12` since the trace started), the message in
             * full where the column truncates it, and the difference between a line that measured
             * nothing and one that measured zero — which the lane draws as a tick and says nowhere
             * in words.
             *
             * The wrapper takes the `<li>`'s own classes rather than nesting inside them, so the
             * list keeps exactly the geometry it had.
             */}
            <Tooltip
              mode="hover"
              className="flex w-full flex-col gap-1"
              content={
                <div className="flex flex-col gap-1">
                  <TooltipBlock
                    subject={timeOfDay(lane.row.ts, tz)}
                    context={`${lane.row.service} · ${lane.row.levelName}`}
                    rows={[
                      { label: LOGS_TEXT.traceRows.offset, value: `+${roundMs(lane.offsetMs)} ms` },
                      {
                        label: LOGS_TEXT.traceRows.took,
                        value:
                          lane.durationMs === null ? LOGS_TEXT.traceRows.unmeasured : `${roundMs(lane.durationMs)} ms`,
                      },
                    ]}
                  />
                  <p className={SURFACE_TEXT.chassis}>{lane.row.message}</p>
                </div>
              }
            >
              <div className="flex items-baseline gap-2 text-row">
                <Dot
                  tone={lane.tone}
                  surface="chassis"
                  label={lane.row.levelName}
                  className="shrink-0 self-center"
                />
                <span className={cn("shrink-0", SURFACE_TEXT_DIM.chassis)}>{lane.row.service}</span>
                <span className={cn("min-w-0 flex-1 truncate", SURFACE_TEXT.chassis)}>{lane.row.message}</span>
                <span className={cn("shrink-0 tabular-nums", SURFACE_TEXT_DIM.chassis)}>+{roundMs(lane.offsetMs)}</span>
                {lane.durationMs !== null && (
                  <span className={cn("shrink-0 tabular-nums", SURFACE_TEXT_MUTED.chassis)}>
                    {roundMs(lane.durationMs)} ms
                  </span>
                )}
              </div>

              {/*
               * The lane is `aria-hidden` in its entirety: it is a second rendering of the offset and
               * the duration already sitting in the text line above it, and a screen reader gains
               * nothing from two `<span>`s whose only content is a percentage.
               */}
              <div
                aria-hidden="true"
                className="relative h-1.5 rounded-chip bg-chassis-inset"
              >
                {lane.durationMs === null ? (
                  /*
                   * A tick, not a zero-length bar. Most lines measure nothing — a `console.log` in the
                   * middle of a handler has a timestamp and no duration — and drawing those as bars of
                   * width zero would render them as nothing at all, so half the trace would silently
                   * vanish. Standing proud of the lane rather than filling it also keeps the two
                   * readable apart: a mark is a moment, a bar is an interval.
                   */
                  <span
                    className={cn(
                      "absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2",
                      TONE_FILL.chassis[lane.tone],
                    )}
                    style={{ left: `${lane.leftPct}%` }}
                  />
                ) : (
                  <span
                    className={cn("absolute inset-y-0 rounded-chip", TONE_FILL.chassis[lane.tone])}
                    /*
                     * `minWidth` rather than a floor on the percentage: a 0.4ms call inside a
                     * six-second trace is 0.007% of the lane, which rounds to no pixels and reads as
                     * a row that measured nothing — the exact thing the tick above is there to mean.
                     */
                    style={{ left: `${lane.leftPct}%`, width: `${lane.widthPct}%`, minWidth: "2px" }}
                  />
                )}
              </div>
            </Tooltip>
          </li>
        ))}
      </ol>
    </div>
  );
};

/** One row's geometry, resolved once so the JSX below is layout and nothing else. */
type Lane = {
  key: string;
  row: LogRow;
  tone: Tone;
  /** Milliseconds after the first line of the trace. */
  offsetMs: number;
  /** Mirrors the row: `null` is a line that measured nothing, and is drawn as a tick. */
  durationMs: number | null;
  leftPct: number;
  widthPct: number;
};

/**
 * Offsets, widths, and the scale they are drawn against.
 *
 * **The denominator is not `totalMs`.** A completion line — pino-http's `request completed` — is
 * written *at the end* of what it measures and carries the whole of it, so its offset is already
 * near the end of the trace and its duration then reaches well past it. Dividing by `totalMs` would
 * send that bar off the right edge of every lane it appears in, which is most HTTP traces. The
 * ticket fixes the offset at `ts` relative to the first line, so the scale is what has to give: it
 * covers whatever the rows actually span, floored at `totalMs` so a trace of ticks alone still
 * draws against the wall clock rather than against its own last tick.
 *
 * The consequence is that the lane can be longer than the total printed above it. That is the
 * honest reading of the two facts — the lines say how long they took, `totalMs` says how long the
 * span between them was — and the per-row numbers in the text line are what let someone follow it.
 */
const lanesFor = (trace: Trace): Lane[] => {
  const times = trace.rows.map((row) => Date.parse(row.ts));

  /*
   * The minimum of the parseable ones, not `rows[0]`. The endpoint orders by `ts` and the front end
   * has no business trusting that alone: one unparseable timestamp taken as the origin would make
   * every other offset a number of milliseconds since 1970, and the whole trace would collapse into
   * a single stripe at the far left with nothing on screen to say why.
   */
  const parseable = times.filter((time) => Number.isFinite(time));
  const origin = parseable.length > 0 ? Math.min(...parseable) : 0;

  const offsets = times.map((time) => (Number.isFinite(time) ? Math.max(0, time - origin) : 0));

  const durations = trace.rows.map((row) => (row.durationMs === null ? null : Math.max(0, row.durationMs)));

  // Floored at 1 so a trace whose lines all share a millisecond divides by something.
  const span = Math.max(trace.totalMs, 1, ...offsets.map((offset, index) => offset + (durations[index] ?? 0)));

  return trace.rows.map((row, index) => {
    const offsetMs = offsets[index];
    const durationMs = durations[index];

    return {
      // `ts` alone repeats across lines written in the same millisecond, and `id` is empty on a row
      // that reached the view over the live tail. The position closes both holes, and a trace is a
      // static snapshot — nothing reorders under it, which is the one thing an index key cannot
      // survive.
      key: `${row.id}-${row.ts}-${index}`,
      row,
      tone: severityOf(row.level),
      offsetMs,
      durationMs,
      leftPct: (offsetMs / span) * 100,
      widthPct: durationMs === null ? 0 : (durationMs / span) * 100,
    };
  });
};

/**
 * Durations arrive as floats — pino-http writes `12.4183`, and four decimal places in a column read
 * down at 10.5px is noise wearing the costume of precision. Below 10ms the first decimal still
 * separates two numbers someone might act on; above it, it is under the resolution of anything you
 * would change code over.
 */
const roundMs = (ms: number): number => (ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms));
