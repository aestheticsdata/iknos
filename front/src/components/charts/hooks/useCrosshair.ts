"use client";

import { slotAt, slotCenter } from "@lib/charts/barGeometry";
import { useRef, useState } from "react";

import type { KeyboardEvent, PointerEvent } from "react";
import type { Crosshair, CrosshairTarget } from "../interfaces/chartFrameTypes";

/**
 * The crosshair of a chart or of a whole panel (IKN-86): which bucket is pointed at, by the pointer
 * or by the keyboard, and where its tooltip goes.
 *
 * One per panel, so pointing at the visitors row puts the line on the page-views row too. The
 * tooltip is anchored to the crosshair and not to the pointer, which lets the keyboard place it
 * just as the pointer does: 10px right of the line, level with the top of the plot.
 *
 * The keys it takes are ←, →, Home, End and Esc, and only while the plot has focus. It stops
 * nothing else, so the log view's j/k keep working.
 */
export const useCrosshair = (count: number): Crosshair => {
  const [target, setTarget] = useState<CrosshairTarget | null>(null);
  const plot = useRef<HTMLElement | null>(null);

  const at = (index: number, box: DOMRect): CrosshairTarget => ({
    index,
    point: { x: box.left + slotCenter(index, count, box.width), y: box.top },
  });

  const moveTo = (index: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || count === 0) return;
    setTarget(at(Math.min(count - 1, Math.max(0, index)), box));
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (count === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const index = slotAt(event.clientX - box.left, count, box.width);
    if (target?.index === index && target.point.y === box.top) return;
    setTarget(at(index, box));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const current = target?.index ?? count - 1;
    switch (event.key) {
      case "ArrowLeft":
        moveTo(target === null ? current : current - 1);
        break;
      case "ArrowRight":
        moveTo(target === null ? current : current + 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(count - 1);
        break;
      case "Escape":
        // Only swallowed when there was something to close; otherwise Esc keeps its global meaning.
        if (target === null) return;
        setTarget(null);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    target: target !== null && target.index < count ? target : null,
    onPointerMove,
    onPointerLeave: () => setTarget(null),
    onKeyDown,
    // Focus lands on the most recent bucket: that is the one a reader is usually asking about.
    onFocus: () => moveTo(count - 1),
    onBlur: () => setTarget(null),
    register: (node: HTMLElement | null) => {
      if (node && !plot.current?.isConnected) plot.current = node;
    },
  };
};
