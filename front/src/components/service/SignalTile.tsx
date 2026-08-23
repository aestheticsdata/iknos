"use client";

import { cn } from "@lib/utils";
import Link from "next/link";

import type { Tone } from "@components/ui/surface";

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
  title,
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
  title?: string;
  /** The chart, or the sentence that says why there is not one. */
  children: React.ReactNode;
}) => {
  const body = (
    <>
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
      {/* Fixed, so the tile is the same height whether it holds a chart, a sentence, or a sentence
          that has not arrived. */}
      <div className="flex h-[26px] items-end">{children}</div>
    </>
  );

  const skin = "flex flex-col gap-1.25 rounded-card border border-work-border bg-work-surface px-3 py-2.25";

  if (!href) {
    return (
      <section
        title={title}
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
      title={title}
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
