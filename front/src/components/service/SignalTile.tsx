"use client";

import { Spinner } from "@components/ui/Spinner";
import { Tooltip } from "@components/ui/Tooltip";
import { cn } from "@lib/utils";
import Link from "next/link";

import type { Tone } from "@components/ui/surface";
import type { ReactNode } from "react";

/**
 * The shell all four signal tiles share — design doc §5.2.
 *
 * A kicker, one big number with its unit, and a chart. The height is pinned rather than left to the
 * content, which is the same discipline `VolumeHistogram` takes: a tile that is 100px with a chart
 * and 62px with an empty state would move the log panel below it every time a range was changed,
 * and the Done list asks for no layout jump at 1440×900.
 *
 * **A tile is a link only when it has somewhere real to lead.** §4 makes a block with no data
 * inert; the same reasoning takes one more step here, because a link that lands on the screen the
 * reader is already looking at is a worse promise than no link. The throughput and latency tiles
 * point at the routes table, which is IKN-23 — so they carry their affordance the day their
 * destination exists, and not before.
 */
export const SignalTile = ({
  kicker,
  value,
  unit,
  tone = "neutral",
  pending = false,
  href,
  hint,
  children,
}: {
  kicker: string;
  value: string;
  unit: string;
  /** Colours the number. Only the error rate uses anything but the default. */
  tone?: Tone;
  /**
   * True while the first reading is in flight — IKN-57.
   *
   * The tile's business rather than the caller's, because what it prevents is a caller forgetting.
   * `formatRate(null)` is `ABSENT`, and `ABSENT` on this figure is the claim that a reading came
   * back empty. A tile nobody has answered yet may not print the glyph that says one did.
   */
  pending?: boolean;
  href?: string | null;
  /**
   * What the figure means — the scale it is measured on, or where the tile leads.
   *
   * **On the header alone, and that is the design.** The chart underneath answers a different
   * question (which interval, and what was it worth) and answers it per bar, so the two hover
   * targets in one tile say two different things: the number explains itself, the chart explains
   * its marks. One bubble over the whole tile would have to pick one of them, and would cover the
   * chart while the reader is trying to point at it.
   *
   * `null` is a tile with nothing to add — see `Tooltip`, which hands the trigger back untouched.
   */
  hint?: ReactNode;
  /** The chart, or the sentence that says why there is not one. */
  children: React.ReactNode;
}) => {
  const body = (
    <>
      {/* The same two boxes whether or not there is a hint: with none, the wrapper is not rendered
          at all and these are the flex children they have always been. */}
      <Tooltip
        mode="hover"
        content={hint}
        className="flex flex-col gap-1.25"
      >
        <span className="text-kicker tracking-kicker font-medium text-work-text-dim uppercase">{kicker}</span>
        <div className="flex items-baseline gap-1.5">
          {pending ? (
            <PendingFigure />
          ) : (
            <span
              className={cn(
                "text-signal font-medium tabular-nums transition-[color] duration-150 ease-out",
                tone === "error" ? "text-work-error" : "text-work-text",
              )}
            >
              {value}
            </span>
          )}
          <span className="text-label text-work-text-muted">{unit}</span>
        </div>
      </Tooltip>
      {/* Fixed, so the tile is the same height whether it holds a chart, a sentence, or a sentence
          that has not arrived. */}
      <div className="flex h-[26px] items-end">{children}</div>
      {pending && (
        /* Centred over the whole tile, on top of the kicker, the figure block and the counting
           mark — deliberately additive rather than replacing any of them. The mark is the pending
           state at reading distance; this is the same state at arm's length, and it exists because
           the mark alone failed the person it was built for. `pointer-events-none` so the error
           tile's link keeps every pixel of its click target while it waits. */
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-work-text-dim">
          <Spinner />
        </span>
      )}
    </>
  );

  /* `relative` for the pending overlay's sake — the tile is the box the spinner centres in. */
  const skin = "relative flex flex-col gap-1.25 rounded-card border border-work-border bg-work-surface px-3 py-2.25";

  if (!href) {
    return (
      <section
        aria-busy={pending || undefined}
        className={skin}
      >
        {body}
      </section>
    );
  }

  return (
    <Link
      href={href}
      aria-busy={pending || undefined}
      className={cn(skin, "transition-[border-color] duration-150 ease-out hover:border-work-text-dim")}
    >
      {body}
    </Link>
  );
};

/**
 * What stands where the number goes, until there is one — IKN-57.
 *
 * A muted block, not a glyph. Every candidate glyph is already an answer somewhere in this app:
 * `—` is `ABSENT`, which means a reading came back with nothing in it, and dots would be a still
 * copy of the mark counting in the chart box below — a stalled twin of the thing whose whole job is
 * to be moving. A block is the one shape that cannot be read as a reading, because no figure in
 * Iknos is a solid bar.
 *
 * `aria-hidden`, and it costs nothing to hide: the tile carries `aria-busy` and the pending line
 * below says the same thing in words.
 *
 * The line box is provably unchanged. An empty `inline-block` sits on its bottom margin edge, so at
 * `0.6em` it reaches well inside the strut the 20px figure already establishes, and the row cannot
 * grow when the real number replaces it.
 */
const PendingFigure = () => (
  <span
    aria-hidden="true"
    className="inline-block h-[0.6em] w-[3ch] rounded-chip bg-work-inset align-baseline"
  />
);

/** The sentence a tile shows in place of a chart. Never a flat line, never a zero baseline. */
export const TileEmpty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-micro leading-hint text-work-text-dim">{children}</p>
);
