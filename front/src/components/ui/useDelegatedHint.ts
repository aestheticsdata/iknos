"use client";

import { useEffect, useState } from "react";

import type { CursorHover } from "@components/ui/useCursorHover";
import type { RefObject } from "react";

/**
 * One bubble for a whole container, read off `data-hint` on whatever the pointer or the keyboard is
 * on (IKN-62).
 *
 * `<Tooltip mode="hover">` is a wrapper with its own state, and that is the right shape for a
 * header's five chips. It is the wrong one for the log stream, whose rows exist ten thousand times
 * over: four hinted cells a row would be forty thousand wrappers, each with a hover state and an
 * id, on a table whose own comments refuse a single extra wrapper per cell. Here the cells carry a
 * string attribute — what `title` cost them — and one listener on the container resolves which of
 * them is under the pointer.
 *
 * **Native listeners on the container, and the state in whatever renders the bubble.** A mousemove
 * sets state at pointer rate; held in the table it would re-render every row per pixel of travel.
 * Held in `DelegatedTooltip`, it re-renders a portal.
 *
 * The keyboard half matches the hover wrapper's: a `focus-visible` arrival on a hinted element
 * anchors the bubble under it, blur and Escape close it.
 */
export const useDelegatedHint = (root: RefObject<HTMLElement | null>) => {
  const [hint, setHint] = useState<CursorHover<string> | null>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;

    const move = (event: MouseEvent) => {
      const text = hintOf(event.target);
      setHint(text === null ? null : { x: event.clientX, y: event.clientY, data: text });
    };

    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(":focus-visible")) return;
      const hinted = event.target.closest<HTMLElement>("[data-hint]");
      const text = hinted?.dataset.hint;
      if (!hinted || !text) return;

      const rect = hinted.getBoundingClientRect();
      setHint({ x: rect.left, y: rect.bottom, data: text });
    };

    const clear = () => setHint(null);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHint(null);
    };

    element.addEventListener("mousemove", move);
    element.addEventListener("mouseleave", clear);
    element.addEventListener("focusin", focus);
    element.addEventListener("focusout", clear);
    element.addEventListener("keydown", dismiss);
    return () => {
      element.removeEventListener("mousemove", move);
      element.removeEventListener("mouseleave", clear);
      element.removeEventListener("focusin", focus);
      element.removeEventListener("focusout", clear);
      element.removeEventListener("keydown", dismiss);
    };
  }, [root]);

  return hint;
};

/** The nearest `data-hint` at or above the event's target, or `null` when the pointer is on none. */
const hintOf = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) return null;
  const text = target.closest<HTMLElement>("[data-hint]")?.dataset.hint;
  return text ? text : null;
};
