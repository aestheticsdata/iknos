import type { CursorPoint } from "@components/ui/useCursorHover";
import type { KeyboardEvent, PointerEvent } from "react";

/** The bucket a crosshair stands on, and where its tooltip is anchored on screen. */
export type CrosshairTarget = { index: number; point: CursorPoint };

/**
 * One crosshair, shared by every row of a panel (IKN-86): pointing at any row moves it on all of
 * them. `useCrosshair` makes one.
 */
export type Crosshair = {
  target: CrosshairTarget | null;
  /** Binds to a plot: the bucket under the pointer, measured against that plot's own box. */
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  /** ←/→ step a bucket, Home/End jump to the ends, Esc hides it. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** The plot the keyboard measures against. The first plot to register is the one used. */
  register: (plot: HTMLElement | null) => void;
};

/** What a `ChartFrame` hands the drawing inside it. */
export type FrameState = {
  /** The plot's width in whole pixels, measured. 0 until the first measurement. */
  width: number;
  /** The bucket the crosshair stands on, or `null`. */
  active: number | null;
};
