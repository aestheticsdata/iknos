"use client";

import { useState } from "react";

/** Viewport coordinates, as a pointer event reports them. */
export type CursorPoint = {
  x: number;
  y: number;
};

export type CursorHover<T> = CursorPoint & {
  data: T;
};

/**
 * The hover state a `<Tooltip mode="cursor">` is driven from: where the pointer is, and which datum
 * is under it. Ported from Zeus (ZEU-40), which took it from PFA (PFA-107) — the third copy, and
 * the reason it is a hook rather than four `useState` calls in four charts.
 *
 * `T` defaults to `void` for a bubble whose content never changes: call `move()` with no argument.
 * Anything per-mark passes its datum type — `useCursorHover<number>()` for a strip whose datum is
 * the index of the bar under the pointer.
 *
 * Two setters, because a strip and a single mark want opposite things:
 *
 * - `move(data)` binds one handler to one element — a segment of the state band, a bucket button.
 * - `show(x, y, data)` is the imperative form for a container that works out which of its children
 *   the pointer is over, per event. A sixty-bucket chart wants one listener, not sixty.
 *
 * **The state belongs to the smallest component that can hold it.** A mousemove sets state at
 * pointer rate, so the component holding it re-renders at pointer rate; in a chart primitive that
 * is one `<svg>` and a portal, and in the view above it would be the whole log panel.
 */
export const useCursorHover = <T = void>() => {
  const [hover, setHover] = useState<CursorHover<T> | null>(null);

  const move = (data: T) => (event: { clientX: number; clientY: number }) =>
    setHover({ x: event.clientX, y: event.clientY, data });

  const show = (x: number, y: number, data: T) => setHover({ x, y, data });

  const clear = () => setHover(null);

  return { hover, move, show, clear };
};
