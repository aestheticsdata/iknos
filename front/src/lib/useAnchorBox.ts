"use client";

import { useEffect, useState } from "react";

import type { Box, TourAnchor } from "@lib/interfaces/tourTypes";

/** How often the anchor is measured again: it can be drawn late, or move when the rail's list loads. */
const RETRY_MS = 500;

const boxOf = (anchor: TourAnchor): Box | undefined => {
  const rect = document.querySelector(`[data-tour="${anchor}"]`)?.getBoundingClientRect();
  // A hidden element measures as nothing, and a ring around nothing points at the corner.
  if (!rect || rect.width === 0 || rect.height === 0) return undefined;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

const sameBox = (a: Box | undefined, b: Box | undefined) =>
  a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height;

/** Where the tour's anchor is on screen; follows resizes, and waits for an anchor not drawn yet. */
export const useAnchorBox = (anchor: TourAnchor | undefined) => {
  const [box, setBox] = useState<Box | undefined>(undefined);

  useEffect(() => {
    if (!anchor) return;
    // The same object back when nothing moved, so a quiet retry is not a render.
    const measure = () =>
      setBox((current) => {
        const next = boxOf(anchor);
        return sameBox(current, next) ? current : next;
      });
    measure();
    const retry = setInterval(measure, RETRY_MS);
    // A new object on every resize, moved or not: the card's place also depends on the viewport.
    const resized = () => setBox(boxOf(anchor));
    window.addEventListener("resize", resized);
    return () => {
      clearInterval(retry);
      window.removeEventListener("resize", resized);
    };
  }, [anchor]);

  return box;
};
