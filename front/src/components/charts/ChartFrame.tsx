"use client";

import { TOOLTIP_SKIN, Tooltip } from "@components/ui/Tooltip";
import { slotCenter } from "@lib/charts/barGeometry";
import { cn } from "@lib/utils";
import { useEffect } from "react";
import { useCrosshair } from "./hooks/useCrosshair";
import { useElementSize } from "./hooks/useElementSize";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { Crosshair, FrameState } from "./interfaces/chartFrameTypes";

/**
 * The box every chart in the app is drawn in (IKN-86).
 *
 * It measures its own width, so the drawing inside works in real pixels and a bar's edge lands on
 * a pixel boundary. Nothing is stretched with `preserveAspectRatio="none"`. It is the
 * `<svg role="img">` with the chart's one-sentence summary, the crosshair line, and the tooltip.
 *
 * A chart with a `tip` is interactive: the pointer moves its crosshair, and it takes focus so
 * ←/→ can do the same. A panel of several rows passes one shared `crosshair` instead, takes focus
 * itself, and draws its own tooltip. The frames in it only draw the line.
 */
export const ChartFrame = ({
  count,
  height,
  label,
  tip,
  crosshair: shared,
  className,
  children,
  ...rest
}: ChartFrameProps) => {
  const own = useCrosshair(count);
  const crosshair = shared ?? own;
  const { ref, node, width } = useElementSize<HTMLDivElement>();
  const interactive = tip !== undefined || shared !== undefined;
  const active = crosshair.target?.index ?? null;

  useEffect(() => {
    if (interactive) crosshair.register(node);
  }, [node, interactive, crosshair]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the plot is a figure the keyboard can
          walk, not a control; its role and summary are on the <svg> inside */}
      <div
        ref={ref}
        className={cn(
          "relative w-full min-w-0 outline-none",
          tip !== undefined && "rounded-chip focus-visible:ring-1 focus-visible:ring-chart-ref",
          className,
        )}
        style={{ height }}
        tabIndex={tip !== undefined ? 0 : undefined}
        onPointerMove={interactive ? crosshair.onPointerMove : undefined}
        onPointerLeave={interactive ? crosshair.onPointerLeave : undefined}
        onKeyDown={tip !== undefined ? crosshair.onKeyDown : undefined}
        onFocus={tip !== undefined ? crosshair.onFocus : undefined}
        onBlur={tip !== undefined ? crosshair.onBlur : undefined}
        {...rest}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={label}
            className="block overflow-visible"
          >
            {children({ width, active })}
            {active !== null && (
              <line
                x1={slotCenter(active, count, width)}
                x2={slotCenter(active, count, width)}
                y1={0}
                y2={height}
                className="stroke-chart-crosshair"
                strokeWidth={1}
              />
            )}
          </svg>
        )}
      </div>
      {tip !== undefined && (
        <Tooltip
          mode="cursor"
          skin={TOOLTIP_SKIN.chart}
          point={crosshair.target?.point ?? null}
        >
          {crosshair.target ? tip(crosshair.target.index) : null}
        </Tooltip>
      )}
    </>
  );
};

type ChartFrameProps = {
  /** How many buckets the x axis holds. */
  count: number;
  /** The SVG's height in pixels, baseline included. */
  height: number;
  /** The chart in one sentence, for a screen reader: `Visitors, last 7 days: 249, peak 6.5/h`. */
  label: string;
  /** What the bucket under the crosshair says. Given, the chart is interactive and focusable. */
  tip?: (index: number) => ReactNode;
  /** The panel's crosshair, when this frame is one row of several. */
  crosshair?: Crosshair;
  className?: string;
  children: (frame: FrameState) => ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;
